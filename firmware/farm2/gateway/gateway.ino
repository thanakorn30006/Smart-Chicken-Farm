// Gateway (ตัวแม่) v3: ESP-NOW <-> MQTT bridge for ONE farm, up to 20 coop nodes.
//
//   node --ESP-NOW (HMAC)--> gateway --MQTT--> scf/<MQTT_USER>/node/<n>/telemetry
//   Node-RED --MQTT--> scf/<MQTT_USER>/node/<n>/light/set --> gateway --ESP-NOW (HMAC)--> node
//   node ACK --> gateway --MQTT (retained)--> scf/<MQTT_USER>/node/<n>/light/state
//   rejected packets (bad HMAC / replay) are counted and reported on scf/<MQTT_USER>/security
//
// Security:
//   - MQTT: logs in with its own username/password; the broker ACL only lets it use scf/<MQTT_USER>/...
//   - ESP-NOW: only packets with a valid HMAC tag (farm key) and a newer counter are accepted
//   - Settings and passwords are in secrets.h (filled by ./start.sh, or copied from the web when adding a gateway)
//
// Libraries: "PubSubClient" by Nick O'Leary (Library Manager)
#include <WiFi.h>
#include <PubSubClient.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_arduino_version.h>
#include "secrets.h"
#include "scf_packet.h"

const unsigned long SYNC_MS = 3000;        // resend wanted light states + heartbeat
const unsigned long SECURITY_REPORT_MS = 60000;

uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
WiFiClient net;
PubSubClient mqtt(net);
SecureLink secure;
String base;                                // "scf/<MQTT_USER>"

// ESP-NOW receive runs in the Wi-Fi task: copy packets into a small ring, verify them in loop()
const int RING = 16;
Packet ring[RING];
volatile int ringHead = 0, ringTail = 0;
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;

uint8_t desired[MAX_NODES + 1], acked[MAX_NODES + 1], published[MAX_NODES + 1];
uint32_t lastCounter[MAX_NODES + 1];
uint32_t badTag = 0, replays = 0, badFormat = 0;
unsigned long lastSync = 0, lastMqttTry = 0, lastReport = 0;

void onReceive(const uint8_t* data, int len) {
  if (len != sizeof(Packet)) return;
  portENTER_CRITICAL(&mux);
  int next = (ringHead + 1) % RING;
  if (next != ringTail) { memcpy(&ring[ringHead], data, sizeof(Packet)); ringHead = next; }
  portEXIT_CRITICAL(&mux);
}
#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onRecvCb(const esp_now_recv_info_t*, const uint8_t* data, int len) { onReceive(data, len); }
#else
void onRecvCb(const uint8_t*, const uint8_t* data, int len) { onReceive(data, len); }
#endif

void sendCmd(uint8_t node, uint8_t led) {
  Packet p = {};
  p.type = PKT_LED_CMD; p.node = node; p.led = led;
  secure.seal(p);
  esp_now_send(BROADCAST, (uint8_t*)&p, sizeof p);
}

// ---- MQTT ------------------------------------------------------------------
// scf/<MQTT_USER>/node/<n>/light/set  ON | OFF
void onMqtt(char* topic, byte* payload, unsigned int len) {
  String t(topic), prefix = base + "/node/";
  if (!t.startsWith(prefix) || !t.endsWith("/light/set")) return;
  int n = t.substring(prefix.length(), t.length() - 10).toInt();
  if (n < 1 || n > MAX_NODES) return;
  String msg;
  for (unsigned int i = 0; i < len && i < 8; i++) msg += (char)payload[i];
  msg.trim(); msg.toUpperCase();
  if (msg != "ON" && msg != "OFF") return;
  desired[n] = msg == "ON" ? 1 : 0;
  Serial.printf("MQTT  node %d light -> %s\n", n, msg.c_str());
  sendCmd(n, desired[n]);                  // straight away, no waiting for the next sync
}

void connectMqtt() {
  String id = String("scf-") + MQTT_USER;
  String will = base + "/status";
  if (!mqtt.connect(id.c_str(), MQTT_USER, MQTT_PASS, will.c_str(), 1, true, "offline")) {
    Serial.printf("MQTT connect failed, state=%d  (5 = wrong user/password: check secrets.h / reset in web)\n", mqtt.state());
    return;
  }
  mqtt.publish(will.c_str(), "online", true);
  mqtt.subscribe((base + "/node/+/light/set").c_str(), 1);
  for (int n = 1; n <= MAX_NODES; n++) published[n] = LED_UNKNOWN;
  Serial.printf("MQTT connected to %s:%d as %s\n", MQTT_HOST, MQTT_PORT, MQTT_USER);
}

void handlePacket(const Packet& p) {
  if (p.type != PKT_READING && p.type != PKT_LED_ACK) return;          // gateway never accepts commands
  if (p.node < 1 || p.node > MAX_NODES) { badFormat++; return; }
  switch (secure.open(p, lastCounter[p.node])) {
    case Verdict::OK: break;
    case Verdict::BAD_TAG: badTag++; Serial.printf("!! rejected packet for node %d: bad HMAC\n", p.node); return;
    case Verdict::REPLAY: replays++; Serial.printf("!! rejected packet for node %d: replayed counter\n", p.node); return;
    default: badFormat++; return;
  }
  if (!mqtt.connected()) return;
  char topic[64], body[64];
  if (p.type == PKT_READING) {
    if (isnan(p.temp) || isnan(p.humidity)) return;
    snprintf(topic, sizeof topic, "%s/node/%d/telemetry", base.c_str(), p.node);
    snprintf(body, sizeof body, "{\"temp\":%.2f,\"humidity\":%.2f}", p.temp, p.humidity);
    bool ok = mqtt.publish(topic, body);
    Serial.printf("Node %d  T=%.1f H=%.1f  -> MQTT %s\n", p.node, p.temp, p.humidity, ok ? "ok" : "FAIL");
  } else if (p.led <= 1) {
    acked[p.node] = p.led;
    if (acked[p.node] != published[p.node]) {
      snprintf(topic, sizeof topic, "%s/node/%d/light/state", base.c_str(), p.node);
      if (mqtt.publish(topic, p.led ? "ON" : "OFF", true)) {
        published[p.node] = p.led;
        Serial.printf("ACK   node %d light is %s\n", p.node, p.led ? "ON" : "OFF");
      }
    }
  }
}

void connectWifi() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("Connecting to %s", WIFI_SSID);
  for (int i = 1; WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print(".");
    if (i % 40 == 0) Serial.println("\n!! ยังต่อไม่ได้: เช็กฮอตสปอตเปิดอยู่, เป็น 2.4 GHz, ชื่อ/รหัสใน secrets.h ถูก");
  }
  Serial.printf(" OK  IP=%s  channel=%d\n", WiFi.localIP().toString().c_str(), WiFi.channel());
}

void setup() {
  Serial.begin(115200);
  if (!secure.begin(FARM_KEY, "scf-gw")) { Serial.println("!! FARM_KEY in secrets.h must be 32 hex characters"); while (true) delay(1000); }
  memset(desired, LED_UNKNOWN, sizeof desired);
  memset(acked, LED_UNKNOWN, sizeof acked);
  memset(published, LED_UNKNOWN, sizeof published);
  memset(lastCounter, 0, sizeof lastCounter);
  base = String("scf/") + MQTT_USER;

  WiFi.mode(WIFI_STA);
  connectWifi();
  esp_wifi_set_ps(WIFI_PS_NONE);           // keep radio awake so ESP-NOW packets are not missed
  if (esp_now_init() != ESP_OK) { Serial.println("ESP-NOW init failed"); while (true) delay(1000); }
  esp_now_register_recv_cb(onRecvCb);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST, 6);
  peer.channel = 0;
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;                    // authenticity comes from the HMAC tag (broadcast cannot use ESP-NOW encryption)
  esp_now_add_peer(&peer);

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqtt);
  mqtt.setKeepAlive(15);                   // broker notices a dead gateway within ~20 s and publishes "offline"
  Serial.printf("Gateway %s ready. MAC=%s\n", MQTT_USER, WiFi.macAddress().c_str());
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  unsigned long now = millis();
  if (!mqtt.connected() && now - lastMqttTry >= 3000) { lastMqttTry = now; connectMqtt(); }
  mqtt.loop();

  while (ringTail != ringHead) {
    Packet p;
    portENTER_CRITICAL(&mux);
    p = ring[ringTail];
    ringTail = (ringTail + 1) % RING;
    portEXIT_CRITICAL(&mux);
    handlePacket(p);
  }

  if (now - lastSync >= SYNC_MS) {
    lastSync = now;
    sendCmd(NODE_ALL, LED_UNKNOWN);        // heartbeat: nodes know the gateway (and channel) is alive
    for (int n = 1; n <= MAX_NODES; n++) if (desired[n] != LED_UNKNOWN) { delay(3); sendCmd(n, desired[n]); }
  }

  if (now - lastReport >= SECURITY_REPORT_MS) {
    lastReport = now;
    if ((badTag || replays || badFormat) && mqtt.connected()) {
      char body[96];
      snprintf(body, sizeof body, "{\"bad_tag\":%lu,\"replay\":%lu,\"bad_format\":%lu}", (unsigned long)badTag, (unsigned long)replays, (unsigned long)badFormat);
      if (mqtt.publish((base + "/security").c_str(), body)) badTag = replays = badFormat = 0;
    }
  }
}

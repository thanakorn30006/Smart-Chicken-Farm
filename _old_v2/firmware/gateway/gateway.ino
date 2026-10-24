// Gateway (ตัวแม่): สะพานระหว่าง ESP-NOW (โหนดในโรงเรือน) กับ MQTT broker
//
//   โหนด --ESP-NOW--> Gateway --MQTT publish--> farm/house/{n}/telemetry
//   เว็บ/Node-RED --MQTT--> farm/house/{n}/light/set --> Gateway --ESP-NOW--> โหนด
//   โหนดตอบรับ (ACK) --ESP-NOW--> Gateway --MQTT publish (retained)--> farm/house/{n}/light/state
//
// Gateway ไม่รู้จักฐานข้อมูลเลย: มีหน้าที่แค่แปลงโปรโตคอล การบันทึกและกฎต่าง ๆ อยู่ใน Node-RED
// คำสั่งเปิด-ปิดไฟถูก "push" มาทาง MQTT ทันที ไม่ต้อง poll ฐานข้อมูลเหมือนเวอร์ชันเก่า
//
// Library: "PubSubClient" by Nick O'Leary (Library Manager)
#include <WiFi.h>
#include <PubSubClient.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_arduino_version.h>

// ---- settings -------------------------------------------------------------
const char* WIFI_SSID = "igus";                // hotspot name (2.4 GHz)
const char* WIFI_PASS = "12345678";
const char* MQTT_HOST = "172.20.10.9";         // IP ของ Mac ที่รัน Mosquitto (ดูด้วย: ipconfig getifaddr en0)
const int   MQTT_PORT = 1883;
const char* MQTT_USER = "";                    // ว่าง = broker แบบ anonymous
const char* MQTT_PASS = "";
const bool  TEST_MODE = false;  // true = ส่งค่าปลอมของโรงเรือน 1 และจำลอง ACK (ไม่ต้องมีโหนด)
const int   LED_PIN   = 2;      // TEST_MODE: LED บนบอร์ดแทนไฟโรงเรือน 1
const unsigned long SYNC_MS = 3000;   // ส่งสถานะไฟที่ต้องการซ้ำทุก 3 วิ (กันแพ็กเก็ตหาย + ให้โหนดรู้ว่าตัวแม่ยังอยู่)
const unsigned long FAKE_MS = 10000;
// ----------------------------------------------------------------------------

// Messages over ESP-NOW. Must be identical in node.ino.
struct __attribute__((packed)) Reading { uint8_t type; uint8_t house; float temp; float humidity; };  // type 1: node -> gateway
struct __attribute__((packed)) LedCmd  { uint8_t type; uint8_t house; uint8_t led; };                 // type 2: gateway -> nodes
struct __attribute__((packed)) LedAck  { uint8_t type; uint8_t house; uint8_t led; };                 // type 3: node -> gateway
const uint8_t LED_UNKNOWN = 255;   // in LedCmd: "no command yet", the node only notes that the gateway is alive

uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
WiFiClient net;
PubSubClient mqtt(net);
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;

Reading latest[4];
volatile bool pending[4]  = {false, false, false, false};   // new reading waiting to be published
volatile uint8_t acked[4] = {LED_UNKNOWN, LED_UNKNOWN, LED_UNKNOWN, LED_UNKNOWN};  // light state the node reported
uint8_t desired[4]   = {LED_UNKNOWN, LED_UNKNOWN, LED_UNKNOWN, LED_UNKNOWN};  // from farm/house/{n}/light/set
uint8_t published[4] = {LED_UNKNOWN, LED_UNKNOWN, LED_UNKNOWN, LED_UNKNOWN};  // last light/state sent to MQTT
unsigned long lastSync = 0, lastFake = 0, lastMqttTry = 0;

// ---- ESP-NOW receive: runs inside the Wi-Fi task, so only store and handle it in loop() ----
void onReceive(const uint8_t* data, int len) {
  if (len == sizeof(Reading)) {
    Reading r;
    memcpy(&r, data, sizeof r);
    if (r.type != 1 || r.house < 1 || r.house > 3) return;
    portENTER_CRITICAL(&mux);
    latest[r.house] = r;
    pending[r.house] = true;
    portEXIT_CRITICAL(&mux);
  } else if (len == sizeof(LedAck)) {
    LedAck a;
    memcpy(&a, data, sizeof a);
    if (a.type != 3 || a.house < 1 || a.house > 3 || a.led > 1) return;
    acked[a.house] = a.led;
  }
}
#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onRecvCb(const esp_now_recv_info_t*, const uint8_t* data, int len) { onReceive(data, len); }
#else
void onRecvCb(const uint8_t*, const uint8_t* data, int len) { onReceive(data, len); }
#endif

void sendCmd(int h) {
  LedCmd cmd = {2, (uint8_t)h, desired[h]};
  esp_now_send(BROADCAST, (uint8_t*)&cmd, sizeof cmd);
  if (TEST_MODE && h == 1 && desired[1] != LED_UNKNOWN) {   // no node in test mode: act as house 1 ourselves
    digitalWrite(LED_PIN, desired[1] ? HIGH : LOW);
    acked[1] = desired[1];
  }
}

// ---- MQTT ------------------------------------------------------------------
// farm/house/{n}/light/set  payload ON / OFF  ->  forward to the node straight away
void onMqtt(char* topic, byte* payload, unsigned int len) {
  int h = 0;
  if (sscanf(topic, "farm/house/%d/light/set", &h) != 1 || h < 1 || h > 3) return;
  String msg;
  for (unsigned int i = 0; i < len; i++) msg += (char)payload[i];
  msg.trim();
  msg.toUpperCase();
  uint8_t want;
  if (msg == "ON" || msg == "1" || msg == "TRUE") want = 1;
  else if (msg == "OFF" || msg == "0" || msg == "FALSE") want = 0;
  else { Serial.printf("ignored %s = %s\n", topic, msg.c_str()); return; }
  desired[h] = want;
  Serial.printf("MQTT  house %d light -> %s\n", h, want ? "ON" : "OFF");
  sendCmd(h);
}

void connectMqtt() {
  String id = "scf-gateway-" + WiFi.macAddress();
  // Last Will: if the gateway dies, the broker itself publishes "offline" for it.
  bool ok = MQTT_USER[0]
    ? mqtt.connect(id.c_str(), MQTT_USER, MQTT_PASS, "farm/gateway/status", 1, true, "offline")
    : mqtt.connect(id.c_str(), "farm/gateway/status", 1, true, "offline");
  if (!ok) { Serial.printf("MQTT connect failed, state=%d (เช็ก MQTT_HOST และว่า docker compose up แล้ว)\n", mqtt.state()); return; }
  mqtt.publish("farm/gateway/status", "online", true);
  mqtt.subscribe("farm/house/+/light/set", 1);   // retained: we get the last command right after connecting
  for (int h = 1; h <= 3; h++) published[h] = LED_UNKNOWN;   // republish light states on the new session
  Serial.printf("MQTT connected to %s:%d\n", MQTT_HOST, MQTT_PORT);
}

void publishReading(const Reading& r) {
  char topic[40], body[64];
  snprintf(topic, sizeof topic, "farm/house/%d/telemetry", r.house);
  snprintf(body, sizeof body, "{\"temp\":%.2f,\"humidity\":%.2f}", r.temp, r.humidity);
  bool ok = mqtt.publish(topic, body);
  Serial.printf("House %d  T=%.1f H=%.1f  -> MQTT %s\n", r.house, r.temp, r.humidity, ok ? "ok" : "FAIL");
}

// The node confirmed a light state: tell everyone (retained, so a new web page sees it at once).
void publishAcks() {
  for (int h = 1; h <= 3; h++) {
    uint8_t a = acked[h];
    if (a == LED_UNKNOWN || a == published[h]) continue;
    char topic[40];
    snprintf(topic, sizeof topic, "farm/house/%d/light/state", h);
    if (mqtt.publish(topic, a ? "ON" : "OFF", true)) {
      published[h] = a;
      Serial.printf("ACK   house %d light is %s\n", h, a ? "ON" : "OFF");
    }
  }
}

// ---- Wi-Fi -----------------------------------------------------------------
void connectWifi() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("Connecting to %s", WIFI_SSID);
  for (int i = 1; WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print(".");
    if (i % 40 == 0) Serial.println("\n!! ยังต่อไม่ได้: เช็กฮอตสปอตเปิดอยู่, เป็น 2.4 GHz (iPhone: Maximize Compatibility), ชื่อ/รหัสถูก");
  }
  Serial.printf(" OK  IP=%s  channel=%d\n", WiFi.localIP().toString().c_str(), WiFi.channel());
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  WiFi.mode(WIFI_STA);
  connectWifi();
  esp_wifi_set_ps(WIFI_PS_NONE);   // keep radio awake so ESP-NOW packets are not missed

  if (esp_now_init() != ESP_OK) { Serial.println("ESP-NOW init failed"); while (true) delay(1000); }
  esp_now_register_recv_cb(onRecvCb);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST, 6);
  peer.channel = 0;                // 0 = same channel as the Wi-Fi connection
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  esp_now_add_peer(&peer);

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqtt);
  mqtt.setKeepAlive(15);           // broker notices a dead gateway (and sends the Last Will) within ~20 s
  Serial.printf("Gateway ready. MAC=%s  TEST_MODE=%s\n", WiFi.macAddress().c_str(), TEST_MODE ? "on" : "off");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  unsigned long now = millis();
  if (!mqtt.connected() && now - lastMqttTry >= 3000) { lastMqttTry = now; connectMqtt(); }
  mqtt.loop();   // receives light/set and calls onMqtt()

  for (int h = 1; h <= 3; h++) {
    if (!pending[h]) continue;
    portENTER_CRITICAL(&mux);
    Reading r = latest[h];
    pending[h] = false;
    portEXIT_CRITICAL(&mux);
    if (mqtt.connected()) publishReading(r);
  }
  if (mqtt.connected()) publishAcks();

  if (TEST_MODE && now - lastFake >= FAKE_MS) {
    lastFake = now;
    Reading fake = {1, 1, 30 + random(0, 30) / 10.0f, 60 + random(0, 50) / 10.0f};
    if (mqtt.connected()) publishReading(fake);
  }
  // Resend every house's wanted state: covers lost broadcasts and nodes that rebooted,
  // and doubles as the heartbeat the nodes use to know they are still on the right channel.
  if (now - lastSync >= SYNC_MS) {
    lastSync = now;
    for (int h = 1; h <= 3; h++) { sendCmd(h); delay(5); }
  }
}

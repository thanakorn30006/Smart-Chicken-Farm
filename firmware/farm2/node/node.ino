// Coop node (ตัวลูก) v3: SHT31 + light, talks to its gateway over ESP-NOW with authenticated packets.
//   - sends a reading every 10 s, answers every light command with an ACK (real state of the light)
//   - accepts only LED_CMD packets with a valid HMAC tag (farm key) and a newer counter
// One board per coop: set NODE_ID (1-20) below, then register it in the web (จัดการฟาร์ม > โรงเรือน).
// Libraries: "Adafruit SHT31 Library" (Library Manager, choose Install All).
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_arduino_version.h>
#include <Wire.h>
#include <Adafruit_SHT31.h>
#include "secrets.h"
#include "scf_packet.h"

// ---- settings -------------------------------------------------------------
const uint8_t NODE_ID = 1;             // 1..20, unique per gateway, same number as in the web
const int     LED_PIN = 2;             // on-board LED stands for the coop light
const unsigned long SEND_MS = 10000;   // send a reading
const unsigned long LOST_MS = 15000;   // no valid heartbeat this long -> look for the channel again
// ----------------------------------------------------------------------------

uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
Adafruit_SHT31 sht31;
SecureLink secure;
uint32_t lastGatewayCounter = 0;

const int RING = 8;
Packet ring[RING];
volatile int ringHead = 0, ringTail = 0;
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;

int ledState = -1, shownLed = -1;
bool ackDue = false;
unsigned long lastHeard = 0, lastSend = 0;
uint32_t rejected = 0;

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

void handlePacket(const Packet& p) {
  if (p.type != PKT_LED_CMD) return;                        // other nodes' readings/ACKs are not for us
  if (p.node != NODE_ID && p.node != NODE_ALL) return;
  if (secure.open(p, lastGatewayCounter) != Verdict::OK) {    // fake or replayed command: ignore
    rejected++;
    Serial.printf("!! rejected command (fake or replayed), total %lu\n", (unsigned long)rejected);
    return;
  }
  lastHeard = millis();
  if (p.node == NODE_ID && p.led <= 1) { ledState = p.led; ackDue = true; }
}

void send(Packet& p) {
  p.node = NODE_ID;
  secure.seal(p);
  esp_now_send(BROADCAST, (uint8_t*)&p, sizeof p);
}

// ESP-NOW only works if node and gateway share a channel; the gateway uses the hotspot's channel.
void joinChannel() {
  while (true) {
    int n = WiFi.scanNetworks();
    for (int i = 0; i < n; i++) {
      if (WiFi.SSID(i) == WIFI_SSID) {
        int ch = WiFi.channel(i);
        esp_wifi_set_promiscuous(true);
        esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
        esp_wifi_set_promiscuous(false);
        Serial.printf("Found %s on channel %d\n", WIFI_SSID, ch);
        lastHeard = millis();
        return;
      }
    }
    Serial.printf("!! หา %s ไม่เจอ: เปิดฮอตสปอต + Maximize Compatibility\n", WIFI_SSID);
    delay(3000);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  if (NODE_ID < 1 || NODE_ID > MAX_NODES) { Serial.println("!! NODE_ID must be 1-20"); while (true) delay(1000); }
  if (!secure.begin(FARM_KEY, "scf-node")) { Serial.println("!! FARM_KEY in secrets.h must be 32 hex characters"); while (true) delay(1000); }
  Wire.begin();                                  // SDA = GPIO21, SCL = GPIO22
  if (!sht31.begin(0x44) && !sht31.begin(0x45)) {
    Serial.println("!! ไม่เจอ SHT31: เช็กสาย VIN->3V3, GND->GND, SDA->D21, SCL->D22");
    while (true) delay(1000);
  }
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  joinChannel();
  if (esp_now_init() != ESP_OK) { Serial.println("ESP-NOW init failed"); while (true) delay(1000); }
  esp_now_register_recv_cb(onRecvCb);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST, 6);
  peer.channel = 0;
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  esp_now_add_peer(&peer);
  Serial.printf("Node %d ready\n", NODE_ID);
}

void loop() {
  while (ringTail != ringHead) {
    Packet p;
    portENTER_CRITICAL(&mux);
    p = ring[ringTail];
    ringTail = (ringTail + 1) % RING;
    portEXIT_CRITICAL(&mux);
    handlePacket(p);
  }

  if (ledState >= 0 && ledState != shownLed) {
    shownLed = ledState;
    digitalWrite(LED_PIN, shownLed ? HIGH : LOW);
    Serial.printf("LED from gateway: %s\n", shownLed ? "ON" : "OFF");
  }
  if (ackDue && shownLed >= 0) {                 // report the state the LED is really in
    ackDue = false;
    Packet a = {};
    a.type = PKT_LED_ACK; a.led = (uint8_t)shownLed;
    send(a);
  }

  unsigned long now = millis();
  if (now - lastSend >= SEND_MS) {
    lastSend = now;
    float t = sht31.readTemperature(), h = sht31.readHumidity();
    if (isnan(t) || isnan(h)) Serial.println("!! อ่าน SHT31 ไม่ได้");
    else {
      Packet r = {};
      r.type = PKT_READING; r.led = shownLed < 0 ? LED_UNKNOWN : shownLed; r.temp = t; r.humidity = h;
      send(r);
      Serial.printf("Sent T=%.1f H=%.1f  (gateway heard %lus ago)\n", t, h, (now - lastHeard) / 1000);
    }
  }
  if (millis() - lastHeard > LOST_MS) {
    Serial.println("!! ไม่ได้ยินตัวแม่ (หรือได้แต่แพ็กเก็ตปลอม): หาช่องสัญญาณใหม่");
    joinChannel();
  }
}

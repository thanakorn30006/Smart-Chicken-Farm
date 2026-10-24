// House node (ตัวลูก): reads the SHT31, sends the reading to the gateway over ESP-NOW,
// switches its LED when the gateway forwards a command for this house,
// and answers every command with an ACK so the web shows the light's REAL state.
// It never connects to Wi-Fi: it only scans for the hotspot to learn which channel the gateway is on.
// Library: "Adafruit SHT31 Library" (Library Manager, choose Install All).
// Flash one board per house: change HOUSE_ID to 1, 2 or 3.
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_arduino_version.h>
#include <Wire.h>
#include <Adafruit_SHT31.h>

// ---- settings -------------------------------------------------------------
const int   HOUSE_ID  = 1;
const char* WIFI_SSID = "igus";    // same hotspot as the gateway (used only to find the channel)
const int   LED_PIN   = 2;         // on-board LED
const unsigned long SEND_MS = 10000;   // send a reading
const unsigned long LOST_MS = 15000;   // nothing from the gateway this long -> look for the channel again
// ----------------------------------------------------------------------------

// Messages over ESP-NOW. Must be identical in gateway.ino.
struct __attribute__((packed)) Reading { uint8_t type; uint8_t house; float temp; float humidity; };  // type 1: node -> gateway
struct __attribute__((packed)) LedCmd  { uint8_t type; uint8_t house; uint8_t led; };                 // type 2: gateway -> nodes
struct __attribute__((packed)) LedAck  { uint8_t type; uint8_t house; uint8_t led; };                 // type 3: node -> gateway
const uint8_t LED_UNKNOWN = 255;   // gateway has no command for us yet (heartbeat only)

uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
Adafruit_SHT31 sht31;
volatile int ledState = -1;                // -1 = no command yet
volatile bool ackDue = false;              // a command arrived: answer it from loop()
volatile unsigned long lastHeard = 0;
int shownLed = -1;
unsigned long lastSend = 0;

// The gateway broadcasts a command for every house; keep only ours.
void onReceive(const uint8_t* data, int len) {
  if (len != sizeof(LedCmd)) return;
  LedCmd c;
  memcpy(&c, data, sizeof c);
  if (c.type != 2 || c.house != HOUSE_ID) return;   // type 3 = another node's ACK: not for us
  lastHeard = millis();
  if (c.led > 1) return;                             // LED_UNKNOWN: heartbeat only
  ledState = c.led;
  ackDue = true;
}
#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onRecvCb(const esp_now_recv_info_t*, const uint8_t* data, int len) { onReceive(data, len); }
#else
void onRecvCb(const uint8_t*, const uint8_t* data, int len) { onReceive(data, len); }
#endif

// ESP-NOW only works if node and gateway are on the same channel, and the gateway
// is on whatever channel the hotspot uses. So: find the hotspot, then sit on its channel.
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
    Serial.printf("!! หา %s ไม่เจอ: เปิดฮอตสปอต + Maximize Compatibility + ค้างหน้า Personal Hotspot ไว้\n", WIFI_SSID);
    delay(3000);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  Wire.begin();                                  // SDA = GPIO21, SCL = GPIO22
  if (!sht31.begin(0x44) && !sht31.begin(0x45)) {
    Serial.println("!! ไม่เจอ SHT31: เช็กสาย VIN->3V3, GND->GND, SDA->D21, SCL->D22");
    while (true) delay(1000);
  }
  Serial.println("SHT31 OK");

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  joinChannel();
  if (esp_now_init() != ESP_OK) { Serial.println("ESP-NOW init failed"); while (true) delay(1000); }
  esp_now_register_recv_cb(onRecvCb);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST, 6);
  peer.channel = 0;                              // 0 = current channel
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  esp_now_add_peer(&peer);
  Serial.printf("Node for house %d ready\n", HOUSE_ID);
}

void loop() {
  if (ledState >= 0 && ledState != shownLed) {
    shownLed = ledState;
    digitalWrite(LED_PIN, shownLed ? HIGH : LOW);
    Serial.printf("LED from gateway: %s\n", shownLed ? "ON" : "OFF");
  }
  // Report the state the LED is really in (after switching it), so the gateway can confirm it on MQTT.
  if (ackDue && shownLed >= 0) {
    ackDue = false;
    LedAck a = {3, (uint8_t)HOUSE_ID, (uint8_t)shownLed};
    esp_now_send(BROADCAST, (uint8_t*)&a, sizeof a);
  }

  unsigned long now = millis();
  if (now - lastSend >= SEND_MS) {
    lastSend = now;
    float t = sht31.readTemperature();
    float h = sht31.readHumidity();
    if (isnan(t) || isnan(h)) {
      Serial.println("!! อ่าน SHT31 ไม่ได้");
    } else {
      Reading r = {1, (uint8_t)HOUSE_ID, t, h};
      esp_now_send(BROADCAST, (uint8_t*)&r, sizeof r);
      Serial.printf("Sent T=%.1f H=%.1f  (last heard gateway %lus ago)\n", t, h, (now - lastHeard) / 1000);
    }
  }

  if (millis() - lastHeard > LOST_MS) {
    Serial.println("!! ไม่ได้ยินตัวแม่: หาช่องสัญญาณใหม่");
    joinChannel();
  }
}

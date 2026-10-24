// Gateway (ตัวแม่): receives readings from the 3 house nodes over ESP-NOW,
// uploads them to Supabase, and forwards LED commands from Supabase back to the nodes.
// No extra libraries needed: everything ships with the ESP32 board package.
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_arduino_version.h>

// ---- settings -------------------------------------------------------------
const char* WIFI_SSID    = "igus";           // hotspot name (2.4 GHz)
const char* WIFI_PASS    = "YOUR_WIFI_PASSWORD";
const char* SUPABASE_URL = "https://qagcsesgiixpbyawonuu.supabase.co";
const char* SUPABASE_KEY = "sb_publishable_h6SdQ6nunfjRLbkOWypJTw_RUksTo1n";
const bool  TEST_MODE    = false;  // true = also send fake readings for house 1 (no nodes needed)
const int   LED_PIN      = 2;      // in TEST_MODE the on-board LED mirrors house 1's light
const unsigned long LED_POLL_MS = 2000;
const unsigned long FAKE_MS     = 10000;
// ----------------------------------------------------------------------------

// Messages over ESP-NOW. Must be identical in node.ino.
struct __attribute__((packed)) Reading { uint8_t type; uint8_t house; float temp; float humidity; };  // type 1: node -> gateway
struct __attribute__((packed)) LedCmd  { uint8_t type; uint8_t house; uint8_t led; };                 // type 2: gateway -> nodes

uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
WiFiClientSecure client;
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
Reading latest[4];
volatile bool pending[4] = {false, false, false, false};
unsigned long lastPoll = 0, lastFake = 0;

// Runs inside the Wi-Fi task: only store the reading, upload later in loop().
void onReceive(const uint8_t* data, int len) {
  if (len != sizeof(Reading)) return;
  Reading r;
  memcpy(&r, data, sizeof r);
  if (r.type != 1 || r.house < 1 || r.house > 3) return;
  portENTER_CRITICAL(&mux);
  latest[r.house] = r;
  pending[r.house] = true;
  portEXIT_CRITICAL(&mux);
}
#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onRecvCb(const esp_now_recv_info_t*, const uint8_t* data, int len) { onReceive(data, len); }
#else
void onRecvCb(const uint8_t*, const uint8_t* data, int len) { onReceive(data, len); }
#endif

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

void addAuth(HTTPClient& http) {
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
}

void upload(const Reading& r) {
  HTTPClient http;
  http.begin(client, String(SUPABASE_URL) + "/rest/v1/readings");
  addAuth(http);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");
  String body = "{\"house\":" + String(r.house) + ",\"temp\":" + String(r.temp, 2) +
                ",\"humidity\":" + String(r.humidity, 2) + "}";
  int code = http.POST(body);   // 201 = stored
  Serial.printf("House %d  T=%.1f H=%.1f  -> Supabase %d\n", r.house, r.temp, r.humidity, code);
  http.end();
}

// Reads all 3 LED states and broadcasts one command per house; each node keeps only its own.
void pollLeds() {
  HTTPClient http;
  http.begin(client, String(SUPABASE_URL) + "/rest/v1/leds?select=house,state&order=house");
  addAuth(http);
  int code = http.GET();
  if (code != 200) { Serial.printf("LED poll -> %d\n", code); http.end(); return; }
  String res = http.getString();   // [{"house":1,"state":false}, ...]
  http.end();

  for (int h = 1; h <= 3; h++) {
    int at = res.indexOf("\"house\":" + String(h));
    if (at < 0) continue;
    int st = res.indexOf("\"state\":", at);
    bool on = st >= 0 && res.startsWith("true", st + 8);
    LedCmd cmd = {2, (uint8_t)h, (uint8_t)on};
    esp_now_send(BROADCAST, (uint8_t*)&cmd, sizeof cmd);
    delay(10);
    if (TEST_MODE && h == 1) digitalWrite(LED_PIN, on ? HIGH : LOW);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  client.setInsecure();            // skips certificate check: fine for a class demo
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
  Serial.printf("Gateway ready. MAC=%s  TEST_MODE=%s\n", WiFi.macAddress().c_str(), TEST_MODE ? "on" : "off");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();

  for (int h = 1; h <= 3; h++) {
    if (!pending[h]) continue;
    portENTER_CRITICAL(&mux);
    Reading r = latest[h];
    pending[h] = false;
    portEXIT_CRITICAL(&mux);
    upload(r);
  }

  unsigned long now = millis();
  if (TEST_MODE && now - lastFake >= FAKE_MS) {
    lastFake = now;
    Reading fake = {1, 1, 30 + random(0, 30) / 10.0f, 60 + random(0, 50) / 10.0f};
    upload(fake);
  }
  if (now - lastPoll >= LED_POLL_MS) { lastPoll = now; pollLeds(); }
}

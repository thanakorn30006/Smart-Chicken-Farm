// secrets.h (gateway) - keep private, do not share or commit.
// ./start.sh copies this file to secrets.h and fills it for the first farm (gw1).
// Easiest for any gateway: web > ตั้งค่าบอร์ด > download (secrets.h already filled).
#pragma once
#define WIFI_SSID "YOUR_WIFI_SSID"           // 2.4 GHz Wi-Fi / hotspot
#define WIFI_PASS "YOUR_WIFI_PASSWORD"
#define MQTT_HOST "192.168.1.10"             // IP of the server running ./start.sh (start.sh updates it)
#define MQTT_PORT 1883
#define MQTT_USER "gw1"                      // gateway username = topic prefix scf/<MQTT_USER>/
#define MQTT_PASS "PUT_MQTT_PASSWORD_HERE"
#define FARM_KEY  "PUT_FARM_KEY_HERE"        // 32 hex chars, SAME in every node of this farm

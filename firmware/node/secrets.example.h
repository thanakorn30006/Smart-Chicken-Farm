// secrets.h (node) - keep private, do not share or commit.
// ./start.sh copies this file to secrets.h and fills FARM_KEY. Easiest: web > ตั้งค่าบอร์ด > download.
#pragma once
#define WIFI_SSID "YOUR_WIFI_SSID"           // only used to find the gateway's Wi-Fi channel
#define FARM_KEY  "PUT_FARM_KEY_HERE"        // 32 hex chars, same as the gateway
// #define SCF_NODE_ID 1                     // optional: NODE_ID of this board (otherwise set in node.ino)

// scf_packet.h: the ONE packet format used over ESP-NOW, with message authentication.
// Keep this file IDENTICAL in firmware/gateway and firmware/node.
//
// Security (sensor security):
//   - Every packet carries an 8-byte HMAC-SHA256 tag made with the farm key (FARM_KEY in secrets.h).
//     A board without the key cannot send readings, fake an ACK, or switch a light.
//   - Every sender has a counter that only goes up (kept in flash across reboots).
//     A receiver drops any packet whose counter is not newer than the last one it accepted (replay attack).
//   - Direction is fixed by type: nodes only accept LED_CMD, the gateway only accepts READING / LED_ACK.
#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include "mbedtls/md.h"

enum : uint8_t { PKT_READING = 1, PKT_LED_CMD = 2, PKT_LED_ACK = 3 };
const uint8_t PKT_MAGIC   = 0x5C;
const uint8_t LED_UNKNOWN = 255;   // LED_CMD with no command = heartbeat
const uint8_t NODE_ALL    = 0;     // LED_CMD addressed to every node (heartbeat)
const int     MAX_NODES   = 20;    // node ids 1..20 per gateway

struct __attribute__((packed)) Packet {
  uint8_t  magic;
  uint8_t  type;
  uint8_t  node;      // node id (sender for READING/ACK, target for LED_CMD)
  uint8_t  led;       // 0 off, 1 on, 255 unknown
  uint32_t counter;   // sender's monotonic counter
  float    temp;
  float    humidity;
  uint8_t  tag[8];    // first 8 bytes of HMAC-SHA256(key, all bytes before tag)
};
static_assert(sizeof(Packet) == 24, "Packet must be 24 bytes");

enum class Verdict { OK, BAD_FORMAT, BAD_TAG, REPLAY };

class SecureLink {
 public:
  // keyHex: 32 hex characters (16 bytes). nvsName: flash namespace for the counter.
  bool begin(const char* keyHex, const char* nvsName) {
    keyLen = 0;
    for (size_t i = 0; keyHex[i] && keyHex[i + 1] && keyLen < sizeof(key); i += 2) {
      int hi = hexval(keyHex[i]), lo = hexval(keyHex[i + 1]);
      if (hi < 0 || lo < 0) return false;
      key[keyLen++] = (uint8_t)(hi << 4 | lo);
    }
    if (keyLen < 16) return false;
    prefs.begin(nvsName, false);
    // skip ahead by a block on every boot, so a counter value is never reused even after a crash;
    // flash is written once per BLOCK packets, not on every packet
    counter = prefs.getUInt("ctr", 0);
    reserved = counter + BLOCK;
    prefs.putUInt("ctr", reserved);
    return true;
  }

  void seal(Packet& p) {
    p.magic = PKT_MAGIC;
    if (++counter >= reserved) { reserved = counter + BLOCK; prefs.putUInt("ctr", reserved); }
    p.counter = counter;
    tagOf(p, p.tag);
  }

  // lastCounter: the newest counter accepted from this sender (updated when OK)
  Verdict open(const Packet& p, uint32_t& lastCounter) {
    if (p.magic != PKT_MAGIC) return Verdict::BAD_FORMAT;
    uint8_t want[8];
    tagOf(p, want);
    uint8_t diff = 0;
    for (int i = 0; i < 8; i++) diff |= want[i] ^ p.tag[i];   // constant time compare
    if (diff) return Verdict::BAD_TAG;
    if (p.counter <= lastCounter) return Verdict::REPLAY;
    lastCounter = p.counter;
    return Verdict::OK;
  }

 private:
  static const uint32_t BLOCK = 1000;
  uint8_t key[32];
  size_t keyLen = 0;
  uint32_t counter = 0, reserved = 0;
  Preferences prefs;

  static int hexval(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  }
  void tagOf(const Packet& p, uint8_t out[8]) {
    uint8_t full[32];
    mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), key, keyLen,
                    (const uint8_t*)&p, offsetof(Packet, tag), full);
    memcpy(out, full, 8);
  }
};

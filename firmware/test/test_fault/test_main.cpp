#include <unity.h>
#include <string.h>
#include "tc/TcFault.h"
#include "tc/SimTcDriver.h"
#include "net/DnsReply.h"

using namespace tcf;

void test_max31856_fault_map() {
  TEST_ASSERT_EQUAL_UINT8(TC_OK, faultFromMax31856(0x00));
  TEST_ASSERT_EQUAL_UINT8(TC_OPEN, faultFromMax31856(0x01));
  TEST_ASSERT_EQUAL_UINT8(TC_OVUV, faultFromMax31856(0x02));
  TEST_ASSERT_EQUAL_UINT8(TC_RANGE, faultFromMax31856(0x40));
  TEST_ASSERT_EQUAL_UINT8(TC_RANGE, faultFromMax31856(0x08));
  TEST_ASSERT_EQUAL_UINT8(TC_RANGE, faultFromMax31856(0x04));
  TEST_ASSERT_EQUAL_UINT8(TC_CJ_RANGE, faultFromMax31856(0x80));
  TEST_ASSERT_EQUAL_UINT8(TC_CJ_RANGE, faultFromMax31856(0x20));
  TEST_ASSERT_EQUAL_UINT8(TC_CJ_RANGE, faultFromMax31856(0x10));
  TEST_ASSERT_EQUAL_UINT8(TC_OPEN, faultFromMax31856(0xFF));       // 優先順位: OPEN が最優先
  TEST_ASSERT_EQUAL_UINT8(TC_OVUV, faultFromMax31856(0xFE));
  TEST_ASSERT_EQUAL_UINT8(TC_RANGE, faultFromMax31856(0xFC));
}
void test_max31855_fault_map() {
  TEST_ASSERT_EQUAL_UINT8(TC_OK, faultFromMax31855(0x01900000u));
  TEST_ASSERT_EQUAL_UINT8(TC_OPEN, faultFromMax31855(0x00010001u));
  TEST_ASSERT_EQUAL_UINT8(TC_SHORT_GND, faultFromMax31855(0x00010002u));
  TEST_ASSERT_EQUAL_UINT8(TC_SHORT_VCC, faultFromMax31855(0x00010004u));
  TEST_ASSERT_EQUAL_UINT8(TC_NO_DEVICE, faultFromMax31855(0u));
  TEST_ASSERT_EQUAL_UINT8(TC_NO_DEVICE, faultFromMax31855(0xFFFFFFFFu));
}
void test_absent_device() {
  uint8_t z[16] = {0}, f[16]; memset(f, 0xFF, 16);
  uint8_t ok[16] = {0x91, 0x23, 0xFF, 0x7F, 0xC0, 0x7F, 0xFF, 0x80, 0, 0, 0x19, 0x00, 0x0C, 0x80, 0x00, 0x00};
  TEST_ASSERT_TRUE(looksAbsent(z)); TEST_ASSERT_TRUE(looksAbsent(f)); TEST_ASSERT_FALSE(looksAbsent(ok));
}
void test_raw_conversion() {
  // 25.0℃ = 3200 LSB(0.0078125) → 19bit 3200 << 5 = 0x019000
  TEST_ASSERT_EQUAL_FLOAT(25.0f, tcFromRaw(0x01, 0x90, 0x00));
  // -10℃ = -1280 LSB。19bit 2の補数 → 24bit 左詰め
  int32_t v = (-1280) & 0x7FFFF; v <<= 5;
  TEST_ASSERT_EQUAL_FLOAT(-10.0f, tcFromRaw((v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF));
  // 冷接点 25℃ = 1600 LSB(0.015625) → 14bit 左詰め
  TEST_ASSERT_EQUAL_FLOAT(25.0f, cjFromRaw((1600 << 2) >> 8, (1600 << 2) & 0xFF));
  TEST_ASSERT_EQUAL_FLOAT(-5.0f, cjFromRaw((uint8_t)(((-320) << 2) >> 8), (uint8_t)(((-320) << 2) & 0xFF)));
}
void test_register_values() {
  TEST_ASSERT_EQUAL_HEX8(0x91, cr0Value(50));   // 連続 + OCFAULT=01 + 50Hz
  TEST_ASSERT_EQUAL_HEX8(0x90, cr0Value(60));
  TEST_ASSERT_EQUAL_HEX8(0x03, cr1Value(1));
  TEST_ASSERT_EQUAL_HEX8(0x13, cr1Value(2));
  TEST_ASSERT_EQUAL_HEX8(0x23, cr1Value(4));    // 既定
  TEST_ASSERT_EQUAL_HEX8(0x33, cr1Value(8));
  TEST_ASSERT_EQUAL_HEX8(0x43, cr1Value(16));
  TEST_ASSERT_TRUE(cr0Matches(0x91 | 0x40 | 0x02, 50));  // 1SHOT/FAULTCLR は無視
  TEST_ASSERT_FALSE(cr0Matches(0x90, 50));
}
void test_stale_detector() {
  StaleDetector d;
  for (int i = 0; i < 11; i++) TEST_ASSERT_FALSE(d.feed(0x1234, 4));
  TEST_ASSERT_FALSE(d.feed(0x1234, 4));          // 1 回目は基準、同値が 12 回続いてから
  bool st = false; for (int i = 0; i < 3; i++) st = d.feed(0x1234, 4);
  TEST_ASSERT_TRUE(st);
  TEST_ASSERT_FALSE(d.feed(0x1235, 4));          // 変わったら復帰
  StaleDetector e; bool any = false;
  for (int i = 0; i < 20; i++) any |= e.feed(7, 16);  // avg16 はしきい値が長い
  TEST_ASSERT_FALSE(any);
}

static uint32_t g_now = 0;
static uint32_t nowFn() { return g_now; }
void test_sim_driver() {
  SimTcDriver d(0, nowFn);
  TcReading r;
  g_now = 0; d.read(r);
  TEST_ASSERT_EQUAL_UINT8(TC_OK, r.fault);
  TEST_ASSERT_TRUE(r.tempC > 15 && r.tempC < 240);
  g_now = 75000; d.read(r);
  TEST_ASSERT_TRUE(r.tempC > 15 && r.tempC < 240);
  d.injectFault(TC_OPEN, 3000);
  g_now = 75500; d.read(r);
  TEST_ASSERT_EQUAL_UINT8(TC_OPEN, r.fault);
  g_now = 78500; d.read(r);
  TEST_ASSERT_EQUAL_UINT8(TC_OK, r.fault);
}

static size_t mkq(uint8_t* b, const char* name, uint16_t qtype) {
  size_t o = 0;
  b[o++] = 0x12; b[o++] = 0x34; b[o++] = 0x01; b[o++] = 0x00; b[o++] = 0; b[o++] = 1; b[o++] = 0; b[o++] = 0; b[o++] = 0; b[o++] = 0; b[o++] = 0; b[o++] = 0;
  const char* p = name;
  while (*p) { const char* dot = strchr(p, '.'); size_t l = dot ? (size_t)(dot - p) : strlen(p); b[o++] = (uint8_t)l; memcpy(b + o, p, l); o += l; p += l; if (dot) p++; }
  b[o++] = 0; b[o++] = qtype >> 8; b[o++] = qtype & 0xFF; b[o++] = 0; b[o++] = 1;
  return o;
}
void test_dns_only_roast() {
  static const uint8_t ip[4] = {192, 168, 4, 1};
  uint8_t q[128], out[256];
  size_t n = mkq(q, "roast.local", 1);
  size_t m = dnsBuildReply(q, n, "roast", ip, out, sizeof out);
  TEST_ASSERT_TRUE(m > n);
  TEST_ASSERT_EQUAL_HEX8(0x12, out[0]); TEST_ASSERT_EQUAL_HEX8(0x34, out[1]);
  TEST_ASSERT_EQUAL_HEX8(0x80, out[2] & 0x80);
  TEST_ASSERT_EQUAL_HEX8(0, out[3] & 0x0F);
  TEST_ASSERT_EQUAL_UINT8(1, out[7]);
  TEST_ASSERT_EQUAL_MEMORY(ip, out + m - 4, 4);
  n = mkq(q, "Roast", 1);                         // 大文字小文字は無視、".local" 無しも可
  TEST_ASSERT_TRUE(dnsBuildReply(q, n, "roast", ip, out, sizeof out) > n);
  n = mkq(q, "roast.local", 28);                  // AAAA: 名前はあるがデータ無し
  m = dnsBuildReply(q, n, "roast", ip, out, sizeof out);
  TEST_ASSERT_EQUAL_size_t(n, m); TEST_ASSERT_EQUAL_UINT8(0, out[7]); TEST_ASSERT_EQUAL_UINT8(0, out[3] & 0x0F);
  n = mkq(q, "captive.apple.com", 1);             // 他の名前は NXDOMAIN
  m = dnsBuildReply(q, n, "roast", ip, out, sizeof out);
  TEST_ASSERT_EQUAL_size_t(n, m); TEST_ASSERT_EQUAL_UINT8(3, out[3] & 0x0F); TEST_ASSERT_EQUAL_UINT8(0, out[7]);
  n = mkq(q, "roast.example.com", 1);
  dnsBuildReply(q, n, "roast", ip, out, sizeof out);
  TEST_ASSERT_EQUAL_UINT8(3, out[3] & 0x0F);
  TEST_ASSERT_EQUAL_size_t(0, dnsBuildReply(q, 5, "roast", ip, out, sizeof out));  // 壊れたパケット
  q[2] |= 0x80;                                    // 応答パケットは無視
  TEST_ASSERT_EQUAL_size_t(0, dnsBuildReply(q, n, "roast", ip, out, sizeof out));
}

void setUp() {}
void tearDown() {}
int main() {
  UNITY_BEGIN();
  RUN_TEST(test_max31856_fault_map);
  RUN_TEST(test_max31855_fault_map);
  RUN_TEST(test_absent_device);
  RUN_TEST(test_raw_conversion);
  RUN_TEST(test_register_values);
  RUN_TEST(test_stale_detector);
  RUN_TEST(test_sim_driver);
  RUN_TEST(test_dns_only_roast);
  return UNITY_END();
}

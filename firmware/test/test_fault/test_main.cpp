#include <unity.h>
#include <string.h>
#include <stdio.h>
#include "tc/TcFault.h"
#include "tc/SimTcDriver.h"
#include "net/DnsReply.h"
#include "tc/Max31855Decode.h"

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

// ---- MAX31855 + NIST 補正
// NIST 表の値（mV、基準接点 0℃）: 20℃=0.798 30℃=1.203 100℃=4.096 200℃=8.138 250℃=10.153 300℃=12.209
void test_nist_forward_inverse() {
  struct { double t, mv; } tab[] = {{20, 0.798}, {30, 1.203}, {100, 4.096}, {200, 8.138}, {250, 10.153}, {300, 12.209}, {-100, -3.554}};
  for (auto& e : tab) {
    TEST_ASSERT_DOUBLE_WITHIN(0.002, e.mv, nistk::mvFromC(e.t));
    TEST_ASSERT_DOUBLE_WITHIN(0.06, e.t, nistk::cFromMv(e.mv));
  }
}
void test_max31855_nist_correction_within_02() {
  double cjs[] = {20, 30};
  struct { double t, mv; } tab[] = {{100, 4.096}, {200, 8.138}, {250, 10.153}, {300, 12.209}};
  double cjMv[] = {0.798, 1.203};
  for (int k = 0; k < 2; k++) {
    for (auto& e : tab) {
      // チップの動作: 熱電対の電圧 V = E(T) - E(Tcj) を 41.276µV/℃ で割り、冷接点温度を足して出す
      double tLin = (e.mv - cjMv[k]) / 0.041276 + cjs[k];
      uint32_t w = max31855::encodeForTest(tLin, cjs[k]);
      TcReading r = max31855::decode(w);
      TEST_ASSERT_EQUAL_UINT8(TC_OK, r.fault);
      char msg[64]; snprintf(msg, sizeof msg, "T=%g cj=%g lin=%.2f got=%.3f", e.t, cjs[k], tLin, r.tempC);
      TEST_ASSERT_FLOAT_WITHIN_MESSAGE(0.2f, (float)e.t, r.tempC, msg);
      TEST_ASSERT_FLOAT_WITHIN(0.07f, (float)cjs[k], r.cjC);
      // 補正しないと誤差が大きいことも確かめる（250℃付近で数℃）
      if (e.t == 300) TEST_ASSERT_TRUE(fabs(tLin - e.t) > 1.0);
    }
  }
}
void test_max31855_decode_bits() {
  // 25℃ / 冷接点 25℃（補正しても 25℃付近）
  TcReading r = max31855::decode(max31855::encodeForTest(25.0, 25.0));
  TEST_ASSERT_EQUAL_UINT8(TC_OK, r.fault); TEST_ASSERT_FLOAT_WITHIN(0.05f, 25.0f, r.tempC);
  // 負の値: -10℃ / 冷接点 -5℃
  TEST_ASSERT_FLOAT_WITHIN(0.01f, -10.0f, max31855::rawTc(max31855::encodeForTest(-10.0, -5.0)));
  TEST_ASSERT_FLOAT_WITHIN(0.01f, -5.0f, max31855::rawCj(max31855::encodeForTest(-10.0, -5.0)));
  // 故障: D16 + D0/D1/D2
  uint32_t base = max31855::encodeForTest(25.0, 25.0);
  TEST_ASSERT_EQUAL_UINT8(TC_OPEN, max31855::decode(base | 0x10000u | 1u).fault);
  TEST_ASSERT_EQUAL_UINT8(TC_SHORT_GND, max31855::decode(base | 0x10000u | 2u).fault);
  TEST_ASSERT_EQUAL_UINT8(TC_SHORT_VCC, max31855::decode(base | 0x10000u | 4u).fault);
  TEST_ASSERT_TRUE(isnan(max31855::decode(base | 0x10000u | 1u).tempC));
  TEST_ASSERT_EQUAL_UINT8(TC_NO_DEVICE, max31855::decode(0u).fault);
  TEST_ASSERT_EQUAL_UINT8(TC_NO_DEVICE, max31855::decode(0xFFFFFFFFu).fault);
  // 内部温度 >125℃ は基板温度異常
  TEST_ASSERT_EQUAL_UINT8(TC_CJ_RANGE, max31855::decode(max31855::encodeForTest(200.0, 126.0)).fault);
  // 熱電対の範囲外（チップの上限 1800℃相当の生値）
  TEST_ASSERT_EQUAL_UINT8(TC_RANGE, max31855::decode(max31855::encodeForTest(1600.0, 25.0)).fault);
}

// MAX31855: 生の 32bit が MAX31855_STALE_READS 回（250ms x 80 = 20 秒）変わらなければ更新停止（SPEC 9.6）
void test_max31855_stale_detector() {
  StaleDetector d;
  uint32_t w = max31855::encodeForTest(200.0, 25.0);
  bool stale = false; int first = -1;
  for (int i = 0; i < 200; i++) { if (d.feedN(w, MAX31855_STALE_READS) && !stale) { stale = true; first = i; } }
  TEST_ASSERT_TRUE(stale);
  TEST_ASSERT_EQUAL(MAX31855_STALE_READS, first);          // 最初の 1 回 + 80 回同じ値
  // 値が 1bit でも動けば解除。動き続けるあいだは検出しない
  TEST_ASSERT_FALSE(d.feedN(w + (1u << 18), MAX31855_STALE_READS));
  StaleDetector e;
  for (int i = 0; i < 1000; i++) TEST_ASSERT_FALSE(e.feedN(w + ((i / 40) & 1) * (1u << 18), MAX31855_STALE_READS));   // 10 秒ごとに 0.25℃ 動く = 正常
  e.reset(); TEST_ASSERT_FALSE(e.feedN(w, MAX31855_STALE_READS));
}

// MAX31856: 50/60Hz を書き換えるときは CMODE=0 にしてから書き、連続変換に戻す（SPEC 9.6 B8）
void test_max31856_config_sequence_cmode() {
  struct W { uint8_t a, v; };
  W log[8]; int n = 0;
  applyConfigSequence([&](uint8_t a, uint8_t v) { if (n < 8) log[n++] = {a, v}; }, 60, 4);
  TEST_ASSERT_EQUAL(3, n);
  TEST_ASSERT_EQUAL(0x00, log[0].a); TEST_ASSERT_EQUAL(0, log[0].v & 0x80);        // 最初の CR0 は CMODE=0
  TEST_ASSERT_EQUAL(0x00, log[0].v & 0x01);                                        // 60Hz
  TEST_ASSERT_EQUAL(0x01, log[1].a); TEST_ASSERT_EQUAL(cr1Value(4), log[1].v);
  TEST_ASSERT_EQUAL(0x00, log[2].a); TEST_ASSERT_EQUAL(0x80, log[2].v & 0x80);     // 最後の CR0 は CMODE=1（連続）
  TEST_ASSERT_EQUAL(cr0Value(60), log[2].v);
  n = 0; applyConfigSequence([&](uint8_t a, uint8_t v) { if (n < 8) log[n++] = {a, v}; }, 50, 16);
  TEST_ASSERT_EQUAL(0x01, log[0].v & 0x01); TEST_ASSERT_EQUAL(0, log[0].v & 0x80);
  TEST_ASSERT_EQUAL(cr0Value(50), log[2].v);
  TEST_ASSERT_TRUE(cr0Matches(log[2].v, 50));
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
  RUN_TEST(test_max31855_stale_detector);
  RUN_TEST(test_max31856_config_sequence_cmode);
  RUN_TEST(test_sim_driver);
  RUN_TEST(test_dns_only_roast);
  RUN_TEST(test_nist_forward_inverse);
  RUN_TEST(test_max31855_nist_correction_within_02);
  RUN_TEST(test_max31855_decode_bits);
  return UNITY_END();
}

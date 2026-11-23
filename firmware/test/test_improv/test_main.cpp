// Improv Serial のパケット（SPEC 9.6）と、STA のつなぎ直しの時機の試験
#include <unity.h>
#include <string>
#include <vector>
#include "net/Improv.h"
#include "net/StaRetry.h"

static std::string cmdPacket(uint8_t cmd, const std::string& payload) {
  std::string d; d += (char)cmd; d += (char)payload.size(); d += payload;
  std::string p = "IMPROV"; p += (char)1; p += (char)3; p += (char)d.size(); p += d;
  uint8_t sum = 0; for (unsigned char c : p) sum = (uint8_t)(sum + c);
  p += (char)sum; return p;
}
static std::string wifiPayload(const std::string& ssid, const std::string& pass) {
  std::string s; s += (char)ssid.size(); s += ssid; s += (char)pass.size(); s += pass; return s;
}
static bool feedAll(ImprovSerial& im, const std::string& bytes, ImprovSerial::Rpc& out) {
  bool got = false;
  for (unsigned char c : bytes) if (im.feed(c, out)) got = true;
  return got;
}

void test_build_state_and_error_packets() {
  // 公式のサンプル: Ready の状態パケット  IMPROV 01 01 01 02 + checksum
  std::string p = ImprovSerial::state(ImprovSerial::ST_READY);
  TEST_ASSERT_EQUAL(11, (int)p.size());
  TEST_ASSERT_EQUAL_STRING_LEN("IMPROV", p.c_str(), 6);
  TEST_ASSERT_EQUAL(1, (int)(uint8_t)p[6]); TEST_ASSERT_EQUAL(1, (int)(uint8_t)p[7]); TEST_ASSERT_EQUAL(1, (int)(uint8_t)p[8]); TEST_ASSERT_EQUAL(2, (int)(uint8_t)p[9]);
  uint8_t sum = 0; for (size_t i = 0; i + 1 < p.size(); i++) sum = (uint8_t)(sum + (uint8_t)p[i]);
  TEST_ASSERT_EQUAL((int)sum, (int)(uint8_t)p.back());
  std::string e = ImprovSerial::error(ImprovSerial::ERR_UNABLE_CONNECT);
  TEST_ASSERT_EQUAL(2, (int)(uint8_t)e[7]); TEST_ASSERT_EQUAL(3, (int)(uint8_t)e[9]);
}

void test_parse_wifi_command() {
  ImprovSerial im; ImprovSerial::Rpc r;
  TEST_ASSERT_TRUE(feedAll(im, cmdPacket(0x01, wifiPayload("MyHome", "secret123")), r));
  TEST_ASSERT_EQUAL(ImprovSerial::CMD_WIFI, r.cmd);
  TEST_ASSERT_EQUAL_STRING("MyHome", r.ssid.c_str()); TEST_ASSERT_EQUAL_STRING("secret123", r.pass.c_str());
  // 鍵なしの Wi-Fi（パスワードが空）
  TEST_ASSERT_TRUE(feedAll(im, cmdPacket(0x01, wifiPayload("Cafe", "")), r));
  TEST_ASSERT_EQUAL_STRING("Cafe", r.ssid.c_str()); TEST_ASSERT_EQUAL(0, (int)r.pass.size());
}

void test_parse_other_commands_and_noise() {
  ImprovSerial im; ImprovSerial::Rpc r;
  // 先に JSON の行が流れていても、IMPROV の頭を探して読む
  std::string noise = "{\"type\":\"s\",\"seq\":12}\nIIMPRIMPROV";   // 'IMPROV' の手前に似た文字
  for (unsigned char c : noise) TEST_ASSERT_FALSE(im.feed(c, r));
  // 上のノイズの末尾が "IMPROV" で終わっているので、続きのパケット（version 以降）をつなげる
  std::string full = cmdPacket(0x03, "");
  TEST_ASSERT_TRUE(feedAll(im, full.substr(6), r));
  TEST_ASSERT_EQUAL(ImprovSerial::CMD_GET_STATE, r.cmd);
  TEST_ASSERT_TRUE(feedAll(im, cmdPacket(0x04, ""), r)); TEST_ASSERT_EQUAL(ImprovSerial::CMD_GET_INFO, r.cmd);
  TEST_ASSERT_TRUE(feedAll(im, cmdPacket(0x02, ""), r)); TEST_ASSERT_EQUAL(ImprovSerial::CMD_IDENTIFY, r.cmd);
  TEST_ASSERT_TRUE(feedAll(im, cmdPacket(0x05, ""), r)); TEST_ASSERT_EQUAL(ImprovSerial::CMD_SCAN, r.cmd);
}

void test_bad_checksum_and_bad_lengths() {
  ImprovSerial im; ImprovSerial::Rpc r;
  std::string p = cmdPacket(0x01, wifiPayload("a", "bbbbbbbb")); p.back() = (char)(p.back() + 1);
  TEST_ASSERT_FALSE(feedAll(im, p, r));
  TEST_ASSERT_EQUAL(ImprovSerial::ERR_INVALID_RPC, im.takeError());
  TEST_ASSERT_EQUAL(ImprovSerial::ERR_NONE, im.takeError());
  // ssid の長さが全体より長い
  std::string bad; bad += (char)10; bad += "ab";
  TEST_ASSERT_FALSE(feedAll(im, cmdPacket(0x01, bad), r));
  TEST_ASSERT_EQUAL(ImprovSerial::ERR_INVALID_RPC, im.takeError());
  // 知らない命令
  TEST_ASSERT_FALSE(feedAll(im, cmdPacket(0x77, ""), r));
  TEST_ASSERT_EQUAL(ImprovSerial::ERR_UNKNOWN_RPC, im.takeError());
  // そのあとも普通に読める
  TEST_ASSERT_TRUE(feedAll(im, cmdPacket(0x03, ""), r));
}

void test_result_packet() {
  std::string p = ImprovSerial::result(ImprovSerial::CMD_WIFI, {"http://192.168.1.20"});
  TEST_ASSERT_EQUAL(4, (int)(uint8_t)p[7]);                       // RPC 結果
  TEST_ASSERT_EQUAL(1, (int)(uint8_t)p[9]);                       // 命令 ID
  TEST_ASSERT_EQUAL(1 + 19, (int)(uint8_t)p[10]);                 // 文字列の長さ 1 + 本体
  TEST_ASSERT_EQUAL(19, (int)(uint8_t)p[11]);
  TEST_ASSERT_EQUAL_STRING_LEN("http://192.168.1.20", p.c_str() + 12, 19);
  uint8_t sum = 0; for (size_t i = 0; i + 1 < p.size(); i++) sum = (uint8_t)(sum + (uint8_t)p[i]);
  TEST_ASSERT_EQUAL((int)sum, (int)(uint8_t)p.back());
  std::string e = ImprovSerial::resultEmpty(ImprovSerial::CMD_SCAN);
  TEST_ASSERT_EQUAL(5, (int)(uint8_t)e[9]); TEST_ASSERT_EQUAL(0, (int)(uint8_t)e[10]);
}

// ---- STA のつなぎ直し
void test_sta_retry_policy() {
  StaRetry r; r.armAt(1000);
  TEST_ASSERT_FALSE(r.shouldStart(1000 + STA_RETRY_PERIOD_MS - 1, true, 0, false));   // まだ
  TEST_ASSERT_TRUE(r.shouldStart(1000 + STA_RETRY_PERIOD_MS, true, 0, false));
  TEST_ASSERT_FALSE(r.shouldStart(1000 + STA_RETRY_PERIOD_MS, false, 0, false));      // 保存済みの Wi-Fi が無い
  TEST_ASSERT_FALSE(r.shouldStart(1000 + STA_RETRY_PERIOD_MS, true, 1, false));       // AP に誰かつないでいる
  TEST_ASSERT_FALSE(r.shouldStart(1000 + STA_RETRY_PERIOD_MS, true, 0, true));        // 焙煎中
  uint32_t t = 1000 + STA_RETRY_PERIOD_MS;
  r.started(t);
  TEST_ASSERT_TRUE(r.trying());
  TEST_ASSERT_FALSE(r.shouldStart(t + STA_RETRY_PERIOD_MS * 2, true, 0, false));      // 試行中は始めない
  TEST_ASSERT_FALSE(r.timedOut(t + STA_CONNECT_TIMEOUT_MS - 1));
  TEST_ASSERT_TRUE(r.timedOut(t + STA_CONNECT_TIMEOUT_MS));
  r.finished(t + STA_CONNECT_TIMEOUT_MS);
  TEST_ASSERT_FALSE(r.trying());
  TEST_ASSERT_FALSE(r.shouldStart(t + STA_CONNECT_TIMEOUT_MS + 1000, true, 0, false));  // 失敗後はまた 1 分待つ
  TEST_ASSERT_TRUE(r.shouldStart(t + STA_CONNECT_TIMEOUT_MS + STA_RETRY_PERIOD_MS, true, 0, false));
}
void test_sta_retry_millis_wrap() {
  StaRetry r; r.armAt(0xFFFFFFFFu - 100);
  TEST_ASSERT_FALSE(r.shouldStart(0xFFFFFFFFu, true, 0, false));
  TEST_ASSERT_TRUE(r.shouldStart(STA_RETRY_PERIOD_MS - 101, true, 0, false));   // millis が一周しても動く
}

void setUp() {}
void tearDown() {}
int main() {
  UNITY_BEGIN();
  RUN_TEST(test_build_state_and_error_packets); RUN_TEST(test_parse_wifi_command); RUN_TEST(test_parse_other_commands_and_noise);
  RUN_TEST(test_bad_checksum_and_bad_lengths); RUN_TEST(test_result_packet);
  RUN_TEST(test_sta_retry_policy); RUN_TEST(test_sta_retry_millis_wrap);
  return UNITY_END();
}

// WsHub の中身（HubCore）の試験。SPEC 9.6 B4 / B5
//  - 接続の数は自前で数える（5 台目は受け付けない）
//  - open / close の知らせはあふれない（メッセージのキューがあふれても、接続の枠は狂わない）
//  - close の知らせを落としても、1 秒ごとの片付けで実体の無い枠が消える
//  - メッセージのキューがあふれたら捨てる（数える）
#include <unity.h>
#include <string>
#include <vector>
#include <string.h>
#include <ArduinoJson.h>
#include "net/HubCore.h"

struct Out { uint32_t id; std::string text; };
struct TestSink : Sink {
  std::vector<Out> log;
  bool canSend(uint32_t) override { return true; }
  void send(uint32_t id, const std::string& t) override { log.push_back({id, t}); }
};
struct FakeTransport : HubTransport {
  std::vector<uint32_t> dead, closed;
  bool alive(uint32_t id) override { for (auto d : dead) if (d == id) return false; return true; }
  void close(uint32_t id) override { closed.push_back(id); }
  void kill(uint32_t id) { dead.push_back(id); }
};

static DeviceInfo mkInfo() { DeviceInfo d; d.fw = "0.1.0"; d.model = "RL-C3-3"; d.amp = "sim"; strcpy(d.id, "a4cf12"); strcpy(d.bootId, "9f31c2aa"); return d; }

struct Fix {
  DeviceInfo di = mkInfo(); Ring ring; DeviceConfig cfg; ProtocolEngine eng; TestSink sink; FakeTransport tr; HubCore hub; uint32_t now = 100000;
  Fix() : eng(di, ring, cfg) { cfgDefaults(cfg); }
  void loop(uint32_t adv = 0) { now += adv; hub.loop(now, eng, sink, tr); }
  void data(uint32_t id, const char* j) { hub.onData(id, (const uint8_t*)j, strlen(j)); }
  bool connect(uint32_t id) { return hub.onConnect(id); }
};
static const char* HI = "{\"type\":\"hi\",\"app\":\"a\",\"ver\":\"1\",\"bootId\":null,\"lastSeq\":null}";

void test_max_four_clients_counted_without_ws_count() {
  Fix f;
  for (uint32_t i = 1; i <= 4; i++) TEST_ASSERT_TRUE(f.connect(i));
  TEST_ASSERT_FALSE(f.connect(5));                 // 5 台目は受け付けない（呼び出し側で閉じる）
  TEST_ASSERT_EQUAL(4, f.hub.liveCount());
  f.loop();
  TEST_ASSERT_EQUAL(4, f.eng.clientCount());
  f.hub.onDisconnect(2);
  TEST_ASSERT_EQUAL(3, f.hub.liveCount());
  TEST_ASSERT_TRUE(f.connect(6));                  // 空いたので入れる
  f.loop();                                        // close を先に処理するので engine の枠が足りなくならない
  TEST_ASSERT_EQUAL(4, f.eng.clientCount());
  TEST_ASSERT_TRUE(f.eng.hasClient(6)); TEST_ASSERT_FALSE(f.eng.hasClient(2));
  TEST_ASSERT_EQUAL(0, (int)f.tr.closed.size());
}

void test_connect_then_hi_gets_hello() {
  Fix f; f.connect(1); f.data(1, HI); f.loop();
  TEST_ASSERT_EQUAL(1, (int)f.sink.log.size());
  JsonDocument d; deserializeJson(d, f.sink.log[0].text);
  TEST_ASSERT_EQUAL_STRING("hello", d["type"]);
}

// メッセージのキューがあふれても、接続の出入りは失われない
void test_msg_queue_overflow_does_not_break_slots() {
  Fix f;
  f.connect(1); f.connect(2);
  int accepted = 0;
  for (int i = 0; i < 50; i++) if (f.hub.onData(1, (const uint8_t*)HI, strlen(HI))) accepted++;
  TEST_ASSERT_TRUE(accepted < 50);                         // あふれた分は捨てる
  TEST_ASSERT_EQUAL(50 - accepted, (int)f.hub.droppedMsgs());
  TEST_ASSERT_TRUE(accepted <= HubCore::QN - 1);
  f.hub.onDisconnect(2);                                   // キューが満杯でも close は表に残る
  f.connect(3);                                            // open も同じ
  f.loop();
  TEST_ASSERT_FALSE(f.eng.hasClient(2));                   // close は落ちていない
  TEST_ASSERT_TRUE(f.eng.hasClient(3));                    // open も落ちていない
  TEST_ASSERT_TRUE(f.eng.hasClient(1));
  // キューは空いたので、また受け付ける
  TEST_ASSERT_TRUE(f.hub.onData(1, (const uint8_t*)HI, strlen(HI)));
  TEST_ASSERT_FALSE(f.hub.onData(1, (const uint8_t*)HI, HubCore::MSG_MAX + 1));   // 大きすぎるメッセージは捨てる
}

// close の知らせが来なかった（ライブラリが DISCONNECT を呼ばなかった）接続は、1 秒ごとの片付けで消える
void test_sweep_removes_slot_without_close_event() {
  Fix f;
  for (uint32_t i = 1; i <= 4; i++) f.connect(i);
  f.loop();
  TEST_ASSERT_EQUAL(4, f.eng.clientCount());
  f.tr.kill(3);                                            // 実体は消えたが、onDisconnect は来ない
  f.loop(100);                                             // まだ 1 秒たっていない
  TEST_ASSERT_TRUE(f.eng.hasClient(3));
  f.loop(1000);                                            // 1 秒たった
  TEST_ASSERT_FALSE(f.eng.hasClient(3));
  TEST_ASSERT_EQUAL(3, f.eng.clientCount());
  TEST_ASSERT_EQUAL(1, (int)f.hub.sweptSlots());
  TEST_ASSERT_EQUAL(3, f.hub.liveCount());
  TEST_ASSERT_TRUE(f.connect(7));                          // 枠が戻っているので新しい接続を受けられる
  f.loop(); TEST_ASSERT_TRUE(f.eng.hasClient(7));
}

// 表を経由しないまま engine に残った枠（不整合）も片付ける
void test_sweep_removes_orphan_engine_slot() {
  Fix f;
  f.connect(1); f.loop();                                  // 最初の loop で 1 回片付けが走る
  f.eng.onOpen(99, f.now);                                 // 表に無い
  f.loop(100);
  TEST_ASSERT_TRUE(f.eng.hasClient(99));
  f.loop(1000);
  TEST_ASSERT_FALSE(f.eng.hasClient(99));
  TEST_ASSERT_TRUE(f.eng.hasClient(1));
}

// 切断が来てから、open が処理される前に消えた接続は engine に伝えない
void test_connect_and_disconnect_before_loop() {
  Fix f;
  f.connect(1); f.hub.onDisconnect(1); f.loop();
  TEST_ASSERT_FALSE(f.eng.hasClient(1)); TEST_ASSERT_EQUAL(0, f.eng.clientCount()); TEST_ASSERT_EQUAL(0, f.hub.liveCount());
}

// engine が受け付けなかった（枠が無い）接続は閉じる
void test_engine_full_closes_transport() {
  Fix f;
  for (uint32_t i = 1; i <= 4; i++) f.eng.onOpen(100 + i, f.now);   // engine の枠を先に埋めておく
  f.connect(1); f.loop();
  TEST_ASSERT_EQUAL(1, (int)f.tr.closed.size()); TEST_ASSERT_EQUAL(1, (int)f.tr.closed[0]);
}

// 同じ id の DISCONNECT が 2 回来ても枠が壊れない
void test_double_disconnect() {
  Fix f; f.connect(1); f.loop(); f.hub.onDisconnect(1); f.hub.onDisconnect(1); f.loop();
  TEST_ASSERT_EQUAL(0, f.eng.clientCount()); TEST_ASSERT_EQUAL(0, f.hub.liveCount());
  f.connect(2); f.loop(); TEST_ASSERT_TRUE(f.eng.hasClient(2));
}

void setUp() {}
void tearDown() {}
int main() {
  UNITY_BEGIN();
  RUN_TEST(test_max_four_clients_counted_without_ws_count); RUN_TEST(test_connect_then_hi_gets_hello);
  RUN_TEST(test_msg_queue_overflow_does_not_break_slots); RUN_TEST(test_sweep_removes_slot_without_close_event);
  RUN_TEST(test_sweep_removes_orphan_engine_slot); RUN_TEST(test_connect_and_disconnect_before_loop);
  RUN_TEST(test_engine_full_closes_transport); RUN_TEST(test_double_disconnect);
  return UNITY_END();
}

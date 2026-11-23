#include <unity.h>
#include <string>
#include <vector>
#include <string.h>
#include <ArduinoJson.h>
#include "net/WsProtocol.h"

// ---- 送信を記録する Sink
struct Out { uint32_t id; std::string text; };
struct TestSink : Sink {
  std::vector<Out> log;
  bool can = true;
  bool canSend(uint32_t) override { return can; }
  void send(uint32_t id, const std::string& t) override { log.push_back({id, t}); }
  void clear() { log.clear(); }
};

static DeviceInfo mkInfo() {
  DeviceInfo d; d.fw = "0.1.0"; d.model = "RL-C3-3"; d.amp = "max31856";
  strcpy(d.id, "a4cf12"); strcpy(d.bootId, "9f31c2aa"); return d;
}
static Sample mk(uint32_t i, int16_t t0 = 1000) {
  Sample s{}; s.v[0] = (int16_t)(t0 + i); s.v[1] = (int16_t)(2000 + i); s.v[2] = NIL; s.f[2] = 0; s.cj = 254; s.ms = 100000 + i * 1000; return s;
}
static JsonDocument parse(const std::string& s) { JsonDocument d; DeserializationError e = deserializeJson(d, s); TEST_ASSERT_FALSE_MESSAGE(e, s.c_str()); return d; }

struct Fix {
  DeviceInfo di = mkInfo(); Ring ring; DeviceConfig cfg; ProtocolEngine eng; TestSink sink; uint32_t now = 0;
  Fix() : eng(di, ring, cfg) { cfgDefaults(cfg); }
  void feed(uint32_t n) { for (uint32_t i = 0; i < n; i++) { ring.push(mk(ring.seq() + 1)); eng.onSample(sink); } }
  void msg(uint32_t id, const std::string& j) { eng.onMessage(id, j.data(), j.size(), now, sink); }
  std::vector<std::string> types(uint32_t id) {
    std::vector<std::string> v;
    for (auto& o : sink.log) if (o.id == id) v.push_back(parse(o.text)["type"].as<std::string>());
    return v;
  }
};

// ---- エンコード（tools/sim/server.mjs と同じ形）
void test_enc_s_exact() {
  Sample s{}; s.v[0] = 1983; s.v[1] = 2107; s.v[2] = NIL; s.f[0] = 0; s.f[1] = 0; s.f[2] = 0; s.cj = 254; s.ms = 913002;
  TEST_ASSERT_EQUAL_STRING("{\"type\":\"s\",\"seq\":913,\"ms\":913002,\"v\":[1983,2107,null],\"f\":[0,0,0],\"cj\":254}", wsp::encS(913, s).c_str());
  s.v[1] = NIL; s.f[1] = 1; s.cj = NIL;
  TEST_ASSERT_EQUAL_STRING("{\"type\":\"s\",\"seq\":1,\"ms\":913002,\"v\":[1983,null,null],\"f\":[0,1,0],\"cj\":null}", wsp::encS(1, s).c_str());
}
void test_enc_cfg_and_hello() {
  DeviceInfo di = mkInfo(); DeviceConfig c; cfgDefaults(c); c.ch[0].off10 = -8; c.ch[1].off10 = 15; c.rev = 7;
  std::string cfg = wsp::encCfgBody(di, c, true);
  TEST_ASSERT_EQUAL_STRING(
    "{\"type\":\"cfg\",\"rev\":7,\"channels\":["
    "{\"idx\":0,\"enabled\":true,\"role\":\"bt\",\"name\":\"豆温度\",\"color\":\"#C2410C\",\"offset\":-0.8},"
    "{\"idx\":1,\"enabled\":true,\"role\":\"et\",\"name\":\"排気\",\"color\":\"#7A5AA6\",\"offset\":1.5},"
    "{\"idx\":2,\"enabled\":false,\"role\":\"off\",\"name\":\"\",\"color\":\"#6B7280\",\"offset\":0}],"
    "\"amp\":{\"type\":\"max31856\",\"mains\":50,\"avg\":4},\"rateHz\":1}", cfg.c_str());
  JsonDocument h = parse(wsp::encHello(di, 912345, 912, 1, c));
  TEST_ASSERT_EQUAL_STRING("hello", h["type"]);
  TEST_ASSERT_EQUAL(1, (int)h["proto"]);
  TEST_ASSERT_EQUAL_STRING("9f31c2aa", h["bootId"]);
  TEST_ASSERT_EQUAL(912, (int)h["seq"]); TEST_ASSERT_EQUAL(1, (int)h["bufFrom"]); TEST_ASSERT_EQUAL(3, (int)h["chMax"]);
  TEST_ASSERT_EQUAL(1, (int)h["speed"]); TEST_ASSERT_EQUAL(7, (int)h["cfg"]["rev"]);
  TEST_ASSERT_TRUE(h["cfg"]["type"].isNull());   // hello の cfg に type は無い
  TEST_ASSERT_EQUAL(3, (int)h["cfg"]["channels"].size());
}
void test_enc_ack_pong_st() {
  std::string id = "c17";
  TEST_ASSERT_EQUAL_STRING("{\"type\":\"ack\",\"id\":\"c17\",\"ok\":true}", wsp::encAck(&id, true, nullptr).c_str());
  id = "c18"; uint32_t rev = 5;
  TEST_ASSERT_EQUAL_STRING("{\"type\":\"ack\",\"id\":\"c18\",\"ok\":false,\"err\":\"stale\",\"rev\":5}", wsp::encAck(&id, false, "stale", &rev).c_str());
  id = "p5";
  TEST_ASSERT_EQUAL_STRING("{\"type\":\"pong\",\"id\":\"p5\",\"t\":1763870000123,\"ms\":913500}", wsp::encPong(&id, 1763870000123LL, 913500).c_str());
  StatusInfo st; st.rssi = -61; st.mode = "sta"; st.ip = "192.168.1.42"; st.heap = 182344; st.uptime = 913; st.clients = 1;
  TEST_ASSERT_EQUAL_STRING("{\"type\":\"st\",\"rssi\":-61,\"mode\":\"sta\",\"ip\":\"192.168.1.42\",\"heap\":182344,\"uptime\":913,\"clients\":1}", wsp::encSt(st).c_str());
}
void test_json_escape_name() {
  DeviceInfo di = mkInfo(); DeviceConfig c; cfgDefaults(c);
  strcpy(c.ch[2].name, "a\"b\\c\n");
  JsonDocument d = parse(wsp::encCfgBody(di, c, true));
  TEST_ASSERT_EQUAL_STRING("a\"b\\c\n", d["channels"][2]["name"]);
}
void test_enc_bf_columns() {
  static Ring r; r.reset();
  for (uint32_t i = 1; i <= 5; i++) { Sample s = mk(i); if (i == 3) { s.v[0] = NIL; s.f[0] = 1; } r.push(s); }
  JsonDocument d = parse(wsp::encBf(r, 2, 4, false, 0));
  TEST_ASSERT_EQUAL_STRING("bf", d["type"]);
  TEST_ASSERT_EQUAL(2, (int)d["from"]); TEST_ASSERT_EQUAL(4, (int)d["to"]); TEST_ASSERT_FALSE((bool)d["lost"]);
  TEST_ASSERT_EQUAL(100000 + 2000, (int)d["ms0"]); TEST_ASSERT_EQUAL(1000, (int)d["dt"]);
  TEST_ASSERT_EQUAL(3, (int)d["v"].size()); TEST_ASSERT_EQUAL(3, (int)d["v"][0].size());
  TEST_ASSERT_EQUAL(1002, (int)d["v"][0][0]); TEST_ASSERT_TRUE(d["v"][0][1].isNull());
  TEST_ASSERT_EQUAL(1, (int)d["f"][0][1]); TEST_ASSERT_TRUE(d["v"][2][0].isNull());
  d = parse(wsp::encBf(r, 7, 6, true, 55));   // 空
  TEST_ASSERT_EQUAL(6, (int)d["to"]); TEST_ASSERT_TRUE((bool)d["lost"]); TEST_ASSERT_EQUAL(0, (int)d["v"][0].size());
}

// ---- 接続・順序
void test_hello_after_hi_then_s() {
  Fix f; f.feed(5);
  TEST_ASSERT_TRUE(f.eng.onOpen(1, 0));
  f.msg(1, "{\"type\":\"hi\",\"app\":\"roastlog\",\"ver\":\"x\",\"bootId\":null,\"lastSeq\":null}");
  auto t = f.types(1);
  TEST_ASSERT_EQUAL(1, (int)t.size()); TEST_ASSERT_EQUAL_STRING("hello", t[0].c_str());
  JsonDocument h = parse(f.sink.log[0].text);
  TEST_ASSERT_EQUAL(5, (int)h["seq"]);
  f.sink.clear(); f.feed(1);
  t = f.types(1); TEST_ASSERT_EQUAL(1, (int)t.size()); TEST_ASSERT_EQUAL_STRING("s", t[0].c_str());
}
void test_hello_without_hi_after_1s() {
  Fix f; f.feed(2); f.eng.onOpen(1, 1000);
  f.eng.pump(1500, f.sink); TEST_ASSERT_EQUAL(0, (int)f.sink.log.size());
  f.eng.pump(2000, f.sink); TEST_ASSERT_EQUAL(1, (int)f.sink.log.size());
  TEST_ASSERT_EQUAL_STRING("hello", parse(f.sink.log[0].text)["type"]);
  f.sink.clear(); f.feed(1); TEST_ASSERT_EQUAL_STRING("s", parse(f.sink.log[0].text)["type"]);
}
void test_no_s_before_ready() {
  Fix f; f.feed(2); f.eng.onOpen(1, 0); f.feed(3);
  TEST_ASSERT_EQUAL(0, (int)f.sink.log.size());
}
void test_auto_backfill_order_hello_bf_s() {
  Fix f; f.feed(700);
  f.eng.onOpen(1, 0);
  f.msg(1, "{\"type\":\"hi\",\"app\":\"a\",\"ver\":\"1\",\"bootId\":\"9f31c2aa\",\"lastSeq\":100}");
  // hello のみ。bf は pump で 1 フレームずつ
  TEST_ASSERT_EQUAL(1, (int)f.sink.log.size());
  f.feed(1);   // 701 は bf 送信中なので s では送られない
  for (auto& o : f.sink.log) TEST_ASSERT_NOT_EQUAL(0, strcmp(parse(o.text)["type"], "s"));
  f.eng.pump(10, f.sink);  // bf 101..400
  f.eng.pump(20, f.sink);  // bf 401..700
  f.feed(1);               // 702: まだ 701.. が残っているので s は送らない
  f.eng.pump(30, f.sink);  // 最後の bf 701..702（溜まった分を含む）
  auto t = f.types(1);
  TEST_ASSERT_EQUAL(4, (int)t.size());
  TEST_ASSERT_EQUAL_STRING("hello", t[0].c_str());
  TEST_ASSERT_EQUAL_STRING("bf", t[1].c_str()); TEST_ASSERT_EQUAL_STRING("bf", t[2].c_str()); TEST_ASSERT_EQUAL_STRING("bf", t[3].c_str());
  JsonDocument b1 = parse(f.sink.log[1].text), b2 = parse(f.sink.log[2].text), b3 = parse(f.sink.log[3].text);
  TEST_ASSERT_EQUAL(101, (int)b1["from"]); TEST_ASSERT_EQUAL(400, (int)b1["to"]); TEST_ASSERT_EQUAL(300, (int)b1["v"][0].size());
  TEST_ASSERT_EQUAL(401, (int)b2["from"]); TEST_ASSERT_EQUAL(700, (int)b2["to"]);
  TEST_ASSERT_EQUAL(701, (int)b3["from"]); TEST_ASSERT_EQUAL(702, (int)b3["to"]);
  TEST_ASSERT_FALSE((bool)b1["lost"]);
  f.sink.clear(); f.feed(1);   // bf を送り終えたので s が再開
  TEST_ASSERT_EQUAL(1, (int)f.sink.log.size());
  JsonDocument s = parse(f.sink.log[0].text);
  TEST_ASSERT_EQUAL_STRING("s", s["type"]); TEST_ASSERT_EQUAL(703, (int)s["seq"]);
}
void test_other_client_not_blocked_by_bf() {
  Fix f; f.feed(400);
  f.eng.onOpen(1, 0); f.eng.onOpen(2, 0);
  f.msg(2, "{\"type\":\"hi\",\"app\":\"a\",\"ver\":\"1\",\"bootId\":null,\"lastSeq\":null}");
  f.msg(1, "{\"type\":\"hi\",\"app\":\"a\",\"ver\":\"1\",\"bootId\":\"9f31c2aa\",\"lastSeq\":0}");
  f.sink.clear(); f.feed(1);
  TEST_ASSERT_EQUAL(1, (int)f.sink.log.size());      // 2 番にだけ s
  TEST_ASSERT_EQUAL(2, (int)f.sink.log[0].id);
}
void test_different_bootid_no_bf() {
  Fix f; f.feed(50); f.eng.onOpen(1, 0);
  f.msg(1, "{\"type\":\"hi\",\"app\":\"a\",\"ver\":\"1\",\"bootId\":\"deadbeef\",\"lastSeq\":10}");
  f.eng.pump(10, f.sink);
  TEST_ASSERT_EQUAL(1, (int)f.sink.log.size());
}
void test_lastseq_out_of_buffer_lost() {
  Fix f; f.feed(RING_CAPACITY + 100);
  f.eng.onOpen(1, 0);
  f.msg(1, "{\"type\":\"hi\",\"app\":\"a\",\"ver\":\"1\",\"bootId\":\"9f31c2aa\",\"lastSeq\":5}");
  f.sink.clear();
  f.eng.pump(10, f.sink);
  JsonDocument b = parse(f.sink.log[0].text);
  TEST_ASSERT_TRUE((bool)b["lost"]); TEST_ASSERT_EQUAL(101, (int)b["from"]);
  f.eng.pump(20, f.sink);
  TEST_ASSERT_FALSE((bool)parse(f.sink.log[1].text)["lost"]);   // lost は最初のフレームだけ
}
void test_slow_client_catches_up_with_bf_before_s() {
  Fix f; f.feed(10); f.eng.onOpen(1, 0);
  f.msg(1, "{\"type\":\"hi\",\"app\":\"a\",\"ver\":\"1\",\"bootId\":null,\"lastSeq\":null}");
  f.sink.clear(); f.sink.can = false; f.feed(3); f.sink.can = true;
  TEST_ASSERT_EQUAL(0, (int)f.sink.log.size());
  f.eng.pump(10, f.sink);
  JsonDocument b = parse(f.sink.log[0].text);
  TEST_ASSERT_EQUAL_STRING("bf", b["type"]); TEST_ASSERT_EQUAL(11, (int)b["from"]); TEST_ASSERT_EQUAL(13, (int)b["to"]);
  f.sink.clear(); f.feed(1);
  TEST_ASSERT_EQUAL_STRING("s", parse(f.sink.log[0].text)["type"]);
}
void test_max_clients() {
  Fix f;
  for (uint32_t i = 1; i <= 4; i++) TEST_ASSERT_TRUE(f.eng.onOpen(i, 0));
  TEST_ASSERT_FALSE(f.eng.onOpen(5, 0));
  f.eng.onClose(2);
  TEST_ASSERT_TRUE(f.eng.onOpen(5, 0));
  TEST_ASSERT_EQUAL(4, f.eng.clientCount());
}

// ---- コマンド
void test_bf_req() {
  Fix f; f.feed(50); f.eng.onOpen(1, 0);
  f.msg(1, "{\"type\":\"hi\",\"app\":\"a\",\"ver\":\"1\",\"bootId\":null,\"lastSeq\":null}");
  f.sink.clear();
  f.msg(1, "{\"type\":\"bf_req\",\"from\":10,\"to\":20}");
  f.eng.pump(1, f.sink);
  JsonDocument b = parse(f.sink.log[0].text);
  TEST_ASSERT_EQUAL(10, (int)b["from"]); TEST_ASSERT_EQUAL(20, (int)b["to"]); TEST_ASSERT_FALSE((bool)b["lost"]);
  TEST_ASSERT_EQUAL(11, (int)b["v"][0].size());
  f.sink.clear();
  f.msg(1, "{\"type\":\"bf_req\",\"from\":0,\"to\":5}");     // 範囲外 → lost
  f.eng.pump(2, f.sink);
  b = parse(f.sink.log[0].text); TEST_ASSERT_TRUE((bool)b["lost"]); TEST_ASSERT_EQUAL(1, (int)b["from"]);
  f.sink.clear();
  f.msg(1, "{\"type\":\"bf_req\",\"id\":\"q\",\"from\":\"x\",\"to\":5}");
  JsonDocument a = parse(f.sink.log[0].text);
  TEST_ASSERT_FALSE((bool)a["ok"]); TEST_ASSERT_EQUAL_STRING("bad_range", a["err"]);
}
void test_bf_req_over_300_chunks() {
  Fix f; f.feed(1000); f.eng.onOpen(1, 0);
  f.msg(1, "{\"type\":\"hi\",\"app\":\"a\",\"ver\":\"1\",\"bootId\":null,\"lastSeq\":null}");
  f.sink.clear();
  f.msg(1, "{\"type\":\"bf_req\",\"from\":1,\"to\":1000}");
  for (int i = 0; i < 6; i++) f.eng.pump(i, f.sink);
  TEST_ASSERT_EQUAL(4, (int)f.sink.log.size());
  JsonDocument last = parse(f.sink.log[3].text);
  TEST_ASSERT_EQUAL(901, (int)last["from"]); TEST_ASSERT_EQUAL(1000, (int)last["to"]);
}
void test_ping_pong_echo() {
  Fix f; f.feed(3); f.eng.onOpen(1, 0);
  f.msg(1, "{\"type\":\"ping\",\"id\":\"p5\",\"t\":1763870000100}");
  JsonDocument p = parse(f.sink.log[0].text);
  TEST_ASSERT_EQUAL_STRING("pong", p["type"]); TEST_ASSERT_EQUAL_STRING("p5", p["id"]);
  TEST_ASSERT_TRUE(p["t"].as<int64_t>() == 1763870000100LL);   // ping.t をそのままエコー
  TEST_ASSERT_EQUAL(103000, (int)p["ms"]);
}
void test_setcfg_partial_ack_cfg_broadcast() {
  Fix f; f.feed(1); f.eng.onOpen(1, 0); f.eng.onOpen(2, 0);
  f.msg(1, "{\"type\":\"hi\",\"app\":\"a\",\"ver\":\"1\",\"bootId\":null,\"lastSeq\":null}");
  f.msg(2, "{\"type\":\"hi\",\"app\":\"a\",\"ver\":\"1\",\"bootId\":null,\"lastSeq\":null}");
  f.sink.clear();
  f.msg(1, "{\"type\":\"setcfg\",\"id\":\"c-ok\",\"baseRev\":0,\"channels\":[{\"idx\":0,\"offset\":1.5}]}");
  TEST_ASSERT_EQUAL(3, (int)f.sink.log.size());
  JsonDocument a = parse(f.sink.log[0].text);
  TEST_ASSERT_EQUAL_STRING("ack", a["type"]); TEST_ASSERT_TRUE((bool)a["ok"]); TEST_ASSERT_EQUAL(1, (int)f.sink.log[0].id);
  JsonDocument c1 = parse(f.sink.log[1].text), c2 = parse(f.sink.log[2].text);
  TEST_ASSERT_EQUAL_STRING("cfg", c1["type"]); TEST_ASSERT_EQUAL(1, (int)c1["rev"]);
  TEST_ASSERT_EQUAL(1.5, (double)c1["channels"][0]["offset"]);
  TEST_ASSERT_EQUAL_STRING("et", c1["channels"][1]["role"]);       // 部分更新で他は変わらない
  TEST_ASSERT_EQUAL(2, (int)f.sink.log[2].id);
  TEST_ASSERT_TRUE(f.eng.takeCfgChanged()); TEST_ASSERT_FALSE(f.eng.takeCfgChanged());
  TEST_ASSERT_EQUAL(15, f.cfg.ch[0].off10); TEST_ASSERT_EQUAL(1, (int)f.cfg.rev);
}
void test_setcfg_stale_rev() {
  Fix f; f.feed(1); f.eng.onOpen(1, 0);
  f.msg(1, "{\"type\":\"hi\",\"app\":\"a\",\"ver\":\"1\",\"bootId\":null,\"lastSeq\":null}");
  f.msg(1, "{\"type\":\"setcfg\",\"id\":\"a\",\"baseRev\":0,\"channels\":[{\"idx\":0,\"offset\":2}]}");  // rev 0 → 1
  f.sink.clear();
  f.msg(1, "{\"type\":\"setcfg\",\"id\":\"b\",\"baseRev\":0,\"channels\":[{\"idx\":0,\"offset\":9}]}");  // 古い
  TEST_ASSERT_EQUAL(1, (int)f.sink.log.size());                    // cfg は送らない
  JsonDocument a = parse(f.sink.log[0].text);
  TEST_ASSERT_FALSE((bool)a["ok"]); TEST_ASSERT_EQUAL_STRING("stale", a["err"]); TEST_ASSERT_EQUAL(1, (int)a["rev"]);
  TEST_ASSERT_EQUAL(20, f.cfg.ch[0].off10); TEST_ASSERT_EQUAL(1, (int)f.cfg.rev);  // 変わっていない
  f.sink.clear();
  f.msg(1, "{\"type\":\"setcfg\",\"id\":\"c\",\"baseRev\":1,\"channels\":[{\"idx\":0,\"offset\":3}]}");
  TEST_ASSERT_TRUE((bool)parse(f.sink.log[0].text)["ok"]); TEST_ASSERT_EQUAL(2, (int)f.cfg.rev);
}
void test_setcfg_errors_leave_cfg() {
  Fix f; f.eng.onOpen(1, 0);
  struct { const char* j; const char* err; } cases[] = {
    {"{\"type\":\"setcfg\",\"id\":\"1\",\"channels\":[{\"idx\":7,\"offset\":1}]}", "bad_channel"},
    {"{\"type\":\"setcfg\",\"id\":\"1\",\"channels\":[null]}", "bad_channel"},
    {"{\"type\":\"setcfg\",\"id\":\"1\",\"channels\":[{\"idx\":0,\"offset\":51}]}", "bad_value"},
    {"{\"type\":\"setcfg\",\"id\":\"1\",\"channels\":[{\"idx\":0,\"role\":\"zzz\"}]}", "bad_value"},
    {"{\"type\":\"setcfg\",\"id\":\"1\",\"channels\":[{\"idx\":0,\"color\":\"red\"}]}", "bad_value"},
    {"{\"type\":\"setcfg\",\"id\":\"1\",\"channels\":[{\"idx\":0,\"enabled\":1}]}", "bad_value"},
    {"{\"type\":\"setcfg\",\"id\":\"1\",\"channels\":[{\"idx\":0,\"name\":\"123456789012345678901234x\"}]}", "bad_value"},
    {"{\"type\":\"setcfg\",\"id\":\"1\",\"amp\":{\"mains\":55}}", "bad_value"},
    {"{\"type\":\"setcfg\",\"id\":\"1\",\"amp\":{\"avg\":3}}", "bad_value"},
    {"{\"type\":\"setcfg\",\"id\":\"1\",\"channels\":{}}", "bad_value"},
  };
  for (auto& c : cases) {
    f.sink.clear(); f.msg(1, c.j);
    JsonDocument a = parse(f.sink.log[0].text);
    TEST_ASSERT_FALSE_MESSAGE((bool)a["ok"], c.j); TEST_ASSERT_EQUAL_STRING_MESSAGE(c.err, a["err"], c.j);
    TEST_ASSERT_EQUAL_MESSAGE(0, (int)f.cfg.rev, c.j);
  }
  // 途中で失敗したら先の変更も反映しない
  f.sink.clear();
  f.msg(1, "{\"type\":\"setcfg\",\"id\":\"1\",\"channels\":[{\"idx\":0,\"offset\":4},{\"idx\":9}]}");
  TEST_ASSERT_EQUAL(0, f.cfg.ch[0].off10);
  // 24 文字の日本語名は可、amp は部分更新
  f.sink.clear();
  f.msg(1, "{\"type\":\"setcfg\",\"id\":\"2\",\"channels\":[{\"idx\":2,\"enabled\":true,\"role\":\"amb\",\"name\":\"あいうえおかきくけこさしすせそたちつてとなにぬね\",\"color\":\"#00ff7f\"}],\"amp\":{\"mains\":60,\"avg\":16}}");
  TEST_ASSERT_TRUE((bool)parse(f.sink.log[0].text)["ok"]);
  TEST_ASSERT_TRUE(f.cfg.ch[2].enabled); TEST_ASSERT_EQUAL(60, f.cfg.mains); TEST_ASSERT_EQUAL(16, f.cfg.avg);
}
void test_identify_unknown_and_garbage() {
  Fix f; f.eng.onOpen(1, 0);
  f.msg(1, "{\"type\":\"identify\",\"id\":\"i1\"}");
  TEST_ASSERT_TRUE((bool)parse(f.sink.log[0].text)["ok"]);
  TEST_ASSERT_TRUE(f.eng.takeIdentify()); TEST_ASSERT_FALSE(f.eng.takeIdentify());
  f.sink.clear();
  f.msg(1, "{\"type\":\"nope\",\"id\":\"z\"}");
  TEST_ASSERT_EQUAL_STRING("unknown_type", parse(f.sink.log[0].text)["err"]);
  f.sink.clear();
  f.msg(1, "{\"type\":\"nope\"}");        // id が無ければ ack しない
  f.msg(1, "not json"); f.msg(1, "[1,2]"); f.msg(1, "{\"x\":1}");
  TEST_ASSERT_EQUAL(0, (int)f.sink.log.size());
}
void test_st_to_ready_only() {
  Fix f; f.eng.onOpen(1, 0); f.eng.onOpen(2, 0);
  f.msg(1, "{\"type\":\"hi\",\"app\":\"a\",\"ver\":\"1\",\"bootId\":null,\"lastSeq\":null}");
  f.sink.clear();
  StatusInfo st; st.ip = "1.2.3.4"; f.eng.broadcastSt(st, f.sink);
  TEST_ASSERT_EQUAL(1, (int)f.sink.log.size());
  TEST_ASSERT_EQUAL(2, (int)parse(f.sink.log[0].text)["clients"]);
}

void setUp() {}
void tearDown() {}
int main() {
  UNITY_BEGIN();
  RUN_TEST(test_enc_s_exact); RUN_TEST(test_enc_cfg_and_hello); RUN_TEST(test_enc_ack_pong_st);
  RUN_TEST(test_json_escape_name); RUN_TEST(test_enc_bf_columns);
  RUN_TEST(test_hello_after_hi_then_s); RUN_TEST(test_hello_without_hi_after_1s); RUN_TEST(test_no_s_before_ready);
  RUN_TEST(test_auto_backfill_order_hello_bf_s); RUN_TEST(test_other_client_not_blocked_by_bf);
  RUN_TEST(test_different_bootid_no_bf); RUN_TEST(test_lastseq_out_of_buffer_lost);
  RUN_TEST(test_slow_client_catches_up_with_bf_before_s); RUN_TEST(test_max_clients);
  RUN_TEST(test_bf_req); RUN_TEST(test_bf_req_over_300_chunks); RUN_TEST(test_ping_pong_echo);
  RUN_TEST(test_setcfg_partial_ack_cfg_broadcast); RUN_TEST(test_setcfg_stale_rev);
  RUN_TEST(test_setcfg_errors_leave_cfg); RUN_TEST(test_identify_unknown_and_garbage); RUN_TEST(test_st_to_ready_only);
  return UNITY_END();
}

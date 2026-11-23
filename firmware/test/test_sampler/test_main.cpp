#include <unity.h>
#include <math.h>
#include "Sampler.h"

static TcReading ok(float t, float cj = 25.0f) { return {t, cj, TC_OK}; }
static TcReading bad(uint8_t f) { return {NAN, 25.0f, f}; }

void test_agg_four_valid_median_two() {
  TcReading r[4] = {ok(100.0f), ok(101.0f), ok(103.0f), ok(150.0f)};  // 外れ値 150
  AggResult a = aggregateReads(r, 4);
  TEST_ASSERT_TRUE(a.valid);
  TEST_ASSERT_EQUAL_FLOAT(102.0f, a.value);  // 中央2値 101,103 の平均
}
void test_agg_three_valid_median() {
  TcReading r[4] = {ok(100.0f), bad(TC_OPEN), ok(110.0f), ok(104.0f)};
  AggResult a = aggregateReads(r, 4);
  TEST_ASSERT_TRUE(a.valid);
  TEST_ASSERT_EQUAL_FLOAT(104.0f, a.value);
}
void test_agg_two_valid_mean() {
  TcReading r[4] = {bad(TC_OPEN), ok(100.0f), bad(TC_OVUV), ok(101.0f)};
  AggResult a = aggregateReads(r, 4);
  TEST_ASSERT_TRUE(a.valid);
  TEST_ASSERT_EQUAL_FLOAT(100.5f, a.value);
}
void test_agg_one_valid() {
  TcReading r[4] = {bad(TC_OPEN), bad(TC_OPEN), ok(88.0f), bad(TC_STALE)};
  AggResult a = aggregateReads(r, 4);
  TEST_ASSERT_TRUE(a.valid);
  TEST_ASSERT_EQUAL_FLOAT(88.0f, a.value);
  TEST_ASSERT_EQUAL_UINT8(0, a.fault);
}
void test_agg_all_fault_null_last_code() {
  TcReading r[4] = {bad(TC_OPEN), bad(TC_OPEN), bad(TC_OVUV), bad(TC_NO_DEVICE)};
  AggResult a = aggregateReads(r, 4);
  TEST_ASSERT_FALSE(a.valid);
  TEST_ASSERT_EQUAL_UINT8(TC_NO_DEVICE, a.fault);  // 最後の故障コード
}
void test_agg_nan_with_ok_fault_counts_as_fault() {
  TcReading r[4] = {{NAN, 0, TC_OK}, {NAN, 0, TC_OK}, {NAN, 0, TC_OK}, {NAN, 0, TC_OK}};
  AggResult a = aggregateReads(r, 4);
  TEST_ASSERT_FALSE(a.valid);
  TEST_ASSERT_NOT_EQUAL(0, a.fault);
}

void test_sampler_one_second_and_offset() {
  Sampler s; DeviceConfig c; cfgDefaults(c);
  c.ch[0].off10 = -8;  // -0.8
  TcReading r[3] = {ok(200.0f, 24.0f), ok(150.0f, 26.0f), bad(TC_NO_DEVICE)};
  Sample out{};
  TEST_ASSERT_FALSE(s.pushReads(r, 250, c, out));
  TEST_ASSERT_FALSE(s.pushReads(r, 500, c, out));
  TEST_ASSERT_FALSE(s.pushReads(r, 750, c, out));
  TEST_ASSERT_TRUE(s.pushReads(r, 1000, c, out));
  TEST_ASSERT_EQUAL_INT16(1992, out.v[0]);   // 199.2
  TEST_ASSERT_EQUAL_INT16(1500, out.v[1]);
  TEST_ASSERT_EQUAL_INT16(NIL, out.v[2]);    // 無効チャンネルは null
  TEST_ASSERT_EQUAL_UINT8(0, out.f[2]);      // 無効チャンネルの故障コードは 0
  TEST_ASSERT_EQUAL_UINT32(1000, out.ms);
  TEST_ASSERT_EQUAL_INT16(250, out.cj);      // 24 と 26 の平均 25.0
}
void test_sampler_enabled_channel_all_fault() {
  Sampler s; DeviceConfig c; cfgDefaults(c);
  TcReading r[3] = {ok(100.0f), bad(TC_OPEN), bad(TC_OPEN)};
  Sample out{};
  for (int i = 0; i < 4; i++) s.pushReads(r, 250 * (i + 1), c, out);
  TEST_ASSERT_EQUAL_INT16(1000, out.v[0]);
  TEST_ASSERT_EQUAL_INT16(NIL, out.v[1]);
  TEST_ASSERT_EQUAL_UINT8(TC_OPEN, out.f[1]);
}

// ---- Ring
static Sample mk(uint32_t i) { Sample s{}; s.v[0] = (int16_t)(i % 30000); s.v[1] = NIL; s.v[2] = NIL; s.ms = i * 1000; return s; }

void test_ring_empty() {
  static Ring r; r.reset();
  TEST_ASSERT_EQUAL_UINT32(0, r.seq());
  TEST_ASSERT_EQUAL_UINT32(1, r.bufFrom());
  TEST_ASSERT_NULL(r.get(1));
  RangePlan p = r.plan(1, 10);
  TEST_ASSERT_TRUE(p.empty);
}
void test_ring_seq_and_get() {
  static Ring r; r.reset();
  for (uint32_t i = 1; i <= 100; i++) TEST_ASSERT_EQUAL_UINT32(i, r.push(mk(i)));
  TEST_ASSERT_EQUAL_UINT32(100, r.seq());
  TEST_ASSERT_EQUAL_UINT32(1, r.bufFrom());
  TEST_ASSERT_EQUAL_INT16(50, r.get(50)->v[0]);
  TEST_ASSERT_NULL(r.get(0));
  TEST_ASSERT_NULL(r.get(101));
}
void test_ring_range_plan_normal() {
  static Ring r; r.reset();
  for (uint32_t i = 1; i <= 100; i++) r.push(mk(i));
  RangePlan p = r.plan(10, 20);
  TEST_ASSERT_FALSE(p.empty); TEST_ASSERT_FALSE(p.lost);
  TEST_ASSERT_EQUAL_UINT32(10, p.from); TEST_ASSERT_EQUAL_UINT32(20, p.to);
  p = r.plan(90, 500);  // to は seq に切り詰め
  TEST_ASSERT_EQUAL_UINT32(100, p.to); TEST_ASSERT_FALSE(p.lost);
  p = r.plan(0, 5);     // from=0 は範囲外 → lost、最古(1)から
  TEST_ASSERT_TRUE(p.lost); TEST_ASSERT_EQUAL_UINT32(1, p.from); TEST_ASSERT_EQUAL_UINT32(5, p.to);
  p = r.plan(200, 300); // 未来だけ → 空
  TEST_ASSERT_TRUE(p.empty);
}
void test_ring_wrap_and_lost() {
  static Ring r; r.reset();
  for (uint32_t i = 1; i <= RING_CAPACITY + 500; i++) r.push(mk(i));
  TEST_ASSERT_EQUAL_UINT32(RING_CAPACITY + 500, r.seq());
  TEST_ASSERT_EQUAL_UINT32(501, r.bufFrom());          // seq-3600+1
  TEST_ASSERT_NULL(r.get(500));
  TEST_ASSERT_NOT_NULL(r.get(501));
  TEST_ASSERT_EQUAL_INT16((int16_t)(501 % 30000), r.get(501)->v[0]);
  TEST_ASSERT_EQUAL_INT16((int16_t)((RING_CAPACITY + 500) % 30000), r.get(RING_CAPACITY + 500)->v[0]);
  RangePlan p = r.plan(100, 600);
  TEST_ASSERT_TRUE(p.lost); TEST_ASSERT_EQUAL_UINT32(501, p.from); TEST_ASSERT_EQUAL_UINT32(600, p.to);
  p = r.plan(501, 600);
  TEST_ASSERT_FALSE(p.lost);
  p = r.plan(1, 400);   // 全部バッファ外 → lost + 空
  TEST_ASSERT_TRUE(p.lost); TEST_ASSERT_TRUE(p.empty);
}

void setUp() {}
void tearDown() {}
int main() {
  UNITY_BEGIN();
  RUN_TEST(test_agg_four_valid_median_two);
  RUN_TEST(test_agg_three_valid_median);
  RUN_TEST(test_agg_two_valid_mean);
  RUN_TEST(test_agg_one_valid);
  RUN_TEST(test_agg_all_fault_null_last_code);
  RUN_TEST(test_agg_nan_with_ok_fault_counts_as_fault);
  RUN_TEST(test_sampler_one_second_and_offset);
  RUN_TEST(test_sampler_enabled_channel_all_fault);
  RUN_TEST(test_ring_empty);
  RUN_TEST(test_ring_seq_and_get);
  RUN_TEST(test_ring_range_plan_normal);
  RUN_TEST(test_ring_wrap_and_lost);
  return UNITY_END();
}

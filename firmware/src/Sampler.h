#pragma once
// 4Hz 読取 → 1Hz 集約（中央2値の平均）、リングバッファ、seq（SPEC 2.2 / 6.4）。Arduino に依存しない。
#include <stdint.h>
#include <math.h>
#include "CfgModel.h"
#include "tc/TcDriver.h"
#include "../include/config.h"

struct Sample {
  int16_t v[3];    // 0.1℃、NIL = null（補正値込み）
  int16_t cj;      // 0.1℃、NIL = null
  uint32_t ms;
  uint8_t f[3];
};

// 1 チャンネル分の 4 読取を集約する。valid = 故障でなく有限値。
// 有効値の個数 n: 0 → null + 最後の故障コード / 奇数 → 中央値 / 偶数 → 中央2値の平均
struct AggResult { bool valid; float value; uint8_t fault; };
AggResult aggregateReads(const TcReading* r, int n);

struct RangePlan { uint32_t from, to; bool lost; bool empty; };

class Ring {
 public:
  Ring() : seq_(0) {}
  void reset() { seq_ = 0; }
  uint32_t seq() const { return seq_; }
  uint32_t bufFrom() const { return seq_ == 0 ? 1 : (seq_ > RING_CAPACITY ? seq_ - RING_CAPACITY + 1 : 1); }
  uint32_t push(const Sample& s) { seq_++; buf_[seq_ % RING_CAPACITY] = s; return seq_; }
  const Sample* get(uint32_t s) const { return (s >= bufFrom() && s <= seq_ && s != 0) ? &buf_[s % RING_CAPACITY] : nullptr; }
  // bf_req の範囲を、バッファに残っている範囲へ切り詰める（範囲外なら lost、最古から）
  RangePlan plan(int64_t from, int64_t to) const;
 private:
  uint32_t seq_;
  Sample buf_[RING_CAPACITY];
};

class Sampler {
 public:
  Sampler() : n_(0) {}
  // 250ms ごとに 3ch 分を渡す。4 回目で集約して true（out に結果）。リングへは入れない
  bool pushReads(const TcReading r[3], uint32_t nowMs, const DeviceConfig& cfg, Sample& out);
  void clearSlots() { n_ = 0; }
 private:
  TcReading slot_[3][AGG_READS];
  int n_;
};

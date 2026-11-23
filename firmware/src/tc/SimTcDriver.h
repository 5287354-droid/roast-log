#pragma once
#include "TcDriver.h"

// 熱電対なしの動作確認用。20〜230℃ をゆっくり往復する値にノイズを足す（SPEC 6.2）
class SimTcDriver : public TcDriver {
 public:
  typedef uint32_t (*NowFn)();
  SimTcDriver(uint8_t idx, NowFn now) : idx_(idx), now_(now), rng_(0x1234567u + idx * 7919u), faultCode_(0), faultUntil_(0), faultOn_(false) {}
  bool begin() override { return true; }
  void configure(const TcConfig& c) override { cfg_ = c; }
  bool read(TcReading& out) override;
  const char* name() const override { return "sim"; }
  void injectFault(uint8_t code, uint32_t durMs) override { faultCode_ = code; faultUntil_ = now_() + durMs; faultOn_ = true; }
 private:
  float noise();
  uint8_t idx_; NowFn now_; uint32_t rng_; TcConfig cfg_{50, 4};
  uint8_t faultCode_; uint32_t faultUntil_; bool faultOn_;
};

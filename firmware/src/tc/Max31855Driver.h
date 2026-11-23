#pragma once
// F3 で実装する（雛形）。常に NO_DEVICE を返す。
// 実装メモ: 32bit 読み。bit16=FAULT、D0/D1/D2=OC/SCG/SCV（tcf::faultFromMax31855）、温度は bit31:18 x0.25。
// 直線近似なので NIST K 型多項式で補正する（SPEC 6.2）。SPI モード 0。
#include "TcDriver.h"
class Max31855Driver : public TcDriver {
 public:
  explicit Max31855Driver(uint8_t cs) : cs_(cs) {}
  bool begin() override { return false; }
  void configure(const TcConfig&) override {}
  bool read(TcReading& out) override { out.tempC = 0.0f / 0.0f; out.cjC = out.tempC; out.fault = TC_NO_DEVICE; (void)cs_; return true; }
  const char* name() const override { return "max31855"; }
 private:
  uint8_t cs_;
};

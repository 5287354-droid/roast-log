#pragma once
#include "TcDriver.h"
#include "TcFault.h"

// MAX31856（K 型、連続変換）。レジスタを SPI で直接読み書きし、設定は読み戻して検証する。
// SPI は loop() の中だけで触ること（WS コールバックから呼ばない）。
class Max31856Driver : public TcDriver {
 public:
  explicit Max31856Driver(uint8_t csPin) : cs_(csPin), cr0_(0), cr1_(0), verified_(false), present_(false) {}
  bool begin() override;
  void configure(const TcConfig& c) override;
  bool read(TcReading& out) override;
  const char* name() const override { return "max31856"; }
  bool diag(uint8_t& cr0, uint8_t& cr1, bool& verified) override { cr0 = cr0_; cr1 = cr1_; verified = verified_; return true; }
 private:
  void readRegs(uint8_t addr, uint8_t* buf, uint8_t n);
  void writeReg(uint8_t addr, uint8_t v);
  bool applyAndVerify();
  uint8_t cs_;
  TcConfig cfg_{50, 4};
  uint8_t cr0_, cr1_;
  bool verified_, present_;
  tcf::StaleDetector stale_;
};

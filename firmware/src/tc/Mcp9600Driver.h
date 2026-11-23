#pragma once
// F3 で実装する（雛形）。常に NO_DEVICE を返す。
// 実装メモ: I2C 0x60〜0x67。18bit、フィルタ係数 3、K 型。MCP9600 は断線検出不可（MCP9601 なら可）。
#include "TcDriver.h"
class Mcp9600Driver : public TcDriver {
 public:
  explicit Mcp9600Driver(uint8_t addr) : addr_(addr) {}
  bool begin() override { return false; }
  void configure(const TcConfig&) override {}
  bool read(TcReading& out) override { out.tempC = 0.0f / 0.0f; out.cjC = out.tempC; out.fault = TC_NO_DEVICE; (void)addr_; return true; }
  const char* name() const override { return "mcp9600"; }
 private:
  uint8_t addr_;
};

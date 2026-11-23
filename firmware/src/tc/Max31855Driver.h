#pragma once
// MAX31855（K 型）。SPI モード 0 で 32bit を読む。設定項目（フィルタ・平均化）は無いので configure は何もしない。
// 変換は約 100ms。250ms ごとに読むので、1 秒 4 値の中央2値平均はそのまま使える。
// SPI は loop() の中だけで触ること。
#include "TcDriver.h"
#include "TcFault.h"

class Max31855Driver : public TcDriver {
 public:
  explicit Max31855Driver(uint8_t csPin) : cs_(csPin) {}
  bool begin() override;
  void configure(const TcConfig&) override {}
  bool read(TcReading& out) override;
  const char* name() const override { return "max31855"; }
 private:
  uint32_t read32();
  uint8_t cs_;
  tcf::StaleDetector stale_;
};

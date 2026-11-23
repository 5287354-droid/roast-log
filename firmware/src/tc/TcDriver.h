#pragma once
// SPEC 6.2。Arduino に依存しない（native テストでも使う）
#include <stdint.h>

enum TcFault : uint8_t {
  TC_OK = 0, TC_OPEN = 1, TC_SHORT_GND = 2, TC_SHORT_VCC = 3, TC_OVUV = 4,
  TC_RANGE = 5, TC_CJ_RANGE = 6, TC_NO_DEVICE = 7, TC_STALE = 8
};

struct TcReading {
  float tempC;
  float cjC;
  uint8_t fault;
};
struct TcConfig {
  uint8_t mains;  // 50 | 60
  uint8_t avg;    // 1,2,4,8,16
};

class TcDriver {
 public:
  virtual ~TcDriver() {}
  virtual bool begin() = 0;                 // 検出できなければ false（以後 fault=NO_DEVICE）
  virtual void configure(const TcConfig&) = 0;
  virtual bool read(TcReading& out) = 0;    // 250ms ごとに呼ぶ。新しい値なら true
  virtual const char* name() const = 0;     // hello.amp
  // 診断用（読み戻したレジスタ。対応しないドライバは false）
  virtual bool diag(uint8_t& cr0, uint8_t& cr1, bool& verified) { (void)cr0; (void)cr1; (void)verified; return false; }
  virtual void injectFault(uint8_t code, uint32_t durMs) { (void)code; (void)durMs; }
};

TcDriver* makeDriver(uint8_t idx);  // ビルドフラグで選択（TcFactory.cpp）

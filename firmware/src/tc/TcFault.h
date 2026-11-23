#pragma once
// 故障コードの対応付けと MAX31856 のレジスタ換算（SPEC 2.5 / 6.2）。純粋関数だけ。
#include <stdint.h>
#include "TcDriver.h"

namespace tcf {

// MAX31856 SR(0x0F): bit7 CJRANGE, 6 TCRANGE, 5 CJHIGH, 4 CJLOW, 3 TCHIGH, 2 TCLOW, 1 OVUV, 0 OPEN
inline uint8_t faultFromMax31856(uint8_t sr) {
  if (sr & 0x01) return TC_OPEN;
  if (sr & 0x02) return TC_OVUV;
  if (sr & (0x40 | 0x08 | 0x04)) return TC_RANGE;
  if (sr & (0x80 | 0x20 | 0x10)) return TC_CJ_RANGE;
  return TC_OK;
}

// MAX31855 の 32bit（D16 FAULT、D2 SCV、D1 SCG、D0 OC）。全0 / 全1 は NO_DEVICE
inline uint8_t faultFromMax31855(uint32_t w) {
  if (w == 0u || w == 0xFFFFFFFFu) return TC_NO_DEVICE;
  if (!(w & (1u << 16))) return TC_OK;
  if (w & 1u) return TC_OPEN;
  if (w & 2u) return TC_SHORT_GND;
  if (w & 4u) return TC_SHORT_VCC;
  return TC_RANGE;
}

// 読出しが全0 / 全FF なら NO_DEVICE（SPEC 2.5）
inline bool allSame(const uint8_t* b, int n, uint8_t v) {
  for (int i = 0; i < n; i++) if (b[i] != v) return false;
  return true;
}
inline bool looksAbsent(const uint8_t* regs16) {
  return allSame(regs16, 16, 0x00) || allSame(regs16, 16, 0xFF);
}

// LTCB: 24bit 左詰めの 19bit 符号付き、1LSB = 0.0078125℃
inline float tcFromRaw(uint8_t b0, uint8_t b1, uint8_t b2) {
  int32_t v = ((int32_t)b0 << 16) | ((int32_t)b1 << 8) | b2;  // 24bit
  v >>= 5;                                                    // 19bit
  if (v & 0x40000) v |= ~0x7FFFF;                              // 符号拡張
  return (float)v * 0.0078125f;
}
// CJT: 16bit 左詰めの 14bit 符号付き、1LSB = 0.015625℃
inline float cjFromRaw(uint8_t h, uint8_t l) {
  int16_t v = (int16_t)(((uint16_t)h << 8) | l);
  v >>= 2;
  return (float)v * 0.015625f;
}

inline uint8_t avgSel(uint8_t avg) {
  switch (avg) { case 1: return 0; case 2: return 1; case 8: return 3; case 16: return 4; default: return 2; }
}
inline uint8_t cr0Value(uint8_t mains) { return (uint8_t)(0x80 /*連続*/ | 0x10 /*OCFAULT=01*/ | (mains == 60 ? 0x00 : 0x01)); }
inline uint8_t cr1Value(uint8_t avg) { return (uint8_t)((avgSel(avg) << 4) | 0x03 /*K型*/); }
// CR0 の 1SHOT(bit6) と FAULTCLR(bit1) は自動で戻るので比べない
inline bool cr0Matches(uint8_t got, uint8_t mains) { return (got & 0xBD) == (cr0Value(mains) & 0xBD); }

// 更新停止の検出。生の 24bit 値(+CJ) が連続で同じ回数を数える。
// 平均化が大きいと更新間隔が長いので、しきい値は avg で変える（約 3 秒 / 5 秒 / 8 秒）。実機で要調整。
class StaleDetector {
 public:
  StaleDetector() : last_(0), same_(0), have_(false) {}
  static int threshold(uint8_t avg) { return avg >= 16 ? 32 : (avg >= 8 ? 20 : 12); }
  // 戻り値: 更新停止なら true
  bool feed(uint32_t rawKey, uint8_t avg) {
    if (have_ && rawKey == last_) { if (same_ < 1000) same_++; } else { same_ = 0; }
    last_ = rawKey; have_ = true;
    return same_ >= threshold(avg);
  }
  void reset() { have_ = false; same_ = 0; }
 private:
  uint32_t last_; int same_; bool have_;
};

}  // namespace tcf

#pragma once
// MAX31855 の 32bit 読み出しを解釈する（純粋関数。native テスト対象）
//   D31:18 熱電対温度（14bit 符号付き、0.25℃）、D16 FAULT、D15:4 内部温度（12bit 符号付き、0.0625℃）
//   D2 SCV、D1 SCG、D0 OC。全0 / 全1 は NO_DEVICE（SPEC 2.5）
#include <math.h>
#include "TcDriver.h"
#include "TcFault.h"
#include "NistK.h"

namespace max31855 {

inline float rawTc(uint32_t w) {
  int32_t v = (int32_t)(w >> 18) & 0x3FFF;
  if (v & 0x2000) v -= 0x4000;
  return v * 0.25f;
}
inline float rawCj(uint32_t w) {
  int32_t v = (int32_t)(w >> 4) & 0x0FFF;
  if (v & 0x0800) v -= 0x1000;
  return v * 0.0625f;
}

inline TcReading decode(uint32_t w) {
  TcReading r{NAN, NAN, TC_OK};
  r.fault = tcf::faultFromMax31855(w);
  if (r.fault == TC_NO_DEVICE) return r;
  r.cjC = rawCj(w);
  if (r.fault != TC_OK) return r;
  if (r.cjC > 125.0f || r.cjC < -40.0f) { r.fault = TC_CJ_RANGE; return r; }
  double t = nistk::correctMax31855(rawTc(w), r.cjC);
  if (t > 1350.0 || t < -200.0) { r.fault = TC_RANGE; return r; }
  r.tempC = (float)t;
  return r;
}

// 試験用: 真の温度と冷接点温度から、チップが出す 32bit を作る（0.25℃ / 0.0625℃ に量子化）
inline uint32_t encodeForTest(double tLin, double tCj) {
  int32_t a = (int32_t)lround(tLin / 0.25) & 0x3FFF;
  int32_t b = (int32_t)lround(tCj / 0.0625) & 0x0FFF;
  return ((uint32_t)a << 18) | ((uint32_t)b << 4);
}

}  // namespace max31855

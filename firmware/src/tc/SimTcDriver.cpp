#include "SimTcDriver.h"
#include <math.h>

float SimTcDriver::noise() {
  rng_ = rng_ * 1664525u + 1013904223u;
  return ((float)((rng_ >> 8) & 0xFFFF) / 65535.0f - 0.5f) * 0.6f;  // ±0.3℃
}

bool SimTcDriver::read(TcReading& out) {
  uint32_t t = now_();
  if (faultOn_) {
    if ((int32_t)(t - faultUntil_) < 0) { out.tempC = NAN; out.cjC = 25.0f; out.fault = faultCode_; return true; }
    faultOn_ = false;
  }
  // 周期 300 秒、チャンネルごとに位相と振幅をずらす
  const float PI2 = 6.2831853f;
  float ph = PI2 * ((float)(t % 300000u) / 300000.0f) - 1.5707963f + idx_ * 0.35f;
  float mid = 125.0f - idx_ * 15.0f, amp = 105.0f - idx_ * 20.0f;
  out.tempC = mid + amp * sinf(ph) + noise();
  out.cjC = 25.4f + 0.2f * sinf(PI2 * (float)(t % 600000u) / 600000.0f);
  out.fault = TC_OK;
  return true;
}

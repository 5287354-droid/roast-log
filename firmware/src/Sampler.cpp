#include "Sampler.h"
#include <algorithm>

AggResult aggregateReads(const TcReading* r, int n) {
  float vals[AGG_READS]; int k = 0; uint8_t lastFault = TC_NO_DEVICE;
  for (int i = 0; i < n && i < AGG_READS; i++) {
    if (r[i].fault == TC_OK && std::isfinite(r[i].tempC)) vals[k++] = r[i].tempC;
    else lastFault = r[i].fault != TC_OK ? r[i].fault : TC_NO_DEVICE;
  }
  if (k == 0) return {false, 0.0f, lastFault};
  std::sort(vals, vals + k);
  float m = (k % 2) ? vals[k / 2] : (vals[k / 2 - 1] + vals[k / 2]) * 0.5f;
  return {true, m, TC_OK};
}

RangePlan Ring::plan(int64_t from, int64_t to) const {
  RangePlan p{0, 0, false, false};
  int64_t bf0 = bufFrom();
  if (from < bf0) { from = bf0; p.lost = true; }
  if (to > (int64_t)seq_) to = seq_;
  if (from > to) { p.from = (uint32_t)(from < 0 ? 0 : from); p.to = p.from - 1; p.empty = true; return p; }
  p.from = (uint32_t)from; p.to = (uint32_t)to;
  return p;
}

static int16_t tenths(float v) { return (int16_t)lroundf(v * 10.0f); }

bool Sampler::pushReads(const TcReading r[3], uint32_t nowMs, const DeviceConfig& cfg, Sample& out) {
  for (int c = 0; c < 3; c++) slot_[c][n_] = r[c];
  if (++n_ < AGG_READS) return false;
  n_ = 0;
  out.ms = nowMs;
  float cjSum = 0; int cjN = 0;
  for (int c = 0; c < 3; c++) {
    if (!cfg.ch[c].enabled) { out.v[c] = NIL; out.f[c] = 0; continue; }
    AggResult a = aggregateReads(slot_[c], AGG_READS);
    if (a.valid) {
      out.v[c] = tenths(a.value + cfg.ch[c].off10 / 10.0f);
      out.f[c] = 0;
      for (int i = 0; i < AGG_READS; i++) if (slot_[c][i].fault == TC_OK && std::isfinite(slot_[c][i].cjC)) { cjSum += slot_[c][i].cjC; cjN++; }
    } else { out.v[c] = NIL; out.f[c] = a.fault; }
  }
  out.cj = cjN ? tenths(cjSum / cjN) : NIL;
  return true;
}

#pragma once
// NIST ITS-90 K 型熱電対の多項式（NIST Monograph 175）。純粋関数・ヘッダのみ。
// MAX31855 は 41.276 µV/℃ の直線近似で温度を出すので、これで補正する（SPEC 6.2）。
#include <math.h>

namespace nistk {

// 温度[℃] → 熱起電力[mV]（基準接点 0℃）
inline double mvFromC(double t) {
  if (t < 0) {
    static const double c[] = {0.0, 0.394501280250e-01, 0.236223735980e-04, -0.328589067840e-06, -0.499048287770e-08,
                               -0.675090591730e-10, -0.574103274280e-12, -0.310888728940e-14, -0.104516093650e-16,
                               -0.198892668780e-19, -0.163226974860e-22};
    double e = 0, p = 1;
    for (double ci : c) { e += ci * p; p *= t; }
    return e;
  }
  static const double c[] = {-0.176004136860e-01, 0.389212049750e-01, 0.185587700320e-04, -0.994575928740e-07,
                             0.318409457190e-09, -0.560728448890e-12, 0.560750590590e-15, -0.320207200030e-18,
                             0.971511471520e-22, -0.121047212750e-25};
  double e = 0, p = 1;
  for (double ci : c) { e += ci * p; p *= t; }
  const double a0 = 0.118597600000e+00, a1 = -0.118343200000e-03, a2 = 0.126968600000e+03;
  return e + a0 * exp(a1 * (t - a2) * (t - a2));
}

// 熱起電力[mV] → 温度[℃]（逆関数の多項式。-200〜1372℃）
inline double cFromMv(double e) {
  const double* d; int n;
  static const double dn[] = {0.0, 2.5173462e+01, -1.1662878, -1.0833638, -8.9773540e-01, -3.7342377e-01,
                              -8.6632643e-02, -1.0450598e-02, -5.1920577e-04};
  static const double d0[] = {0.0, 2.508355e+01, 7.860106e-02, -2.503131e-01, 8.315270e-02, -1.228034e-02,
                              9.804036e-04, -4.413030e-05, 1.057734e-06, -1.052755e-08};
  static const double d1[] = {-1.318058e+02, 4.830222e+01, -1.646031, 5.464731e-02, -9.650715e-04, 8.802193e-06,
                              -3.110810e-08};
  if (e < 0) { d = dn; n = 9; } else if (e < 20.644) { d = d0; n = 10; } else { d = d1; n = 7; }
  double t = 0, p = 1;
  for (int i = 0; i < n; i++) { t += d[i] * p; p *= e; }
  return t;
}

// MAX31855 の出力（直線近似の熱電対温度 tLin と冷接点温度 tCj）を NIST で補正する
//   チップが測った電圧 V = (tLin - tCj) × 0.041276 mV/℃ → 冷接点分 E(tCj) を足す → 逆変換
inline double correctMax31855(double tLin, double tCj) {
  double v = (tLin - tCj) * 0.041276;
  return cFromMv(v + mvFromC(tCj));
}

}  // namespace nistk

#include "Max31855Driver.h"
#include <Arduino.h>
#include <SPI.h>
#include "Max31855Decode.h"

static const uint32_t SPI_HZ = 1000000;

uint32_t Max31855Driver::read32() {
  SPI.beginTransaction(SPISettings(SPI_HZ, MSBFIRST, SPI_MODE0));
  digitalWrite(cs_, LOW);
  delayMicroseconds(1);
  uint32_t w = 0;
  for (int i = 0; i < 4; i++) w = (w << 8) | SPI.transfer(0x00);
  digitalWrite(cs_, HIGH);
  SPI.endTransaction();
  return w;
}

bool Max31855Driver::begin() {
  stale_.reset();
  delay(200);   // 電源投入後の最初の変換を待つ
  return tcf::faultFromMax31855(read32()) != TC_NO_DEVICE;
}

bool Max31855Driver::read(TcReading& out) {
  uint32_t w = read32();
  out = max31855::decode(w);
  if (out.fault != TC_OK) { stale_.reset(); return true; }
  // 更新停止の検出: 生の 32bit（熱電対 + 冷接点）が長いあいだ 1bit も変わらなければ、変換が止まっているとみなす。
  // 0.25℃ 刻みなので、本当に温度が動かないときも同じ値になりうる。そのためしきい値は長め（20 秒。実機で要調整）
  if (stale_.feedN(w, MAX31855_STALE_READS)) { out.tempC = NAN; out.fault = TC_STALE; }
  return true;
}

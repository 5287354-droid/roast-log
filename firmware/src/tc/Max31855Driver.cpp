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
  delay(200);   // 電源投入後の最初の変換を待つ
  return tcf::faultFromMax31855(read32()) != TC_NO_DEVICE;
}

bool Max31855Driver::read(TcReading& out) {
  out = max31855::decode(read32());
  return true;
}

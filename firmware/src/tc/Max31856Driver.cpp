#include "Max31856Driver.h"
#include <Arduino.h>
#include <SPI.h>
#include <math.h>

static const uint32_t SPI_HZ = 1000000;  // 配線 10cm 程度、ノイズ耐性優先（SPEC 6.3）

void Max31856Driver::readRegs(uint8_t addr, uint8_t* buf, uint8_t n) {
  SPI.beginTransaction(SPISettings(SPI_HZ, MSBFIRST, SPI_MODE1));
  digitalWrite(cs_, LOW);
  SPI.transfer(addr & 0x7F);
  for (uint8_t i = 0; i < n; i++) buf[i] = SPI.transfer(0x00);
  digitalWrite(cs_, HIGH);
  SPI.endTransaction();
}
void Max31856Driver::writeReg(uint8_t addr, uint8_t v) {
  SPI.beginTransaction(SPISettings(SPI_HZ, MSBFIRST, SPI_MODE1));
  digitalWrite(cs_, LOW);
  SPI.transfer(addr | 0x80);
  SPI.transfer(v);
  digitalWrite(cs_, HIGH);
  SPI.endTransaction();
}

// CR0 / CR1 を書いて読み戻す。CR0: 連続変換 + OCFAULT=01 + 50/60Hz。CR1: AVGSEL + K 型(0011)
bool Max31856Driver::applyAndVerify() {
  uint8_t want0 = tcf::cr0Value(cfg_.mains), want1 = tcf::cr1Value(cfg_.avg);
  writeReg(0x01, want1);
  writeReg(0x00, want0);
  delay(2);
  uint8_t r[2];
  readRegs(0x00, r, 2);
  cr0_ = r[0]; cr1_ = r[1];
  verified_ = tcf::cr0Matches(r[0], cfg_.mains) && r[1] == want1;
  return verified_;
}

bool Max31856Driver::begin() {
  uint8_t regs[16];
  readRegs(0x00, regs, 16);
  if (tcf::looksAbsent(regs)) { present_ = false; verified_ = false; return false; }
  present_ = applyAndVerify();
  stale_.reset();
  return present_;
}

void Max31856Driver::configure(const TcConfig& c) {
  cfg_ = c;
  present_ = applyAndVerify();
  stale_.reset();
}

bool Max31856Driver::read(TcReading& out) {
  out.tempC = NAN; out.cjC = NAN;
  uint8_t regs[16];
  readRegs(0x00, regs, 16);   // CR0 .. SR をまとめて読む
  if (tcf::looksAbsent(regs)) { present_ = false; verified_ = false; out.fault = TC_NO_DEVICE; return true; }
  // 設定が飛んだ（電源ドロップなど）ら書き直す。今回の値は信用しない
  if (!tcf::cr0Matches(regs[0], cfg_.mains) || regs[1] != tcf::cr1Value(cfg_.avg)) {
    present_ = applyAndVerify();
    out.fault = TC_NO_DEVICE;
    return true;
  }
  present_ = true; cr0_ = regs[0]; cr1_ = regs[1]; verified_ = true;
  uint8_t sr = regs[0x0F];
  uint8_t fault = tcf::faultFromMax31856(sr);
  out.cjC = tcf::cjFromRaw(regs[0x0A], regs[0x0B]);
  if (fault != TC_OK) { out.fault = fault; stale_.reset(); return true; }
  uint32_t key = ((uint32_t)regs[0x0C] << 16) | ((uint32_t)regs[0x0D] << 8) | regs[0x0E];
  key ^= ((uint32_t)regs[0x0A] << 24) ^ ((uint32_t)regs[0x0B] << 28);   // CJ の変化も更新とみなす
  if (stale_.feed(key, cfg_.avg)) { out.fault = TC_STALE; return true; }
  out.tempC = tcf::tcFromRaw(regs[0x0C], regs[0x0D], regs[0x0E]);
  out.fault = TC_OK;
  return true;
}

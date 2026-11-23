#include <Arduino.h>
#include "TcDriver.h"
#include "../../include/pins.h"
#include "Max31856Driver.h"
#include "Max31855Driver.h"
#include "Mcp9600Driver.h"
#include "SimTcDriver.h"

static uint32_t nowMs() { return millis(); }

TcDriver* makeDriver(uint8_t idx) {
  static const uint8_t cs[3] = {PIN_CS1, PIN_CS2, PIN_CS3};
#if defined(TC_DRIVER_SIM)
  (void)cs; return new SimTcDriver(idx, nowMs);
#elif defined(TC_DRIVER_MAX31855)
  return new Max31855Driver(cs[idx]);
#elif defined(TC_DRIVER_MCP9600)
  return new Mcp9600Driver(0x60 + idx);
#else
  return new Max31856Driver(cs[idx]);
#endif
}

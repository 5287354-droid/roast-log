#pragma once
// SPEC 6.1。GPIO 番号で書く（XIAO の D 番号ではない）
#if defined(BOARD_XIAO_C3)
  #define PIN_SCK 8
  #define PIN_MISO 9
  #define PIN_MOSI 10
  #define PIN_CS1 3
  #define PIN_CS2 4
  #define PIN_CS3 5
  #define PIN_LED 6
  #define PIN_BTN 7
#elif defined(BOARD_ESP32C3_DEVKIT)
  #define PIN_SCK 4
  #define PIN_MISO 5
  #define PIN_MOSI 6
  #define PIN_CS1 7
  #define PIN_CS2 10
  #define PIN_CS3 3
  #define PIN_LED 8
  #define PIN_BTN 9
#elif defined(BOARD_ESP32DEV)
  #define PIN_SCK 18
  #define PIN_MISO 19
  #define PIN_MOSI 23
  #define PIN_CS1 5
  #define PIN_CS2 17
  #define PIN_CS3 16
  #define PIN_LED 2
  #define PIN_BTN 0
#else
  #define PIN_SCK 0
  #define PIN_MISO 0
  #define PIN_MOSI 0
  #define PIN_CS1 0
  #define PIN_CS2 0
  #define PIN_CS3 0
  #define PIN_LED 0
  #define PIN_BTN 0
#endif

#pragma once
// SPEC 6.1。GPIO 番号で書く（XIAO の D 番号ではない）
#if defined(BOARD_XIAO_C3)
  #define PIN_SCK 8
  // MISO は D7 / GPIO20（SPEC 9.6）。GPIO9（D9）は C3 の起動モードを決めるピン（BOOT ボタンと共用）で、
  // アンプの DO が起動時に Low だと書き込みモードに入って起動しないおそれがあるので使わない。
  // GPIO20 は U0RXD だが、この機器は USB CDC（USB-Serial-JTAG）でシリアルを使い、UART0 は使わないので問題ない
  // （起動時の ROM ログも出るのは TX の GPIO21 だけ）。
  #define PIN_MISO 20
  #define PIN_MOSI 10
  #define PIN_CS1 3
  #define PIN_CS2 4
  #define PIN_CS3 5
  #define PIN_LED 6
  #define PIN_BTN 7
#elif defined(BOARD_ESP32C3_DEVKIT)
  // 未検証（試験対象外）。ESP32-C3-DevKitM-1 は実機が無く、書き込みページにも載せない。
  // GPIO8（LED）はストラッピングピンかつ基板の RGB LED のデータ線なので、実機で使うなら配線を見直すこと
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

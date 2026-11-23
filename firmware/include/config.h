#pragma once
#define FW_VERSION "0.1.0"
#define PROTO_VERSION 1
#ifndef FW_BUILD
#define FW_BUILD FW_VERSION
#endif

#if defined(BOARD_XIAO_C3)
#define MODEL_NAME "RL-C3-3"
#elif defined(BOARD_ESP32C3_DEVKIT)
#define MODEL_NAME "RL-C3DK-3"
#elif defined(BOARD_ESP32DEV)
#define MODEL_NAME "RL-ESP32-3"
#else
#define MODEL_NAME "RL-HOST"
#endif

// 既定値
#define DEFAULT_MAINS_HZ 50
#define DEFAULT_AVG 4
#define DEFAULT_HOSTNAME "roast"

// 計測
#define READ_PERIOD_MS 250
#define AGG_READS 4          // 250ms x 4 = 1 秒
#define RING_CAPACITY 3600   // 1 時間
#define BF_MAX_SAMPLES 300
#define MAX_WS_CLIENTS 4
#define HELLO_DELAY_MS 1000  // hi が無くても hello を送るまで
#define ST_EVERY_SEQ 10

// Wi-Fi
#define STA_CONNECT_TIMEOUT_MS 20000
#define AP_FALLBACK_NO_CLIENT_MS 30000
#define BUTTON_LONG_PRESS_MS 5000

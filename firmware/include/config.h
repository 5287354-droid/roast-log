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
#define BF_MAX_SAMPLES 120   // bf 1 フレームの最大サンプル数（約 3KB）。送信キューが空のときだけ次を積む（SPEC 9.6）
#define MAX_WS_CLIENTS 4
#define HELLO_DELAY_MS 1000  // hi が無くても hello を送るまで
#define ST_EVERY_SEQ 10

// Wi-Fi
#define STA_CONNECT_TIMEOUT_MS 20000
#define AP_FALLBACK_NO_CLIENT_MS 30000
#define BUTTON_LONG_PRESS_MS 5000
#define BUTTON_SHORT_MIN_MS 50          // これ未満はチャタリングとみなす
#define WIFI_WINDOW_MS 60000            // STA のとき、ボタンを短く押してから /api/wifi を受け付ける時間
#define STA_RETRY_PERIOD_MS 60000       // AP のままのとき、保存済みの Wi-Fi をつなぎ直す間隔（クライアント 0 のときだけ）
#define AP_SERIAL_PERIOD_MS 10000       // AP の間、AP 名とパスワードをシリアルに出す間隔
#define IMPROV_CONNECT_TIMEOUT_MS 20000 // Improv で受け取った Wi-Fi に繋がるまで待つ時間
#define IDENTIFY_MS 3000
#define MAX31855_STALE_READS 80         // MAX31855 の生の値が 250ms x 80 = 20 秒変わらなければ更新停止（実機で要調整）
#define WS_SWEEP_MS 1000                // WsHub が実体の無い接続枠を片付ける間隔

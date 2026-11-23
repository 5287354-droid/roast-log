#pragma once
// 設定モデル（NVS に保存する中身）と setcfg の適用。Arduino に依存しない。
#include <stdint.h>
#include <string>
#include <ArduinoJson.h>

static const int16_t NIL = INT16_MIN;  // 温度の null

struct ChannelCfg {
  bool enabled;
  uint8_t role;        // index into kRoles
  char name[80];       // UTF-8（24 文字まで）
  char color[8];       // "#RRGGBB"
  int16_t off10;       // 補正値（0.1℃ 単位）
};
struct DeviceConfig {
  ChannelCfg ch[3];
  uint8_t mains;       // 50 | 60
  uint8_t avg;         // 1,2,4,8,16
  uint8_t rateHz;      // 1
  uint32_t rev;        // 設定を変えるたび +1（NVS に保存）
};

extern const char* const kRoles[5];  // bt et amb inlet off
void cfgDefaults(DeviceConfig& c);
int roleIndex(const char* s);        // -1 = 不正
int utf16Len(const char* s);         // JS の String.length 相当

// setcfg（baseRev と差分）を適用する。戻り値: nullptr = 成功（rev は +1 される）、
// それ以外はエラーコード（"stale" "bad_channel" "bad_value"）。失敗時は cfg を変えない。
// baseRev が無ければ rev の検査はしない（古いクライアントとの互換）。
const char* applySetcfg(DeviceConfig& cfg, JsonObjectConst m);

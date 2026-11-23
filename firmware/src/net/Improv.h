#pragma once
// Improv Serial（https://www.improv-wifi.com/serial/）。ESP Web Tools の「Wi-Fi を設定」から Wi-Fi を設定できる（SPEC 9.6）。
// Arduino に依存しない（パケットの組み立てと解釈だけ。native テスト対象）。
//
// パケット: "IMPROV" + バージョン(1) + 種類 + 長さ + データ + チェックサム（ここまでの全バイトの和の下位 8bit）
//   種類: 0x01 現在の状態 / 0x02 エラー / 0x03 RPC 命令 / 0x04 RPC 結果
//   RPC 命令のデータ: 命令 ID + データ長 + データ
#include <stdint.h>
#include <string>
#include <vector>

class ImprovSerial {
 public:
  enum State : uint8_t { ST_READY = 0x02, ST_PROVISIONING = 0x03, ST_PROVISIONED = 0x04 };
  enum Err : uint8_t { ERR_NONE = 0x00, ERR_INVALID_RPC = 0x01, ERR_UNKNOWN_RPC = 0x02, ERR_UNABLE_CONNECT = 0x03, ERR_NOT_AUTHORIZED = 0x04, ERR_UNKNOWN = 0xFF };
  enum Cmd : uint8_t { CMD_NONE = 0, CMD_WIFI = 0x01, CMD_IDENTIFY = 0x02, CMD_GET_STATE = 0x03, CMD_GET_INFO = 0x04, CMD_SCAN = 0x05 };

  struct Rpc { Cmd cmd = CMD_NONE; std::string ssid, pass; };

  // 1 バイト食べる。RPC 命令が 1 つ完成したら true（out に入る）。
  // 形の壊れた RPC（長さの不整合など）は ERR_INVALID_RPC を lastError() に残して false を返す。他のテキスト（JSON の行など）は読み捨てる
  bool feed(uint8_t b, Rpc& out);
  Err takeError() { Err e = err_; err_ = ERR_NONE; return e; }

  static std::string state(State s);
  static std::string error(Err e);
  // RPC 結果。strings の各要素は「長さ 1 バイト + 本体」で並べる（255 バイトまで）
  static std::string result(Cmd cmd, const std::vector<std::string>& strings);
  // 終わりを示す空の結果（Wi-Fi 一覧の最後）
  static std::string resultEmpty(Cmd cmd);

 private:
  static std::string packet(uint8_t type, const std::string& data);
  bool finish(Rpc& out);
  std::string buf_;
  Err err_ = ERR_NONE;
};

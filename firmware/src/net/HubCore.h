#pragma once
// WsHub の中身のうち、Arduino に依存しない部分（native テスト対象。SPEC 9.6 B4 / B5）。
//
// 役割の分担:
//  - AsyncTCP のタスク側（onConnect / onDisconnect / onData）は、小さな表とキューに書くだけ。ws_.count() など
//    ライブラリの内部リストには触らない（競合を避ける。接続の数は自前で数える）
//  - loop() 側（loop）が、表とキューを読んで ProtocolEngine に渡す
//
// 接続の出入り（open / close）は、あふれるキューではなく「表」に記録する。だから close の知らせを落とすことが無い。
// それでも表と実体がずれたとき（ライブラリが DISCONNECT を呼ばなかった等）に備えて、WS_SWEEP_MS ごとに
// 実体の無い枠を片付ける。メッセージ（hi / ping / setcfg など）のキューはあふれたら捨てる（アプリが再送する）。
#include <stdint.h>
#include <string.h>
#include "WsProtocol.h"
#include "../../include/config.h"

#if defined(ARDUINO)
#include <Arduino.h>
struct HubLock {
  portMUX_TYPE m = portMUX_INITIALIZER_UNLOCKED;
  void enter() { portENTER_CRITICAL(&m); }
  void exit() { portEXIT_CRITICAL(&m); }
};
#else
struct HubLock { void enter() {} void exit() {} };
#endif

// 接続の実体（AsyncWebSocket）への問い合わせ
class HubTransport {
 public:
  virtual ~HubTransport() {}
  virtual bool alive(uint32_t id) = 0;   // その id の接続がまだ生きているか
  virtual void close(uint32_t id) = 0;
};

class HubCore {
 public:
  static const int TABLE = 8;    // 接続の表（MAX_WS_CLIENTS + 片付け待ち）
  static const int QN = 8;       // メッセージのキュー
  static const size_t MSG_MAX = 1536;

  HubCore() { q_ = new Ev[QN]; }
  ~HubCore() { delete[] q_; }

  // ---- AsyncTCP のタスクから（短く、ブロックしない）
  bool onConnect(uint32_t id);       // false = 受け付けない（呼び出し側で閉じる）
  void onDisconnect(uint32_t id);
  bool onData(uint32_t id, const uint8_t* d, size_t n);   // false = 捨てた
  int liveCount();                   // 自前で数えた接続数（NEW + OPEN）

  // ---- loop() から
  void loop(uint32_t now, ProtocolEngine& eng, Sink& sink, HubTransport& tr);
  uint32_t droppedMsgs() const { return dropped_; }
  uint32_t sweptSlots() const { return swept_; }

 private:
  enum St : uint8_t { FREE = 0, NEW_, OPEN_, GONE };
  struct Slot { St st; uint32_t id; };
  struct Ev { uint16_t len; uint32_t id; char data[MSG_MAX]; };
  void sweep(ProtocolEngine& eng, HubTransport& tr);
  Slot t_[TABLE] = {};
  Ev* q_;
  volatile int head_ = 0, tail_ = 0;
  HubLock lock_;
  uint32_t lastSweep_ = 0;
  volatile uint32_t dropped_ = 0, swept_ = 0;
  Ev ev_;   // 1.5KB。スタックに置かない
};

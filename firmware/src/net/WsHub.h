#pragma once
// AsyncWebSocket と ProtocolEngine のあいだの橋。
// WS のコールバック（AsyncTCP のタスク）では何も処理せず、HubCore の表とキューに積むだけ。
// 解釈・応答・ring の読み出しはすべて loop() から行う（SPI と同じ理由: スレッド安全）。
// 接続の数はコールバックの中で ws_.count() を呼ばず、HubCore が自前で数える（SPEC 9.6 B4）。
#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include "WsProtocol.h"
#include "HubCore.h"

class WsHub : public Sink, private HubTransport {
 public:
  WsHub() : ws_("/ws") {}
  void begin(AsyncWebServer& server, ProtocolEngine& eng);
  void loop(uint32_t nowMs);     // 表とキューを処理して pump し、1 秒ごとに枠を片付ける
  uint32_t droppedMsgs() const { return core_.droppedMsgs(); }
  // Sink
  bool canSend(uint32_t id) override;
  bool canSendBf(uint32_t id) override;   // 送信キューが空のときだけ
  void send(uint32_t id, const std::string& text) override;
 private:
  // HubTransport
  bool alive(uint32_t id) override;
  void close(uint32_t id) override;
  void onEvent(AsyncWebSocket* s, AsyncWebSocketClient* c, AwsEventType t, void* arg, uint8_t* data, size_t len);
  AsyncWebSocket ws_;
  ProtocolEngine* eng_ = nullptr;
  HubCore core_;
};

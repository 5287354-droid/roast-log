#pragma once
// AsyncWebSocket と ProtocolEngine のあいだの橋。
// WS のコールバック（AsyncTCP のタスク）では何も処理せず、キューに積むだけ。
// 解釈・応答・ring の読み出しはすべて loop() から pump() で行う（SPI と同じ理由: スレッド安全）。
#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include "WsProtocol.h"

class WsHub : public Sink {
 public:
  WsHub() : ws_("/ws") {}
  void begin(AsyncWebServer& server, ProtocolEngine& eng);
  void loop(uint32_t nowMs);     // キューを処理して pump する
  // Sink
  bool canSend(uint32_t id) override;
  void send(uint32_t id, const std::string& text) override;
 private:
  struct Ev { uint8_t kind; uint32_t id; uint16_t len; char data[1536]; };   // kind: 0=open 1=close 2=msg
  static const int QN = 8;
  bool push(uint8_t kind, uint32_t id, const uint8_t* d, size_t n);
  void onEvent(AsyncWebSocket* s, AsyncWebSocketClient* c, AwsEventType t, void* arg, uint8_t* data, size_t len);
  AsyncWebSocket ws_;
  ProtocolEngine* eng_ = nullptr;
  Ev* q_ = nullptr;
  volatile int head_ = 0, tail_ = 0;
  portMUX_TYPE mux_ = portMUX_INITIALIZER_UNLOCKED;
  uint32_t lastClean_ = 0;
};

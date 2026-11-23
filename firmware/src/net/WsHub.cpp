#include "WsHub.h"
#include "../../include/config.h"

void WsHub::begin(AsyncWebServer& server, ProtocolEngine& eng) {
  eng_ = &eng;
  ws_.onEvent([this](AsyncWebSocket* s, AsyncWebSocketClient* c, AwsEventType t, void* a, uint8_t* d, size_t l) { onEvent(s, c, t, a, d, l); });
  server.addHandler(&ws_);
}

// AsyncTCP タスクから呼ばれる（cleanupClients の中から loop() で呼ばれる DISCONNECT もある）。表とキューに書くだけ
void WsHub::onEvent(AsyncWebSocket*, AsyncWebSocketClient* c, AwsEventType t, void* arg, uint8_t* data, size_t len) {
  if (t == WS_EVT_CONNECT) {
    if (!core_.onConnect(c->id())) c->close();               // 最大 4 クライアント（自前で数える。ws_.count() は呼ばない）
  } else if (t == WS_EVT_DISCONNECT) {
    core_.onDisconnect(c->id());
  } else if (t == WS_EVT_DATA) {
    AwsFrameInfo* info = (AwsFrameInfo*)arg;
    if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) core_.onData(c->id(), data, len);
  }
}

bool WsHub::canSend(uint32_t id) {
  AsyncWebSocketClient* c = ws_.client(id);
  return c && c->status() == WS_CONNECTED && c->canSend();
}
bool WsHub::canSendBf(uint32_t id) {
  AsyncWebSocketClient* c = ws_.client(id);
  return c && c->status() == WS_CONNECTED && c->queueLen() == 0;
}
void WsHub::send(uint32_t id, const std::string& text) {
  AsyncWebSocketClient* c = ws_.client(id);
  if (c && c->status() == WS_CONNECTED) c->text(text.c_str(), text.size());
}
bool WsHub::alive(uint32_t id) { AsyncWebSocketClient* c = ws_.client(id); return c && c->status() == WS_CONNECTED; }
void WsHub::close(uint32_t id) { AsyncWebSocketClient* c = ws_.client(id); if (c) c->close(); }

void WsHub::loop(uint32_t now) {
  core_.loop(now, *eng_, *this, *this);
  static uint32_t lastClean = 0;
  if ((int32_t)(now - lastClean) >= (int32_t)WS_SWEEP_MS) { lastClean = now; ws_.cleanupClients(MAX_WS_CLIENTS + 4); }   // 切れた接続の本体を片付ける
}

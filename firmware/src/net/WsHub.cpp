#include "WsHub.h"
#include "../../include/config.h"

void WsHub::begin(AsyncWebServer& server, ProtocolEngine& eng) {
  eng_ = &eng;
  q_ = new Ev[QN];
  ws_.onEvent([this](AsyncWebSocket* s, AsyncWebSocketClient* c, AwsEventType t, void* a, uint8_t* d, size_t l) { onEvent(s, c, t, a, d, l); });
  server.addHandler(&ws_);
}

bool WsHub::push(uint8_t kind, uint32_t id, const uint8_t* d, size_t n) {
  bool ok = false;
  portENTER_CRITICAL(&mux_);
  int nx = (head_ + 1) % QN;
  if (nx != tail_) {
    Ev& e = q_[head_];
    e.kind = kind; e.id = id; e.len = (uint16_t)n;
    if (n) memcpy(e.data, d, n);
    head_ = nx; ok = true;
  }
  portEXIT_CRITICAL(&mux_);
  return ok;
}

// AsyncTCP タスクから呼ばれる。積むだけ
void WsHub::onEvent(AsyncWebSocket*, AsyncWebSocketClient* c, AwsEventType t, void* arg, uint8_t* data, size_t len) {
  if (t == WS_EVT_CONNECT) {
    if (ws_.count() > MAX_WS_CLIENTS) { c->close(); return; }   // 最大 4 クライアント
    push(0, c->id(), nullptr, 0);
  } else if (t == WS_EVT_DISCONNECT) {
    push(1, c->id(), nullptr, 0);
  } else if (t == WS_EVT_DATA) {
    AwsFrameInfo* info = (AwsFrameInfo*)arg;
    if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT && len <= sizeof(Ev::data)) push(2, c->id(), data, len);
  }
}

bool WsHub::canSend(uint32_t id) {
  AsyncWebSocketClient* c = ws_.client(id);
  return c && c->status() == WS_CONNECTED && c->canSend();
}
void WsHub::send(uint32_t id, const std::string& text) {
  AsyncWebSocketClient* c = ws_.client(id);
  if (c && c->status() == WS_CONNECTED) c->text(text.c_str(), text.size());
}

void WsHub::loop(uint32_t now) {
  static Ev ev;   // 1536B。スタックに置かない
  for (;;) {
    bool have = false;
    portENTER_CRITICAL(&mux_);
    if (tail_ != head_) { ev = q_[tail_]; tail_ = (tail_ + 1) % QN; have = true; }
    portEXIT_CRITICAL(&mux_);
    if (!have) break;
    if (ev.kind == 0) { if (!eng_->onOpen(ev.id, now)) { AsyncWebSocketClient* c = ws_.client(ev.id); if (c) c->close(); } }
    else if (ev.kind == 1) eng_->onClose(ev.id);
    else eng_->onMessage(ev.id, ev.data, ev.len, now, *this);
  }
  eng_->pump(now, *this);
  if (now - lastClean_ > 1000) { lastClean_ = now; ws_.cleanupClients(MAX_WS_CLIENTS); }
}

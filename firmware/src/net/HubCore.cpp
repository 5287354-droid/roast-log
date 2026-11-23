#include "HubCore.h"

int HubCore::liveCount() {
  int n = 0;
  lock_.enter();
  for (auto& s : t_) if (s.st == NEW_ || s.st == OPEN_) n++;
  lock_.exit();
  return n;
}

bool HubCore::onConnect(uint32_t id) {
  bool ok = false;
  lock_.enter();
  int live = 0, freeIx = -1;
  for (int i = 0; i < TABLE; i++) {
    if (t_[i].st == NEW_ || t_[i].st == OPEN_) live++;
    if (t_[i].st == FREE && freeIx < 0) freeIx = i;
  }
  if (live < MAX_WS_CLIENTS && freeIx >= 0) { t_[freeIx].st = NEW_; t_[freeIx].id = id; ok = true; }
  lock_.exit();
  return ok;
}

void HubCore::onDisconnect(uint32_t id) {
  lock_.enter();
  for (auto& s : t_) {
    if (s.st == FREE || s.id != id) continue;
    s.st = (s.st == NEW_) ? FREE : GONE;   // まだ engine が知らない接続は、そのまま消す
  }
  lock_.exit();
}

bool HubCore::onData(uint32_t id, const uint8_t* d, size_t n) {
  if (n > MSG_MAX) { dropped_++; return false; }
  bool ok = false;
  lock_.enter();
  int nx = (head_ + 1) % QN;
  if (nx != tail_) {
    Ev& e = q_[head_];
    e.id = id; e.len = (uint16_t)n;
    if (n) memcpy(e.data, d, n);
    head_ = nx; ok = true;
  } else dropped_++;
  lock_.exit();
  return ok;
}

void HubCore::loop(uint32_t now, ProtocolEngine& eng, Sink& sink, HubTransport& tr) {
  // 1) 接続の出入り。先に close を全部処理してから open（engine の枠を先に空ける）
  for (int i = 0; i < TABLE; i++) {
    bool gone = false; uint32_t id = 0;
    lock_.enter();
    if (t_[i].st == GONE) { gone = true; id = t_[i].id; t_[i].st = FREE; }
    lock_.exit();
    if (gone) eng.onClose(id);
  }
  for (int i = 0; i < TABLE; i++) {
    bool opened = false; uint32_t id = 0;
    lock_.enter();
    if (t_[i].st == NEW_) { opened = true; id = t_[i].id; t_[i].st = OPEN_; }
    lock_.exit();
    if (!opened) continue;
    if (!eng.onOpen(id, now)) {
      tr.close(id);
      lock_.enter(); if (t_[i].st == OPEN_ && t_[i].id == id) t_[i].st = GONE; lock_.exit();
    }
  }
  // 2) メッセージ
  for (;;) {
    bool have = false;
    lock_.enter();
    if (tail_ != head_) { ev_ = q_[tail_]; tail_ = (tail_ + 1) % QN; have = true; }
    lock_.exit();
    if (!have) break;
    eng.onMessage(ev_.id, ev_.data, ev_.len, now, sink);
  }
  eng.pump(now, sink);
  // 3) 実体の無い枠の片付け
  if ((int32_t)(now - lastSweep_) >= (int32_t)WS_SWEEP_MS) { lastSweep_ = now; sweep(eng, tr); }
}

void HubCore::sweep(ProtocolEngine& eng, HubTransport& tr) {
  // 表の OPEN で実体が無いもの → engine の枠も表の枠も空ける
  for (int i = 0; i < TABLE; i++) {
    bool dead = false; uint32_t id = 0;
    lock_.enter(); if (t_[i].st == OPEN_) id = t_[i].id; lock_.exit();
    if (id == 0 || tr.alive(id)) continue;
    lock_.enter();
    if (t_[i].st == OPEN_ && t_[i].id == id) { t_[i].st = FREE; dead = true; }
    lock_.exit();
    if (dead) { eng.onClose(id); swept_++; }
  }
  // engine が持っているのに表に無い枠（表を経由せず残った枠）も空ける
  uint32_t ids[MAX_WS_CLIENTS];
  int n = eng.clientIds(ids, MAX_WS_CLIENTS);
  for (int k = 0; k < n; k++) {
    bool known = false;
    lock_.enter();
    for (auto& s : t_) if ((s.st == OPEN_ || s.st == NEW_) && s.id == ids[k]) known = true;
    lock_.exit();
    if (!known) { eng.onClose(ids[k]); swept_++; }
  }
}

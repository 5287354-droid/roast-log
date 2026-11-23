#pragma once
// AP のままになったあと、保存済みの Wi-Fi をつなぎ直す時機を決める（SPEC 9.6 の「軽」）。Arduino に依存しない。
// 起動時に家の Wi-Fi が見つからず AP になっても、あとで Wi-Fi が戻れば自動で STA に戻れるようにする。
// STA を試すと AP のチャンネルが変わって AP の接続が切れるので、クライアントがいない・焙煎中でないときだけ試す。
#include <stdint.h>
#include "../../include/config.h"

class StaRetry {
 public:
  // AP を始めた時刻から数え始める
  void armAt(uint32_t now) { last_ = now; trying_ = false; }
  bool trying() const { return trying_; }
  bool shouldStart(uint32_t now, bool haveCreds, int clients, bool busy) const {
    return !trying_ && haveCreds && clients == 0 && !busy && (int32_t)(now - last_) >= (int32_t)STA_RETRY_PERIOD_MS;
  }
  void started(uint32_t now) { trying_ = true; startedAt_ = now; }
  bool timedOut(uint32_t now) const { return trying_ && (int32_t)(now - startedAt_) >= (int32_t)STA_CONNECT_TIMEOUT_MS; }
  void finished(uint32_t now) { trying_ = false; last_ = now; }   // 成功でも失敗でも
 private:
  uint32_t last_ = 0, startedAt_ = 0;
  bool trying_ = false;
};

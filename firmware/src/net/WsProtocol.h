#pragma once
// WebSocket プロトコル（SPEC 2章 + 9.4 / 9.5）。エンコード/デコードと接続ごとの送信順序。
// Arduino に依存しない（native テスト対象）。tools/sim/server.mjs と同じ JSON の形にする。
#include <stdint.h>
#include <string>
#include "../CfgModel.h"
#include "../Sampler.h"

struct DeviceInfo {
  const char* fw = "0.0.0";
  const char* model = "RL-HOST";
  const char* amp = "sim";
  char id[16] = "000000";
  char bootId[12] = "00000000";
  uint32_t speed = 1;  // 実機は常に 1（試験用の橋だけが変える）
};
struct StatusInfo {
  int rssi = 0;
  const char* mode = "sta";
  std::string ip;
  uint32_t heap = 0;
  uint32_t uptime = 0;
  int clients = 0;
};

namespace wsp {
std::string jsonEscape(const std::string& s);
std::string encCfgBody(const DeviceInfo& di, const DeviceConfig& c, bool withType);  // withType=true で cfg メッセージ
std::string encHello(const DeviceInfo& di, uint32_t ms, uint32_t seq, uint32_t bufFrom, const DeviceConfig& c);
std::string encS(uint32_t seq, const Sample& s);
// from..to（両端含む）。ring に無い分は null / 0 で埋める。to = from-1 なら空
std::string encBf(const Ring& ring, uint32_t from, uint32_t to, bool lost, uint32_t msFallback);
std::string encSt(const StatusInfo& st);
std::string encAck(const std::string* id, bool ok, const char* err, const uint32_t* rev = nullptr);
std::string encPong(const std::string* id, int64_t t, uint32_t ms);
}  // namespace wsp

class Sink {
 public:
  virtual ~Sink() {}
  virtual bool canSend(uint32_t clientId) = 0;
  virtual void send(uint32_t clientId, const std::string& text) = 0;
};

class ProtocolEngine {
 public:
  ProtocolEngine(const DeviceInfo& di, Ring& ring, DeviceConfig& cfg) : di_(di), ring_(ring), cfg_(cfg) {}
  bool onOpen(uint32_t id, uint32_t nowMs);  // false = 5 台目以降（呼び出し側で閉じる）
  void onClose(uint32_t id);
  void onMessage(uint32_t id, const char* data, size_t len, uint32_t nowMs, Sink& sink);
  // 新しい 1Hz サンプルが ring に入った直後に呼ぶ。bf 送信中の接続には s を送らない（9.5）
  void onSample(Sink& sink);
  // 毎ループ呼ぶ。hello のタイマーと、bf を 1 接続あたり 1 フレームずつ送る
  void pump(uint32_t nowMs, Sink& sink);
  void broadcastSt(const StatusInfo& st, Sink& sink);
  int clientCount() const;
  bool takeIdentify() { bool r = identify_; identify_ = false; return r; }
  bool takeCfgChanged() { bool r = cfgChanged_; cfgChanged_ = false; return r; }

 private:
  struct Job { bool active = false, dynamic = false; uint32_t next = 0, to = 0; bool lost = false; };
  struct Client {
    bool used = false, ready = false;
    uint32_t id = 0, openMs = 0, sentSeq = 0;
    Job autoJob;
    Job reqQ[3];
  };
  Client* find(uint32_t id);
  void sendHello(Client& c, uint32_t nowMs, Sink& sink);
  bool stepJob(Client& c, Job& j, Sink& sink);
  void broadcastCfg(Sink& sink);
  DeviceInfo di_;
  Ring& ring_;
  DeviceConfig& cfg_;
  Client cl_[MAX_WS_CLIENTS];
  bool identify_ = false, cfgChanged_ = false;
  uint32_t lastNowMs_ = 0;
};

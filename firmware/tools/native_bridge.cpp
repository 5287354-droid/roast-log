// ホスト（PC）で WsProtocol / Sampler / SimTcDriver を動かす橋。tools/fw-bridge.mjs から使う。
// 実機と同じ C++ コード（src/）をそのまま使い、WebSocket の代わりに標準入出力で行をやりとりする。
//   入力:  "open <id>" / "close <id>" / "msg <id> <json>" / "tick"（仮想時間を 250ms 進める）
//   出力:  "send <id> <json>" / "close <id>"（5 台目以降を閉じる）
// 起動引数: <bootId 8桁16進> <speed> <ms の初期値> [amp 名]
#include <iostream>
#include <string>
#include <cstring>
#include <cstdlib>
#include "Sampler.h"
#include "CfgModel.h"
#include "net/WsProtocol.h"
#include "tc/SimTcDriver.h"

static uint32_t g_now = 0;
static uint32_t nowFn() { return g_now; }

struct StdoutSink : Sink {
  bool canSend(uint32_t) override { return true; }
  void send(uint32_t id, const std::string& t) override { std::cout << "send " << id << ' ' << t << '\n'; }
};

int main(int argc, char** argv) {
  std::ios::sync_with_stdio(false);
  DeviceInfo di;
  di.fw = "0.1.0-native"; di.model = "RL-HOST"; di.amp = argc > 4 ? argv[4] : "sim";   // 試験用にアンプ名だけ変えられる（値は SimTcDriver）
  strcpy(di.id, "b0b0b0");
  strncpy(di.bootId, argc > 1 ? argv[1] : "0badc0de", 8); di.bootId[8] = 0;
  di.speed = argc > 2 ? (uint32_t)atoi(argv[2]) : 1;
  g_now = argc > 3 ? (uint32_t)strtoul(argv[3], nullptr, 10) : 5000;
  static Ring ring; DeviceConfig cfg; cfgDefaults(cfg);
  ProtocolEngine eng(di, ring, cfg);
  Sampler sampler;
  SimTcDriver d0(0, nowFn), d1(1, nowFn), d2(2, nowFn);
  TcDriver* drv[3] = {&d0, &d1, &d2};
  StdoutSink sink;
  std::string line;
  uint32_t ticks = 0;
  while (std::getline(std::cin, line)) {
    if (line.rfind("tick", 0) == 0) {
      g_now += READ_PERIOD_MS;
      TcReading r[3];
      for (int i = 0; i < 3; i++) { if (cfg.ch[i].enabled) drv[i]->read(r[i]); else r[i] = {0, 0, 0}; }
      Sample s;
      if (sampler.pushReads(r, g_now, cfg, s)) {
        ring.push(s);
        eng.onSample(sink);
        if (ring.seq() % ST_EVERY_SEQ == 0) {
          StatusInfo st; st.rssi = -50; st.mode = "sta"; st.ip = "127.0.0.1"; st.heap = 150000; st.heapMax = 110592; st.uptime = g_now / 1000;
          eng.broadcastSt(st, sink);
        }
      }
      ticks++;
    } else if (line.rfind("open ", 0) == 0) {
      uint32_t id = (uint32_t)strtoul(line.c_str() + 5, nullptr, 10);
      if (!eng.onOpen(id, g_now)) std::cout << "close " << id << '\n';
    } else if (line.rfind("close ", 0) == 0) {
      eng.onClose((uint32_t)strtoul(line.c_str() + 6, nullptr, 10));
    } else if (line.rfind("msg ", 0) == 0) {
      char* end = nullptr;
      uint32_t id = (uint32_t)strtoul(line.c_str() + 4, &end, 10);
      if (end && *end == ' ') end++;
      eng.onMessage(id, end, strlen(end), g_now, sink);
      if (eng.takeIdentify()) d2.injectFault(TC_OPEN, 3000);
      eng.takeCfgChanged();
    }
    eng.pump(g_now, sink);
    std::cout.flush();
  }
  return 0;
}

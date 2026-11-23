// 焙煎記録ノート ファームウェア本体（SPEC 6章）
// 流れ: 250ms ごとに全チャンネルを読む → 4 回で 1 秒に集約 → ring に入れ、WS で配る。
// SPI を触るのは loop() だけ。WS は WsHub がキューを通して loop() に渡す。
#include <Arduino.h>
#include <SPI.h>
#include <esp_random.h>
#include <esp_system.h>
#include <esp_mac.h>
#include "../include/config.h"
#include "../include/pins.h"
#include "Settings.h"
#include "Sampler.h"
#include "tc/TcDriver.h"
#include "net/WsProtocol.h"
#include "net/WifiManager.h"
#include "net/WebServer.h"
#include "net/WsHub.h"
#include "net/Improv.h"
#include <driver/gpio.h>

static Settings settings;
static DeviceConfig cfg;
static Ring ring;
static Sampler sampler;
static TcDriver* drv[3];
static DeviceInfo info;
static ProtocolEngine* engine;
static WifiManager wifi;
static WebServer web(80);
static WsHub hub;

static uint32_t nextRead = 0, identifyUntil = 0, btnDownAt = 0, lastApPrint = 0;
static bool identifyActive = false;   // identifyUntil=0 の初期値と比べると 24.8 日後に誤って点滅するので、フラグで持つ
static TcReading lastRead[3];
static bool anyFault = false;

static uint8_t appliedMains = 0, appliedAvg = 0;
static void applyDriverConfig() {
  appliedMains = cfg.mains; appliedAvg = cfg.avg;
  TcConfig tc{cfg.mains, cfg.avg};
  for (int i = 0; i < 3; i++) drv[i]->configure(tc);
}

static void startIdentify(uint32_t now) { identifyUntil = now + IDENTIFY_MS; identifyActive = true; }

// 保存先（NVS）。setcfg は「保存してから ack」する（SPEC 9.6）
class NvsStore : public CfgStore { public: bool save(const DeviceConfig& c) override { return settings.saveConfig(c); } };
static NvsStore nvsStore;

static void ledUpdate(uint32_t now) {
  bool on;
  if (identifyActive && (int32_t)(now - identifyUntil) >= 0) identifyActive = false;
  if (identifyActive) on = (now / 100) % 2;                                            // identify: 3 秒高速点滅
  else if (web.wifiWindowOpen(now)) on = (now / 250) % 2;                              // Wi-Fi 設定を受け付け中（STA でボタンを押した後 60 秒）
  else if (wifi.ledFastBlink()) on = (now / 150) % 2;                                  // STA 接続中
  else if (wifi.ledSlowBlink()) on = (now / 800) % 2;                                  // AP
  else if (anyFault) { uint32_t p = now % 1600; on = (p < 150) || (p >= 300 && p < 450); }  // 2 回点滅の繰り返し
  else on = wifi.ledSolid();                                                           // 接続済みは点灯
  digitalWrite(PIN_LED, on ? HIGH : LOW);
}

static void buttonUpdate(uint32_t now) {
  if (digitalRead(PIN_BTN) == LOW) {
    if (!btnDownAt) btnDownAt = now ? now : 1;
    else if (now - btnDownAt > BUTTON_LONG_PRESS_MS) { settings.clearWifi(); delay(100); ESP.restart(); }   // 5 秒長押しで STA 情報を消して AP で再起動
  } else {
    // 短く押して離したら、60 秒だけ POST /api/wifi を受け付ける（STA のとき。AP のときは常に受け付ける）
    if (btnDownAt && now - btnDownAt >= BUTTON_SHORT_MIN_MS && now - btnDownAt <= BUTTON_LONG_PRESS_MS) {
      web.openWifiWindow(now);
      Serial.printf("{\"type\":\"wifiwindow\",\"sec\":%u}\n", (unsigned)(WIFI_WINDOW_MS / 1000));
    }
    btnDownAt = 0;
  }
}

static void printWifiLine() {
  // ラベルが無いときのために、AP の名前とパスワードを出す（USB をつないだ本人にしか見えない）
  Serial.printf("{\"type\":\"wifi\",\"apSsid\":\"%s\",\"apPass\":\"%s\",\"host\":\"%s.local\",\"mode\":\"%s\"}\n",
                wifi.apSsid().c_str(), wifi.apPass().c_str(), wifi.host().c_str(), wifi.mode());
}

// ---------------------------------------------------------------- Improv Serial（SPEC 9.6）
static ImprovSerial improv;
static bool provPending = false, scanPending = false;
static String provSsid, provPass;

static void improvSend(const std::string& p) { Serial.write((const uint8_t*)p.data(), p.size()); }
static String deviceUrl() { return String("http://") + wifi.ip(); }
static void improvSendProvisioned() {
  improvSend(ImprovSerial::state(ImprovSerial::ST_PROVISIONED));
  improvSend(ImprovSerial::result(ImprovSerial::CMD_WIFI, {std::string(deviceUrl().c_str())}));
}

static void improvHandle(const ImprovSerial::Rpc& r, uint32_t now) {
  switch (r.cmd) {
    case ImprovSerial::CMD_GET_STATE:
      if (provPending) improvSend(ImprovSerial::state(ImprovSerial::ST_PROVISIONING));
      else if (wifi.staConnected()) improvSendProvisioned();
      else improvSend(ImprovSerial::state(ImprovSerial::ST_READY));
      break;
    case ImprovSerial::CMD_GET_INFO:
      improvSend(ImprovSerial::result(ImprovSerial::CMD_GET_INFO, {"RoastLog", FW_VERSION, ESP.getChipModel(), "焙煎記録ノート " MODEL_NAME}));
      break;
    case ImprovSerial::CMD_IDENTIFY: startIdentify(now); break;
    case ImprovSerial::CMD_SCAN:
      if (!scanPending) { WiFi.scanNetworks(true); scanPending = true; }
      break;
    case ImprovSerial::CMD_WIFI: {
      bool bad = provPending || r.ssid.empty() || r.ssid.size() > 32 || (!r.pass.empty() && (r.pass.size() < 8 || r.pass.size() > 63));
      if (bad) { improvSend(ImprovSerial::error(ImprovSerial::ERR_INVALID_RPC)); break; }
      provSsid = r.ssid.c_str(); provPass = r.pass.c_str();
      improvSend(ImprovSerial::state(ImprovSerial::ST_PROVISIONING));
      wifi.beginProvision(provSsid, provPass, now);
      provPending = true;
      break;
    }
    default: break;
  }
}

static void improvLoop(uint32_t now) {
  for (int n = 0; n < 256 && Serial.available(); n++) {
    ImprovSerial::Rpc rpc;
    if (improv.feed((uint8_t)Serial.read(), rpc)) improvHandle(rpc, now);
    ImprovSerial::Err e = improv.takeError();
    if (e != ImprovSerial::ERR_NONE) improvSend(ImprovSerial::error(e));
  }
  if (provPending) {
    int r = wifi.pollProvision(now);
    if (r == 1) {
      provPending = false;
      settings.setWifi(provSsid, provPass);   // つながったときだけ保存する（間違えたパスワードで今の設定を壊さない）
      improvSendProvisioned();
      Serial.printf("{\"type\":\"improv\",\"ok\":true,\"ip\":\"%s\"}\n", wifi.ip().c_str());
    } else if (r < 0) {
      provPending = false;
      improvSend(ImprovSerial::error(ImprovSerial::ERR_UNABLE_CONNECT));
      improvSend(ImprovSerial::state(ImprovSerial::ST_READY));
    }
  }
  if (scanPending) {
    int n = WiFi.scanComplete();
    if (n >= 0) {
      scanPending = false;
      for (int i = 0; i < n && i < 20; i++) {
        String ssid = WiFi.SSID(i);
        if (ssid.length() == 0) continue;
        improvSend(ImprovSerial::result(ImprovSerial::CMD_SCAN, {std::string(ssid.c_str()), std::to_string(WiFi.RSSI(i)), WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "NO" : "YES"}));
      }
      improvSend(ImprovSerial::resultEmpty(ImprovSerial::CMD_SCAN));   // 終わり
      WiFi.scanDelete();
    } else if (n == WIFI_SCAN_FAILED) { scanPending = false; improvSend(ImprovSerial::resultEmpty(ImprovSerial::CMD_SCAN)); }
  }
}

void setup() {
  // 全 CS を先に HIGH にしてから SPI.begin（起動時のバス衝突を防ぐ）
  const uint8_t cs[3] = {PIN_CS1, PIN_CS2, PIN_CS3};
  for (int i = 0; i < 3; i++) { pinMode(cs[i], OUTPUT); digitalWrite(cs[i], HIGH); }
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BTN, INPUT_PULLUP);
  Serial.begin(115200);
  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, -1);
  gpio_pullup_en((gpio_num_t)PIN_MISO);   // アンプが無い（CS を引いても DO が応答しない）ときに「全部 1」と読めるように。pinMode は SPI の割り当てを壊すので使わない

  settings.begin();
  bool firstBoot = !settings.hasConfig();   // 一度も設定を保存していない = 初回起動
  settings.loadConfig(cfg);

  bool present[3];
  for (int i = 0; i < 3; i++) { drv[i] = makeDriver(i); present[i] = drv[i]->begin(); }
#if !defined(TC_DRIVER_SIM)
  // 初回起動だけ、アンプが見つからない 2・3 本目は「使わない」にする（1 枚構成で故障表示が出ないように）。
  // 1 本目は常に有効（アンプが外れていれば故障として見える）。見つかった 3 本目は有効にして役割を「外気」にする
  if (firstBoot) {
    cfg.ch[1].enabled = present[1];
    if (present[2]) { cfg.ch[2].enabled = true; cfg.ch[2].role = (uint8_t)roleIndex("amb"); strcpy(cfg.ch[2].name, "外気"); }
    else cfg.ch[2].enabled = false;
    settings.saveConfig(cfg);
  }
#else
  (void)firstBoot;
#endif
  Serial.printf("{\"type\":\"detect\",\"present\":[%s,%s,%s],\"firstBoot\":%s}\n", present[0] ? "true" : "false", present[1] ? "true" : "false", present[2] ? "true" : "false", firstBoot ? "true" : "false");
  applyDriverConfig();

  uint8_t mac[6]; esp_read_mac(mac, ESP_MAC_WIFI_STA);
  info.fw = FW_VERSION; info.model = MODEL_NAME; info.amp = drv[0]->name(); info.speed = 1;
  snprintf(info.id, sizeof info.id, "%02x%02x%02x", mac[3], mac[4], mac[5]);
  snprintf(info.bootId, sizeof info.bootId, "%08x", (unsigned)esp_random());   // 起動ごとに乱数 8 桁 16 進
  engine = new ProtocolEngine(info, ring, cfg);
  engine->setStore(&nvsStore);

  wifi.begin(settings, mac);
  hub.begin(web.raw(), *engine);
  web.begin(info, wifi, settings);

  nextRead = millis() + READ_PERIOD_MS;
  Serial.printf("{\"type\":\"boot\",\"fw\":\"%s\",\"model\":\"%s\",\"amp\":\"%s\",\"id\":\"%s\",\"bootId\":\"%s\",\"rev\":%u}\n",
                info.fw, info.model, info.amp, info.id, info.bootId, (unsigned)cfg.rev);
  printWifiLine();   // 起動時に 1 回。AP の間は 10 秒ごとにも出す（loop）
  lastApPrint = millis();
}

static void printDiag() {
  for (int i = 0; i < 3; i++) {
    uint8_t c0, c1; bool ok;
    if (drv[i]->diag(c0, c1, ok))
      Serial.printf("{\"type\":\"diag\",\"ch\":%d,\"cr0\":\"0x%02X\",\"cr1\":\"0x%02X\",\"verified\":%s,\"mains\":%u,\"avg\":%u}\n", i, c0, c1, ok ? "true" : "false", cfg.mains, cfg.avg);
  }
}

class NullSink : public Sink { public: bool canSend(uint32_t) override { return false; } void send(uint32_t, const std::string&) override {} };

void loop() {
  uint32_t now = millis();

  // ---- 250ms ごとの読取（SPI はここだけ）
  if ((int32_t)(now - nextRead) >= 0) {
    nextRead += READ_PERIOD_MS;
    if ((int32_t)(now - nextRead) > 0) nextRead = now + READ_PERIOD_MS;   // 大きく遅れたら取り戻さない
    for (int i = 0; i < 3; i++) {
      if (!cfg.ch[i].enabled) { lastRead[i] = {NAN, NAN, TC_OK}; continue; }
      if (!drv[i]->read(lastRead[i])) lastRead[i].fault = TC_STALE;
    }
    Sample s;
    if (sampler.pushReads(lastRead, now, cfg, s)) {
      ring.push(s);
      anyFault = false;
      for (int i = 0; i < 3; i++) if (cfg.ch[i].enabled && s.f[i]) anyFault = true;
      std::string line = wsp::encS(ring.seq(), s);
      Serial.println(line.c_str());                         // 1Hz の JSON（F1）
      engine->onSample(hub);
      if (ring.seq() % ST_EVERY_SEQ == 0) {
        StatusInfo st; st.rssi = wifi.rssi(); st.mode = wifi.mode(); st.ip = wifi.ip().c_str();
        st.heap = ESP.getFreeHeap(); st.heapMax = ESP.getMaxAllocHeap(); st.uptime = now / 1000; st.clients = engine->clientCount();
        engine->broadcastSt(st, hub);
        { st.clients = engine->clientCount(); Serial.println(wsp::encSt(st).c_str()); }   // 10 秒ごとの状態（電波の強さ・空きメモリ）もシリアルに出す
      }
      if (ring.seq() % 5 == 1) printDiag();
    }
  }

  // ---- WS（キューの処理と bf の送信）
  hub.loop(now);
  if (engine->takeIdentify()) {
    startIdentify(now);
    drv[2]->injectFault(TC_OPEN, 3000);   // SimTcDriver だけが反応する（3ch 目に疑似断線）
  }
  if (engine->takeCfgChanged()) {   // NVS への保存は engine が ack の前に済ませている
    if (cfg.mains != appliedMains || cfg.avg != appliedAvg) applyDriverConfig();   // MAX31856 に書いて読み戻す
  }

  improvLoop(now);
  wifi.loop(now, engine->clientCount());
  // AP の間は、AP 名とパスワードを 10 秒ごとにシリアルに出す（書き込みページの「ログとコンソール」で読める）
  if (wifi.apActive() && (int32_t)(now - lastApPrint) >= (int32_t)AP_SERIAL_PERIOD_MS) { lastApPrint = now; printWifiLine(); }
  ledUpdate(now);
  buttonUpdate(now);
  if (web.restartRequested(now)) { delay(100); ESP.restart(); }
}

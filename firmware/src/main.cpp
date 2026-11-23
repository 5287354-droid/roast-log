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

static uint32_t nextRead = 0, identifyUntil = 0, btnDownAt = 0;
static TcReading lastRead[3];
static bool anyFault = false;

static uint8_t appliedMains = 0, appliedAvg = 0;
static void applyDriverConfig() {
  appliedMains = cfg.mains; appliedAvg = cfg.avg;
  TcConfig tc{cfg.mains, cfg.avg};
  for (int i = 0; i < 3; i++) drv[i]->configure(tc);
}

static void ledUpdate(uint32_t now) {
  bool on;
  if ((int32_t)(now - identifyUntil) < 0) on = (now / 100) % 2;                       // identify: 3 秒高速点滅
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
  } else btnDownAt = 0;
}

void setup() {
  // 全 CS を先に HIGH にしてから SPI.begin（起動時のバス衝突を防ぐ）
  const uint8_t cs[3] = {PIN_CS1, PIN_CS2, PIN_CS3};
  for (int i = 0; i < 3; i++) { pinMode(cs[i], OUTPUT); digitalWrite(cs[i], HIGH); }
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BTN, INPUT_PULLUP);
  Serial.begin(115200);
  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, -1);

  settings.begin();
  settings.loadConfig(cfg);

  for (int i = 0; i < 3; i++) { drv[i] = makeDriver(i); drv[i]->begin(); }
  applyDriverConfig();

  uint8_t mac[6]; esp_read_mac(mac, ESP_MAC_WIFI_STA);
  info.fw = FW_VERSION; info.model = MODEL_NAME; info.amp = drv[0]->name(); info.speed = 1;
  snprintf(info.id, sizeof info.id, "%02x%02x%02x", mac[3], mac[4], mac[5]);
  snprintf(info.bootId, sizeof info.bootId, "%08x", (unsigned)esp_random());   // 起動ごとに乱数 8 桁 16 進
  engine = new ProtocolEngine(info, ring, cfg);

  wifi.begin(settings, mac);
  hub.begin(web.raw(), *engine);
  web.begin(info, wifi, settings);

  nextRead = millis() + READ_PERIOD_MS;
  Serial.printf("{\"type\":\"boot\",\"fw\":\"%s\",\"model\":\"%s\",\"amp\":\"%s\",\"id\":\"%s\",\"bootId\":\"%s\",\"rev\":%u}\n",
                info.fw, info.model, info.amp, info.id, info.bootId, (unsigned)cfg.rev);
  // ラベルが無いときのために、AP の名前とパスワードを起動時に出す（USB をつないだ本人にしか見えない）
  Serial.printf("{\"type\":\"wifi\",\"apSsid\":\"%s\",\"apPass\":\"%s\",\"host\":\"%s.local\",\"mode\":\"%s\"}\n",
                wifi.apSsid().c_str(), wifi.apPass().c_str(), wifi.host().c_str(), wifi.mode());
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
        st.heap = ESP.getFreeHeap(); st.uptime = now / 1000; st.clients = engine->clientCount();
        engine->broadcastSt(st, hub);
      }
      if (ring.seq() % 5 == 1) printDiag();
    }
  }

  // ---- WS（キューの処理と bf の送信）
  hub.loop(now);
  if (engine->takeIdentify()) {
    identifyUntil = now + 3000;
    drv[2]->injectFault(TC_OPEN, 3000);   // SimTcDriver だけが反応する（3ch 目に疑似断線）
  }
  if (engine->takeCfgChanged()) {
    settings.saveConfig(cfg);       // NVS に保存（rev 込み）
    if (cfg.mains != appliedMains || cfg.avg != appliedAvg) applyDriverConfig();   // MAX31856 に書いて読み戻す
  }

  wifi.loop(now, engine->clientCount());
  ledUpdate(now);
  buttonUpdate(now);
  if (web.restartRequested(now)) { delay(100); ESP.restart(); }
}

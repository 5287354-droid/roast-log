#pragma once
// HTTP: / (LittleFS の index.html.gz)、/api/info、/wifi、/api/scan、POST /api/wifi（SPEC 6.5）
#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include "WsProtocol.h"
#include "WifiManager.h"
#include "../Settings.h"
#include "../../include/config.h"

class WebServer {
 public:
  explicit WebServer(uint16_t port = 80) : server_(port) {}
  void begin(const DeviceInfo& di, WifiManager& wifi, Settings& settings);
  AsyncWebServer& raw() { return server_; }
  bool restartRequested(uint32_t now) { return restartAt_ && (int32_t)(now - restartAt_) >= 0; }
  // STA のとき、機器のボタンを短く押してから WIFI_WINDOW_MS のあいだだけ POST /api/wifi を受け付ける（SPEC 9.6）
  void openWifiWindow(uint32_t now) { wifiUntil_ = now + WIFI_WINDOW_MS; if (!wifiUntil_) wifiUntil_ = 1; }
  bool wifiWindowOpen(uint32_t now) const { return wifiUntil_ && (int32_t)(now - wifiUntil_) < 0; }
  bool wifiAccepting(uint32_t now) const;     // AP が出ている、または窓が開いている
 private:
  String etag();
  bool wifiGate(AsyncWebServerRequest* req);
  AsyncWebServer server_;
  DeviceInfo di_;
  WifiManager* wifi_ = nullptr;
  Settings* settings_ = nullptr;
  String etag_;
  uint32_t restartAt_ = 0;
  uint32_t wifiUntil_ = 0;
};

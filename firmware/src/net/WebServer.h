#pragma once
// HTTP: / (LittleFS の index.html.gz)、/api/info、/wifi、/api/scan、POST /api/wifi（SPEC 6.5）
#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include "WsProtocol.h"
#include "WifiManager.h"
#include "../Settings.h"

class WebServer {
 public:
  explicit WebServer(uint16_t port = 80) : server_(port) {}
  void begin(const DeviceInfo& di, WifiManager& wifi, Settings& settings);
  AsyncWebServer& raw() { return server_; }
  bool restartRequested(uint32_t now) { return restartAt_ && (int32_t)(now - restartAt_) >= 0; }
 private:
  String etag();
  AsyncWebServer server_;
  DeviceInfo di_;
  WifiManager* wifi_ = nullptr;
  Settings* settings_ = nullptr;
  String etag_;
  uint32_t restartAt_ = 0;
  String body_;
};

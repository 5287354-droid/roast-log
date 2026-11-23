#include "WebServer.h"
#include <LittleFS.h>
#include <ArduinoJson.h>
#include "wifi_page.h"
#include "../../include/config.h"

static String jsonStr(const String& s) {
  String o = "\"";
  for (size_t i = 0; i < s.length(); i++) {
    unsigned char c = (unsigned char)s[i];
    if (c == '"' || c == '\\') { o += '\\'; o += (char)c; }
    else if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
    else o += (char)c;
  }
  return o + "\"";
}

// gz ファイルの内容から ETag を作る（FW_BUILD + FNV-1a）
String WebServer::etag() {
  File f = LittleFS.open("/index.html.gz", "r");
  if (!f) return "";
  uint32_t h = 2166136261u; uint8_t buf[256]; size_t n;
  while ((n = f.read(buf, sizeof buf)) > 0) for (size_t i = 0; i < n; i++) { h ^= buf[i]; h *= 16777619u; }
  char b[48]; snprintf(b, sizeof b, "\"%s-%08x\"", FW_BUILD, (unsigned)h);
  return b;
}

void WebServer::begin(const DeviceInfo& di, WifiManager& wifi, Settings& settings) {
  di_ = di; wifi_ = &wifi; settings_ = &settings;
  LittleFS.begin(true);
  etag_ = etag();

  server_.on("/", HTTP_GET, [this](AsyncWebServerRequest* req) {
    if (etag_.length() == 0) { req->redirect("/wifi"); return; }   // アプリ（LittleFS）が無ければ /wifi へ
    if (req->hasHeader("If-None-Match") && req->header("If-None-Match") == etag_) { req->send(304); return; }
    // "/index.html" は無く "/index.html.gz" だけがあるので、ライブラリが gzip ヘッダを付けて返す
    AsyncWebServerResponse* r = req->beginResponse(LittleFS, "/index.html", "text/html; charset=utf-8");
    r->addHeader("Cache-Control", "no-cache");
    r->addHeader("ETag", etag_);
    req->send(r);
  });

  server_.on("/api/info", HTTP_GET, [this](AsyncWebServerRequest* req) {
    String host = req->hasHeader("Host") ? req->header("Host") : String("");
    String j = String("{\"proto\":1,\"fw\":") + jsonStr(di_.fw) + ",\"model\":" + jsonStr(di_.model) + ",\"amp\":" + jsonStr(di_.amp) +
               ",\"id\":" + jsonStr(di_.id) + ",\"bootId\":" + jsonStr(di_.bootId) + ",\"mode\":" + jsonStr(wifi_->mode()) +
               ",\"ip\":" + jsonStr(wifi_->ip()) + ",\"host\":" + jsonStr(host) + "}";
    AsyncWebServerResponse* r = req->beginResponse(200, "application/json; charset=utf-8", j);
    r->addHeader("Cache-Control", "no-store");
    r->addHeader("Access-Control-Allow-Origin", "*");
    req->send(r);
  });

  server_.on("/wifi", HTTP_GET, [](AsyncWebServerRequest* req) { req->send(200, "text/html; charset=utf-8", WIFI_PAGE); });

  server_.on("/api/scan", HTTP_GET, [](AsyncWebServerRequest* req) {
    int n = WiFi.scanComplete();
    String j;
    if (n == WIFI_SCAN_FAILED) { WiFi.scanNetworks(true); j = "{\"scanning\":true,\"networks\":[]}"; }
    else if (n == WIFI_SCAN_RUNNING) j = "{\"scanning\":true,\"networks\":[]}";
    else {
      j = "{\"scanning\":false,\"networks\":[";
      bool first = true;
      for (int i = 0; i < n; i++) {
        String s = WiFi.SSID(i); if (s.length() == 0) continue;
        if (!first) j += ',';
        first = false;
        j += "{\"ssid\":" + jsonStr(s) + ",\"rssi\":" + String(WiFi.RSSI(i)) + ",\"open\":" + (WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "true" : "false") + "}";
      }
      j += "]}";
      WiFi.scanDelete();
    }
    req->send(200, "application/json; charset=utf-8", j);
  });

  server_.on("/api/wifi", HTTP_POST,
    [](AsyncWebServerRequest*) {},
    nullptr,
    [this](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (index == 0) body_ = "";
      if (body_.length() + len > 1024) { req->send(413, "application/json", "{\"ok\":false,\"err\":\"too_large\"}"); return; }
      body_.concat((const char*)data, len);
      if (index + len < total) return;
      JsonDocument d;
      if (deserializeJson(d, body_) || !d["ssid"].is<const char*>()) { req->send(400, "application/json", "{\"ok\":false,\"err\":\"bad_request\"}"); return; }
      String ssid = d["ssid"].as<const char*>(), pass = d["pass"].is<const char*>() ? d["pass"].as<const char*>() : "";
      if (ssid.length() == 0 || ssid.length() > 32 || pass.length() > 63) { req->send(400, "application/json", "{\"ok\":false,\"err\":\"bad_value\"}"); return; }
      settings_->setWifi(ssid, pass);
      if (d["apPass"].is<const char*>()) { String a = d["apPass"].as<const char*>(); if (a.length() >= 8 && a.length() <= 63) settings_->setApPass(a); }
      if (d["host"].is<const char*>()) {
        String h = d["host"].as<const char*>(); h.toLowerCase();
        bool okh = h.length() > 0 && h.length() <= 32;
        for (size_t i = 0; i < h.length() && okh; i++) { char c = h[i]; okh = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-'; }
        if (okh) settings_->setHost(h);
      }
      req->send(200, "application/json", "{\"ok\":true}");
      restartAt_ = millis() + 1500;   // 応答を返してから再起動
      if (restartAt_ == 0) restartAt_ = 1;
    });

  server_.onNotFound([](AsyncWebServerRequest* req) { req->send(404, "text/plain", "not found"); });
  server_.begin();
}

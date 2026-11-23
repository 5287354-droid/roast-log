#include "WebServer.h"
#include <LittleFS.h>
#include <ArduinoJson.h>
#include "wifi_page.h"
#include "../../include/config.h"

static const size_t WIFI_BODY_MAX = 1024;
struct WifiBody { bool sent; uint16_t len; char buf[WIFI_BODY_MAX + 1]; };

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

bool WebServer::wifiAccepting(uint32_t now) const { return wifi_->apActive() || wifiWindowOpen(now); }

static void sendErr(AsyncWebServerRequest* req, int code, const char* err) {
  req->send(code, "application/json", String("{\"ok\":false,\"err\":\"") + err + "\"}");
}

// /api/wifi の門前払い。応答を返したら true
bool WebServer::wifiGate(AsyncWebServerRequest* req) {
  if (!wifiAccepting(millis())) { sendErr(req, 403, "closed"); return true; }   // STA のときは機器のボタンを押してから 60 秒だけ
  String ct = req->contentType(); ct.toLowerCase();
  if (ct != "application/json") { sendErr(req, 415, "need_json"); return true; }
  if (req->hasHeader("Origin")) {
    String o = req->header("Origin"), h = req->hasHeader("Host") ? req->header("Host") : String("");
    o.toLowerCase(); h.toLowerCase();
    if (h.length() == 0 || o != String("http://") + h) { sendErr(req, 403, "bad_origin"); return true; }   // 他のサイトのページからの送信を断る
  }
  return false;
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
               ",\"ip\":" + jsonStr(wifi_->ip()) + ",\"host\":" + jsonStr(host) + ",\"ota\":false}";   // /update は無い（SPEC 9.6）
    AsyncWebServerResponse* r = req->beginResponse(200, "application/json; charset=utf-8", j);
    r->addHeader("Cache-Control", "no-store");
    // CORS ヘッダは付けない（アプリは同じ機器から配られるので同一オリジンで足りる）
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

  // POST /api/wifi（SPEC 9.6）: AP のとき（STA ではボタンを押してから 60 秒だけ）、JSON のみ、同じ Origin のみ。
  // 応答はここで 1 回だけ返す。本文は 1KB まで。長さ（total）は最初のチャンクで見て、大きければ 413 を 1 回だけ返す
  server_.on("/api/wifi", HTTP_POST,
    [this](AsyncWebServerRequest* req) {
      WifiBody* wb = (WifiBody*)req->_tempObject;
      if (wb && wb->sent) return;                       // 本文のところで返事を済ませてある
      if (wifiGate(req)) return;                        // 本文が空のときもここで門前払いにする
      if (!wb || wb->len == 0) { sendErr(req, 400, "empty_body"); return; }
      JsonDocument d;
      if (deserializeJson(d, wb->buf, wb->len) || !d.is<JsonObject>() || !d["ssid"].is<const char*>()) { sendErr(req, 400, "bad_request"); return; }
      String ssid = d["ssid"].as<const char*>(), pass = d["pass"].is<const char*>() ? d["pass"].as<const char*>() : "";
      if (ssid.length() == 0 || ssid.length() > 32) { sendErr(req, 400, "bad_ssid"); return; }
      if (pass.length() != 0 && (pass.length() < 8 || pass.length() > 63)) { sendErr(req, 400, "bad_pass"); return; }   // WPA2 は 8〜63 文字（鍵なしの Wi-Fi は空）
      String apPass; bool hasAp = false;
      if (!d["apPass"].isNull()) {
        if (!d["apPass"].is<const char*>()) { sendErr(req, 400, "bad_ap_pass"); return; }
        apPass = d["apPass"].as<const char*>();
        if (apPass.length() < 8 || apPass.length() > 63) { sendErr(req, 400, "bad_ap_pass"); return; }
        hasAp = true;
      }
      String host; bool hasHost = false;
      if (!d["host"].isNull()) {
        if (!d["host"].is<const char*>()) { sendErr(req, 400, "bad_host"); return; }
        host = d["host"].as<const char*>(); host.toLowerCase();
        bool okh = host.length() > 0 && host.length() <= 32;
        for (size_t i = 0; i < host.length() && okh; i++) { char c = host[i]; okh = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-'; }
        if (!okh) { sendErr(req, 400, "bad_host"); return; }
        hasHost = true;
      }
      settings_->setWifi(ssid, pass);
      if (hasAp) settings_->setApPass(apPass);
      if (hasHost) settings_->setHost(host);
      wifiUntil_ = 0;
      req->send(200, "application/json", "{\"ok\":true}");
      restartAt_ = millis() + 1500;   // 応答を返してから再起動
      if (restartAt_ == 0) restartAt_ = 1;
    },
    nullptr,
    [this](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      WifiBody* wb = (WifiBody*)req->_tempObject;
      if (index == 0 && !wb) {
        wb = (WifiBody*)calloc(1, sizeof(WifiBody));   // リクエストが終わるとライブラリが free する
        if (!wb) { req->send(500, "application/json", "{\"ok\":false,\"err\":\"no_memory\"}"); return; }
        req->_tempObject = wb;
        if (wifiGate(req)) { wb->sent = true; return; }                                  // 閉じている・JSON でない・Origin が違う
        if (total > WIFI_BODY_MAX) { sendErr(req, 413, "too_large"); wb->sent = true; return; }   // 413 は先頭で 1 回だけ
      }
      if (!wb || wb->sent) return;
      if (wb->len + len > WIFI_BODY_MAX) { sendErr(req, 413, "too_large"); wb->sent = true; return; }
      memcpy(wb->buf + wb->len, data, len);
      wb->len += (uint16_t)len;
    });

  server_.onNotFound([](AsyncWebServerRequest* req) { req->send(404, "text/plain", "not found"); });
  server_.begin();
}

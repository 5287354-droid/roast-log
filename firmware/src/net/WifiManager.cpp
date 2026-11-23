#include "WifiManager.h"
#include <ESPmDNS.h>
#include "DnsReply.h"
#include "../../include/config.h"

void WifiManager::begin(Settings& s, const uint8_t mac[6]) {
  s_ = &s;
  host_ = s.host();
  char b[24]; snprintf(b, sizeof b, "RoastLog-%02X%02X", mac[4], mac[5]);
  apSsid_ = b; apPass_ = s.apPass();
  WiFi.persistent(false);
  WiFi.setHostname(host_.c_str());
  String ssid = s.wifiSsid();
  if (ssid.length() == 0) { startAp(false); return; }
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid.c_str(), s.wifiPass().c_str());
  state_ = CONNECTING; t0_ = millis();
}

void WifiManager::startAp(bool alsoSta) {
  // /api/scan のため STA も有効にしておく（AP だけだとスキャンできない）
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(apSsid_.c_str(), apPass_.c_str());   // 192.168.4.1（WPA2）
  apAlso_ = true;
  if (!alsoSta) { WiFi.disconnect(false); state_ = AP; }
  if (!dnsOn_) { dns_.begin(53); dnsOn_ = true; }
  startMdns();
}

void WifiManager::startMdns() {
  if (mdns_) return;
  if (MDNS.begin(host_.c_str())) { MDNS.addService("http", "tcp", 80); mdns_ = true; }
}

void WifiManager::pollDns() {
  if (!dnsOn_) return;
  int n = dns_.parsePacket();
  if (n <= 0) return;
  uint8_t q[256], out[300];
  if (n > (int)sizeof q) { dns_.flush(); return; }
  int r = dns_.read(q, sizeof q);
  const uint8_t ip[4] = {192, 168, 4, 1};
  size_t m = dnsBuildReply(q, (size_t)r, host_.c_str(), ip, out, sizeof out);
  if (m) { dns_.beginPacket(dns_.remoteIP(), dns_.remotePort()); dns_.write(out, m); dns_.endPacket(); }
}

void WifiManager::loop(uint32_t now, int wsClients) {
  pollDns();
  if (state_ == CONNECTING) {
    if (WiFi.status() == WL_CONNECTED) { state_ = STA; lostSince_ = 0; startMdns(); }
    else if (now - t0_ > STA_CONNECT_TIMEOUT_MS) startAp(false);   // 20 秒で AP へ
  } else if (state_ == STA) {
    if (WiFi.status() != WL_CONNECTED) {
      if (!lostSince_) lostSince_ = now ? now : 1;
      // 30 秒切れたままでクライアント 0 なら AP を併用（焙煎中でも STA は再試行し続ける）
      if (!apAlso_ && now - lostSince_ > AP_FALLBACK_NO_CLIENT_MS && wsClients == 0) startAp(true);
    } else lostSince_ = 0;
  }
}

const char* WifiManager::mode() const {
  if (state_ == AP) return "ap";
  return apAlso_ ? "ap_sta" : "sta";
}
String WifiManager::ip() const {
  if (state_ == STA && staConnected()) return WiFi.localIP().toString();
  return WiFi.softAPIP().toString();
}
int WifiManager::rssi() const { return (state_ == STA && staConnected()) ? WiFi.RSSI() : 0; }

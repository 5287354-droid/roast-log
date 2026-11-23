#pragma once
// STA → 失敗したら AP（SPEC 6.5）。mDNS は roast.local、AP 時は roast.local / roast だけに答える DNS。
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include "../Settings.h"

class WifiManager {
 public:
  void begin(Settings& s, const uint8_t mac6[6]);
  void loop(uint32_t nowMs, int wsClients);          // 毎ループ
  const char* mode() const;                           // "sta" | "ap" | "ap_sta"
  String ip() const;
  int rssi() const;
  bool staConnected() const { return WiFi.status() == WL_CONNECTED; }
  String apSsid() const { return apSsid_; }
  String apPass() const { return apPass_; }
  String host() const { return host_; }
  bool ledSlowBlink() const { return state_ == AP; }
  bool ledFastBlink() const { return state_ == CONNECTING; }
  bool ledSolid() const { return state_ == STA && staConnected(); }
  void setBusyRoasting(bool b) { busy_ = b; }         // 焙煎中は AP に切り替えない（F3 で app から通知）
 private:
  enum State { CONNECTING, STA, AP } state_ = CONNECTING;
  void startAp(bool alsoSta);
  void startMdns();
  void pollDns();
  Settings* s_ = nullptr;
  String apSsid_, apPass_, host_;
  uint32_t t0_ = 0, lostSince_ = 0;
  bool apAlso_ = false, busy_ = false, mdns_ = false;
  WiFiUDP dns_;
  bool dnsOn_ = false;
};

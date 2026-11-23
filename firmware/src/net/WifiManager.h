#pragma once
// STA → 失敗したら AP（SPEC 6.5）。mDNS は roast.local、AP 時は roast.local / roast だけに答える DNS。
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include "../Settings.h"
#include "StaRetry.h"

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
  bool apActive() const { return apAlso_; }          // 機器自身の Wi-Fi（AP）が出ているか（"ap" と "ap_sta"）
  // Improv などで受け取った Wi-Fi に、ノンブロッキングでつなぐ。pollProvision: 0=待ち 1=成功 -1=失敗
  void beginProvision(const String& ssid, const String& pass, uint32_t now);
  int pollProvision(uint32_t now);
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
  StaRetry retry_;
  bool prov_ = false; uint32_t provAt_ = 0;
  WiFiUDP dns_;
  bool dnsOn_ = false;
};

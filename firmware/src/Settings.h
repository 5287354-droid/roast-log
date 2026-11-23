#pragma once
// NVS（Preferences）への保存（SPEC 6.7）。キー: wifi.ssid wifi.pass ap.pass host mains avg rev ch{0..2}.en/role/name/color/off
#include <Arduino.h>
#include <Preferences.h>
#include "CfgModel.h"

class Settings {
 public:
  void begin();
  void loadConfig(DeviceConfig& c);
  void saveConfig(const DeviceConfig& c);
  String wifiSsid() { return p_.getString("wifi.ssid", ""); }
  String wifiPass() { return p_.getString("wifi.pass", ""); }
  void setWifi(const String& ssid, const String& pass) { p_.putString("wifi.ssid", ssid); p_.putString("wifi.pass", pass); }
  void clearWifi() { p_.remove("wifi.ssid"); p_.remove("wifi.pass"); }
  String apPass();                 // 無ければ 8 桁を作って保存
  void setApPass(const String& s) { p_.putString("ap.pass", s); }
  String host() { return p_.getString("host", DEFAULT_HOSTNAME_STR); }
  void setHost(const String& s) { p_.putString("host", s); }
 private:
  static constexpr const char* DEFAULT_HOSTNAME_STR = "roast";
  Preferences p_;
};

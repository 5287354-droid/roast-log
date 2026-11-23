#include "Settings.h"
#include <esp_random.h>

void Settings::begin() { p_.begin("roast", false); }

void Settings::loadConfig(DeviceConfig& c) {
  cfgDefaults(c);
  uint8_t m = p_.getUChar("mains", c.mains); if (m == 50 || m == 60) c.mains = m;
  uint8_t a = p_.getUChar("avg", c.avg); if (a == 1 || a == 2 || a == 4 || a == 8 || a == 16) c.avg = a;
  c.rev = p_.getUInt("rev", c.rev);
  for (int i = 0; i < 3; i++) {
    char k[16];
    ChannelCfg& ch = c.ch[i];
    snprintf(k, sizeof k, "ch%d.en", i); ch.enabled = p_.getBool(k, ch.enabled);
    snprintf(k, sizeof k, "ch%d.role", i); { int r = roleIndex(p_.getString(k, kRoles[ch.role]).c_str()); if (r >= 0) ch.role = (uint8_t)r; }
    snprintf(k, sizeof k, "ch%d.name", i); { String s = p_.getString(k, ch.name); if (s.length() < sizeof(ch.name)) strcpy(ch.name, s.c_str()); }
    snprintf(k, sizeof k, "ch%d.color", i); { String s = p_.getString(k, ch.color); if (s.length() == 7) strcpy(ch.color, s.c_str()); }
    snprintf(k, sizeof k, "ch%d.off", i); ch.off10 = (int16_t)p_.getShort(k, ch.off10);
  }
}

void Settings::saveConfig(const DeviceConfig& c) {
  p_.putUChar("mains", c.mains);
  p_.putUChar("avg", c.avg);
  p_.putUInt("rev", c.rev);
  for (int i = 0; i < 3; i++) {
    char k[16];
    const ChannelCfg& ch = c.ch[i];
    snprintf(k, sizeof k, "ch%d.en", i); p_.putBool(k, ch.enabled);
    snprintf(k, sizeof k, "ch%d.role", i); p_.putString(k, kRoles[ch.role]);
    snprintf(k, sizeof k, "ch%d.name", i); p_.putString(k, ch.name);
    snprintf(k, sizeof k, "ch%d.color", i); p_.putString(k, ch.color);
    snprintf(k, sizeof k, "ch%d.off", i); p_.putShort(k, ch.off10);
  }
}

String Settings::apPass() {
  String s = p_.getString("ap.pass", "");
  if (s.length() == 8) return s;
  char b[12];
  snprintf(b, sizeof b, "%08u", (unsigned)(esp_random() % 100000000u));
  s = b;
  p_.putString("ap.pass", s);
  return s;
}

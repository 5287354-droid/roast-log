#include "CfgModel.h"
#include <string.h>
#include <math.h>

const char* const kRoles[5] = {"bt", "et", "amb", "inlet", "off"};

static void setCh(ChannelCfg& c, bool en, const char* role, const char* name, const char* color) {
  c.enabled = en; c.role = (uint8_t)roleIndex(role);
  strncpy(c.name, name, sizeof(c.name) - 1); c.name[sizeof(c.name) - 1] = 0;
  strncpy(c.color, color, sizeof(c.color) - 1); c.color[sizeof(c.color) - 1] = 0;
  c.off10 = 0;
}
void cfgDefaults(DeviceConfig& c) {
  setCh(c.ch[0], true, "bt", "豆温度", "#C2410C");
  setCh(c.ch[1], true, "et", "排気", "#7A5AA6");
  setCh(c.ch[2], false, "off", "", "#6B7280");
  c.mains = 50; c.avg = 4; c.rateHz = 1; c.rev = 1;   // sim サーバと同じく 1 から
}
int roleIndex(const char* s) {
  for (int i = 0; i < 5; i++) if (strcmp(s, kRoles[i]) == 0) return i;
  return -1;
}
int utf16Len(const char* s) {
  int n = 0;
  for (const unsigned char* p = (const unsigned char*)s; *p; p++) {
    if ((*p & 0xC0) == 0x80) continue;      // 続きバイト
    n += (*p >= 0xF0) ? 2 : 1;               // 4 バイト文字はサロゲートペア
  }
  return n;
}
static bool isHexColor(const char* s) {
  if (strlen(s) != 7 || s[0] != '#') return false;
  for (int i = 1; i < 7; i++) if (!isxdigit((unsigned char)s[i])) return false;
  return true;
}

bool ampIsConfigurable(const char* a) { return strcmp(a, "max31855") != 0; }

const char* applySetcfg(DeviceConfig& cfg, JsonObjectConst m, bool ampConfigurable) {
  DeviceConfig next = cfg;
  if (!m["amp"].isNull() && !ampConfigurable) return "unsupported";   // sim サーバと同じく最初に判定
  if (!m["baseRev"].isNull()) {
    if (!m["baseRev"].is<int64_t>()) return "bad_value";
    if ((int64_t)m["baseRev"].as<int64_t>() != (int64_t)cfg.rev) return "stale";
  }
  if (!m["channels"].isNull()) {
    if (!m["channels"].is<JsonArrayConst>()) return "bad_value";
    for (JsonVariantConst chv : m["channels"].as<JsonArrayConst>()) {
      if (!chv.is<JsonObjectConst>()) return "bad_channel";
      JsonObjectConst ch = chv.as<JsonObjectConst>();
      if (!ch["idx"].is<int>()) return "bad_channel";
      int idx = ch["idx"].as<int>();
      if (idx < 0 || idx > 2) return "bad_channel";
      ChannelCfg& t = next.ch[idx];
      if (!ch["enabled"].isNull()) { if (!ch["enabled"].is<bool>()) return "bad_value"; t.enabled = ch["enabled"].as<bool>(); }
      if (!ch["role"].isNull()) {
        if (!ch["role"].is<const char*>()) return "bad_value";
        int r = roleIndex(ch["role"].as<const char*>());
        if (r < 0) return "bad_value";
        t.role = (uint8_t)r;
      }
      if (!ch["name"].isNull()) {
        if (!ch["name"].is<const char*>()) return "bad_value";
        const char* s = ch["name"].as<const char*>();
        if (utf16Len(s) > 24 || strlen(s) >= sizeof(t.name)) return "bad_value";
        strcpy(t.name, s);
      }
      if (!ch["color"].isNull()) {
        if (!ch["color"].is<const char*>() || !isHexColor(ch["color"].as<const char*>())) return "bad_value";
        strcpy(t.color, ch["color"].as<const char*>());
      }
      if (!ch["offset"].isNull()) {
        if (!(ch["offset"].is<float>() || ch["offset"].is<int>())) return "bad_value";
        double o = ch["offset"].as<double>();
        if (!(fabs(o) <= 50.0)) return "bad_value";
        t.off10 = (int16_t)floor(o * 10.0 + 0.5);
      }
    }
  }
  if (!m["amp"].isNull()) {
    if (!m["amp"].is<JsonObjectConst>()) return "bad_value";
    JsonObjectConst a = m["amp"].as<JsonObjectConst>();
    if (!a["mains"].isNull()) {
      if (!a["mains"].is<int>()) return "bad_value";
      int v = a["mains"].as<int>();
      if (v != 50 && v != 60) return "bad_value";
      next.mains = (uint8_t)v;
    }
    if (!a["avg"].isNull()) {
      if (!a["avg"].is<int>()) return "bad_value";
      int v = a["avg"].as<int>();
      if (v != 1 && v != 2 && v != 4 && v != 8 && v != 16) return "bad_value";
      next.avg = (uint8_t)v;
    }
  }
  next.rev = cfg.rev + 1;
  cfg = next;
  return nullptr;
}

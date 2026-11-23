#include "WsProtocol.h"
#include <stdio.h>
#include <string.h>
#include <ArduinoJson.h>

namespace wsp {

static void appendInt(std::string& o, long long v) { char b[24]; snprintf(b, sizeof b, "%lld", v); o += b; }
static void appendTemp(std::string& o, int16_t v) { if (v == NIL) o += "null"; else appendInt(o, v); }

std::string jsonEscape(const std::string& s) {
  std::string o;
  for (unsigned char c : s) {
    switch (c) {
      case '"': o += "\\\""; break;
      case '\\': o += "\\\\"; break;
      case '\n': o += "\\n"; break;
      case '\r': o += "\\r"; break;
      case '\t': o += "\\t"; break;
      default:
        if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; } else o += (char)c;
    }
  }
  return o;
}
static void appendStr(std::string& o, const std::string& s) { o += '"'; o += jsonEscape(s); o += '"'; }

// 0.1℃ 整数 → JS の JSON.stringify と同じ書き方（0 / -0.8 / 1.5）
static void appendOffset(std::string& o, int16_t off10) {
  if (off10 == 0) { o += "0"; return; }
  int a = off10 < 0 ? -off10 : off10;
  char b[24];
  if (a % 10 == 0) snprintf(b, sizeof b, "%s%d", off10 < 0 ? "-" : "", a / 10);
  else snprintf(b, sizeof b, "%s%d.%d", off10 < 0 ? "-" : "", a / 10, a % 10);
  o += b;
}

std::string encCfgBody(const DeviceInfo& di, const DeviceConfig& c, bool withType) {
  std::string o = "{";
  if (withType) o += "\"type\":\"cfg\",";
  o += "\"rev\":"; appendInt(o, c.rev);
  o += ",\"channels\":[";
  for (int i = 0; i < 3; i++) {
    const ChannelCfg& ch = c.ch[i];
    if (i) o += ',';
    o += "{\"idx\":"; appendInt(o, i);
    o += ",\"enabled\":"; o += ch.enabled ? "true" : "false";
    o += ",\"role\":"; appendStr(o, kRoles[ch.role]);
    o += ",\"name\":"; appendStr(o, ch.name);
    o += ",\"color\":"; appendStr(o, ch.color);
    o += ",\"offset\":"; appendOffset(o, ch.off10);
    o += '}';
  }
  o += "],\"amp\":{\"type\":"; appendStr(o, di.amp);
  o += ",\"mains\":"; appendInt(o, c.mains);
  o += ",\"avg\":"; appendInt(o, c.avg);
  o += "},\"rateHz\":"; appendInt(o, c.rateHz);
  o += '}';
  return o;
}

std::string encHello(const DeviceInfo& di, uint32_t ms, uint32_t seq, uint32_t bufFrom, const DeviceConfig& c) {
  std::string o = "{\"type\":\"hello\",\"proto\":1,\"fw\":"; appendStr(o, di.fw);
  o += ",\"model\":"; appendStr(o, di.model);
  o += ",\"amp\":"; appendStr(o, di.amp);
  o += ",\"id\":"; appendStr(o, di.id);
  o += ",\"bootId\":"; appendStr(o, di.bootId);
  o += ",\"ms\":"; appendInt(o, ms);
  o += ",\"seq\":"; appendInt(o, seq);
  o += ",\"bufFrom\":"; appendInt(o, bufFrom);
  o += ",\"rateHz\":"; appendInt(o, c.rateHz);
  o += ",\"chMax\":3,\"speed\":"; appendInt(o, di.speed);
  o += ",\"cfg\":"; o += encCfgBody(di, c, false);
  o += '}';
  return o;
}

std::string encS(uint32_t seq, const Sample& s) {
  std::string o = "{\"type\":\"s\",\"seq\":"; appendInt(o, seq);
  o += ",\"ms\":"; appendInt(o, s.ms);
  o += ",\"v\":["; for (int i = 0; i < 3; i++) { if (i) o += ','; appendTemp(o, s.v[i]); }
  o += "],\"f\":["; for (int i = 0; i < 3; i++) { if (i) o += ','; appendInt(o, s.f[i]); }
  o += "],\"cj\":"; appendTemp(o, s.cj);
  o += '}';
  return o;
}

std::string encBf(const Ring& ring, uint32_t from, uint32_t to, bool lost, uint32_t msFallback) {
  bool empty = to < from || (from == 0 && to == 0xFFFFFFFFu);
  uint32_t n = empty ? 0 : to - from + 1;
  const Sample* first = empty ? nullptr : ring.get(from);
  uint32_t ms0 = first ? first->ms : msFallback;
  std::string o; o.reserve(64 + n * 24);
  o += "{\"type\":\"bf\",\"from\":"; appendInt(o, from);
  o += ",\"to\":"; appendInt(o, empty ? (long long)from - 1 : (long long)to);
  o += ",\"lost\":"; o += lost ? "true" : "false";
  o += ",\"ms0\":"; appendInt(o, ms0);
  o += ",\"dt\":1000,\"v\":[";
  for (int c = 0; c < 3; c++) {
    if (c) o += ',';
    o += '[';
    for (uint32_t i = 0; i < n; i++) { if (i) o += ','; const Sample* s = ring.get(from + i); appendTemp(o, s ? s->v[c] : NIL); }
    o += ']';
  }
  o += "],\"f\":[";
  for (int c = 0; c < 3; c++) {
    if (c) o += ',';
    o += '[';
    for (uint32_t i = 0; i < n; i++) { if (i) o += ','; const Sample* s = ring.get(from + i); appendInt(o, s ? s->f[c] : 0); }
    o += ']';
  }
  o += "]}";
  return o;
}

std::string encSt(const StatusInfo& st) {
  std::string o = "{\"type\":\"st\",\"rssi\":"; appendInt(o, st.rssi);
  o += ",\"mode\":"; appendStr(o, st.mode);
  o += ",\"ip\":"; appendStr(o, st.ip);
  o += ",\"heap\":"; appendInt(o, st.heap);
  o += ",\"uptime\":"; appendInt(o, st.uptime);
  o += ",\"clients\":"; appendInt(o, st.clients);
  o += '}';
  return o;
}

std::string encAck(const std::string* id, bool ok, const char* err, const uint32_t* rev) {
  std::string o = "{\"type\":\"ack\"";
  if (id) { o += ",\"id\":"; appendStr(o, *id); }
  o += ",\"ok\":"; o += ok ? "true" : "false";
  if (!ok && err) { o += ",\"err\":"; appendStr(o, err); }
  if (rev) { o += ",\"rev\":"; appendInt(o, *rev); }
  o += '}';
  return o;
}

std::string encPong(const std::string* id, int64_t t, uint32_t ms) {
  std::string o = "{\"type\":\"pong\"";
  if (id) { o += ",\"id\":"; appendStr(o, *id); }
  o += ",\"t\":"; appendInt(o, t);
  o += ",\"ms\":"; appendInt(o, ms);
  o += '}';
  return o;
}
}  // namespace wsp

// ------------------------------------------------------------------ engine
ProtocolEngine::Client* ProtocolEngine::find(uint32_t id) {
  for (auto& c : cl_) if (c.used && c.id == id) return &c;
  return nullptr;
}
int ProtocolEngine::clientCount() const { int n = 0; for (auto& c : cl_) if (c.used) n++; return n; }

bool ProtocolEngine::onOpen(uint32_t id, uint32_t nowMs) {
  if (find(id)) return true;
  for (auto& c : cl_) if (!c.used) { c = Client(); c.used = true; c.id = id; c.openMs = nowMs; return true; }
  return false;
}
void ProtocolEngine::onClose(uint32_t id) { if (Client* c = find(id)) *c = Client(); }

void ProtocolEngine::sendHello(Client& c, uint32_t nowMs, Sink& sink) {
  uint32_t sq = ring_.seq();
  const Sample* last = sq ? ring_.get(sq) : nullptr;
  sink.send(c.id, wsp::encHello(di_, last ? last->ms : nowMs, sq, ring_.bufFrom(), cfg_));
  c.ready = true;
}

// 1 フレーム送る。送り終えたら false
bool ProtocolEngine::stepJob(Client& c, Job& j, Sink& sink) {
  if (!j.active) return false;
  if (!sink.canSend(c.id)) return true;
  uint32_t lim = j.dynamic ? ring_.seq() : j.to;
  RangePlan p = ring_.plan((int64_t)j.next, (int64_t)lim);
  if (p.empty) {
    uint32_t sq = ring_.seq();
    const Sample* l = sq ? ring_.get(sq) : nullptr;
    sink.send(c.id, wsp::encBf(ring_, p.from, p.from - 1, p.lost || j.lost, l ? l->ms + 1000 * (p.from - sq) : lastNowMs_));
    j.active = false;
    return false;
  }
  uint32_t to = p.to;
  if (to - p.from + 1 > BF_MAX_SAMPLES) to = p.from + BF_MAX_SAMPLES - 1;
  sink.send(c.id, wsp::encBf(ring_, p.from, to, p.lost || j.lost, lastNowMs_));
  j.lost = false;
  j.next = to + 1;
  if (j.dynamic && to > c.sentSeq) c.sentSeq = to;
  uint32_t lim2 = j.dynamic ? ring_.seq() : j.to;
  if (j.next > lim2) { j.active = false; return false; }
  return true;
}

void ProtocolEngine::pump(uint32_t nowMs, Sink& sink) {
  lastNowMs_ = nowMs;
  for (auto& c : cl_) {
    if (!c.used) continue;
    if (!c.ready) {
      if ((int32_t)(nowMs - c.openMs) >= (int32_t)HELLO_DELAY_MS) { sendHello(c, nowMs, sink); c.sentSeq = ring_.seq(); }
      continue;
    }
    if (c.autoJob.active) { stepJob(c, c.autoJob, sink); continue; }  // 接続ごとに 1 ループ 1 フレーム
    for (auto& q : c.reqQ) if (q.active) { stepJob(c, q, sink); break; }
  }
}

void ProtocolEngine::onSample(Sink& sink) {
  uint32_t sq = ring_.seq();
  const Sample* s = ring_.get(sq);
  if (!s) return;
  std::string txt;
  for (auto& c : cl_) {
    if (!c.used || !c.ready) continue;
    if (c.autoJob.active) continue;  // pump が bf に含めて送る
    if (c.sentSeq + 1 == sq && sink.canSend(c.id)) {
      if (txt.empty()) txt = wsp::encS(sq, *s);
      sink.send(c.id, txt);
      c.sentSeq = sq;
    } else if (c.sentSeq < sq) {
      // 送れなかった／抜けた分は bf で追いつく（s より先に bf）
      c.autoJob.active = true; c.autoJob.dynamic = true; c.autoJob.next = c.sentSeq + 1; c.autoJob.lost = false;
    }
  }
}

void ProtocolEngine::broadcastSt(const StatusInfo& st0, Sink& sink) {
  StatusInfo st = st0; st.clients = clientCount();
  std::string txt = wsp::encSt(st);
  for (auto& c : cl_) if (c.used && c.ready && sink.canSend(c.id)) sink.send(c.id, txt);
}

void ProtocolEngine::broadcastCfg(Sink& sink) {
  std::string txt = wsp::encCfgBody(di_, cfg_, true);
  for (auto& c : cl_) if (c.used && c.ready) sink.send(c.id, txt);
}

void ProtocolEngine::onMessage(uint32_t id, const char* data, size_t len, uint32_t nowMs, Sink& sink) {
  lastNowMs_ = nowMs;
  Client* c = find(id);
  if (!c) return;
  JsonDocument doc;
  if (deserializeJson(doc, data, len)) return;
  if (!doc.is<JsonObject>()) return;
  JsonObjectConst m = doc.as<JsonObjectConst>();
  if (!m["type"].is<const char*>()) return;
  std::string type = m["type"].as<const char*>();
  std::string idStr; const std::string* idp = nullptr;
  if (m["id"].is<const char*>()) { idStr = m["id"].as<const char*>(); idp = &idStr; }
  auto ack = [&](bool ok, const char* err, const uint32_t* rev = nullptr) {
    if (idp) sink.send(id, wsp::encAck(idp, ok, err, rev));
  };

  if (type == "hi") {
    sendHello(*c, nowMs, sink);
    c->autoJob = Job(); for (auto& q : c->reqQ) q = Job();
    uint32_t sq = ring_.seq();
    c->sentSeq = sq;
    if (m["bootId"].is<const char*>() && strcmp(m["bootId"].as<const char*>(), di_.bootId) == 0 &&
        m["lastSeq"].is<int64_t>()) {
      int64_t ls = m["lastSeq"].as<int64_t>();
      if (ls >= 0 && ls < (int64_t)sq) {
        c->sentSeq = (uint32_t)ls;
        c->autoJob.active = true; c->autoJob.dynamic = true; c->autoJob.next = (uint32_t)ls + 1;
      }
    }
  } else if (type == "bf_req") {
    if (!m["from"].is<int64_t>() || !m["to"].is<int64_t>()) { ack(false, "bad_range"); return; }
    Job* slot = nullptr;
    for (auto& q : c->reqQ) if (!q.active) { slot = &q; break; }
    if (!slot) { ack(false, "busy"); return; }
    int64_t f = m["from"].as<int64_t>(), t = m["to"].as<int64_t>();
    RangePlan p = ring_.plan(f, t);
    *slot = Job();
    slot->active = true; slot->dynamic = false; slot->lost = p.lost;
    if (p.empty) { slot->next = p.from; slot->to = p.from - 1; }
    else { slot->next = p.from; slot->to = p.to; }
  } else if (type == "ping") {
    int64_t t = m["t"].is<int64_t>() ? m["t"].as<int64_t>() : (m["t"].is<double>() ? (int64_t)m["t"].as<double>() : 0);
    uint32_t sq = ring_.seq();
    const Sample* l = sq ? ring_.get(sq) : nullptr;
    sink.send(id, wsp::encPong(idp, t, l ? l->ms : nowMs));
  } else if (type == "setcfg") {
    const char* err = applySetcfg(cfg_, m);
    if (err) { uint32_t rev = cfg_.rev; ack(false, err, strcmp(err, "stale") == 0 ? &rev : nullptr); }
    else { ack(true, nullptr); cfgChanged_ = true; broadcastCfg(sink); }
  } else if (type == "identify") {
    identify_ = true; ack(true, nullptr);
  } else {
    ack(false, "unknown_type");
  }
}

#include "Improv.h"
#include <string.h>

static const char HDR[6] = {'I', 'M', 'P', 'R', 'O', 'V'};

std::string ImprovSerial::packet(uint8_t type, const std::string& data) {
  std::string p(HDR, 6);
  p += (char)1;                       // バージョン
  p += (char)type;
  p += (char)(uint8_t)data.size();
  p += data;
  uint8_t sum = 0;
  for (unsigned char c : p) sum = (uint8_t)(sum + c);
  p += (char)sum;
  return p;
}
std::string ImprovSerial::state(State s) { return packet(0x01, std::string(1, (char)s)); }
std::string ImprovSerial::error(Err e) { return packet(0x02, std::string(1, (char)e)); }

std::string ImprovSerial::result(Cmd cmd, const std::vector<std::string>& strings) {
  std::string body;
  for (const auto& s : strings) { std::string t = s.substr(0, 255); body += (char)(uint8_t)t.size(); body += t; }
  if (body.size() > 250) body.resize(250);   // 1 パケットは 255 バイトまで（命令 ID と長さの分を残す）
  std::string d; d += (char)cmd; d += (char)(uint8_t)body.size(); d += body;
  return packet(0x04, d);
}
std::string ImprovSerial::resultEmpty(Cmd cmd) {
  std::string d; d += (char)cmd; d += (char)0;
  return packet(0x04, d);
}

bool ImprovSerial::feed(uint8_t b, Rpc& out) {
  size_t n = buf_.size();
  if (n < 6) {
    if (b == (uint8_t)HDR[n]) { buf_ += (char)b; return false; }
    buf_.clear();
    if (b == (uint8_t)HDR[0]) buf_ += (char)b;   // 'I' から始め直す
    return false;
  }
  buf_ += (char)b;
  n = buf_.size();
  if (n == 7 && (uint8_t)buf_[6] != 1) { buf_.clear(); return false; }   // 知らないバージョンは読み捨てる
  if (n < 9) return false;
  size_t total = 9 + (uint8_t)buf_[8] + 1;
  if (n < total) return false;
  bool ok = finish(out);
  buf_.clear();
  return ok;
}

bool ImprovSerial::finish(Rpc& out) {
  uint8_t sum = 0;
  for (size_t i = 0; i + 1 < buf_.size(); i++) sum = (uint8_t)(sum + (uint8_t)buf_[i]);
  if (sum != (uint8_t)buf_.back()) { err_ = ERR_INVALID_RPC; return false; }
  uint8_t type = (uint8_t)buf_[7], len = (uint8_t)buf_[8];
  if (type != 0x03) return false;     // 命令以外（機器が出すパケットのエコーなど）は無視
  const uint8_t* d = (const uint8_t*)buf_.data() + 9;
  if (len < 2 || d[1] != len - 2) { err_ = ERR_INVALID_RPC; return false; }
  out = Rpc();
  switch (d[0]) {
    case CMD_WIFI: {
      const uint8_t* p = d + 2; size_t left = d[1];
      if (left < 1) { err_ = ERR_INVALID_RPC; return false; }
      size_t sl = p[0];
      if (sl + 2 > left) { err_ = ERR_INVALID_RPC; return false; }
      size_t pl = p[1 + sl];
      if (1 + sl + 1 + pl != left) { err_ = ERR_INVALID_RPC; return false; }
      out.cmd = CMD_WIFI;
      out.ssid.assign((const char*)p + 1, sl);
      out.pass.assign((const char*)p + 2 + sl, pl);
      return true;
    }
    case CMD_IDENTIFY: out.cmd = CMD_IDENTIFY; return true;
    case CMD_GET_STATE: out.cmd = CMD_GET_STATE; return true;
    case CMD_GET_INFO: out.cmd = CMD_GET_INFO; return true;
    case CMD_SCAN: out.cmd = CMD_SCAN; return true;
    default: err_ = ERR_UNKNOWN_RPC; return false;
  }
}

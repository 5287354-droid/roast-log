#include "DnsReply.h"
#include <string.h>
#include <ctype.h>

static bool nameMatches(const char* host, const char* qname) {
  // qname は "roast.local" の形（小文字化済み）
  size_t hl = strlen(host);
  if (strcmp(qname, host) == 0) return true;
  if (strlen(qname) == hl + 6 && strncmp(qname, host, hl) == 0 && strcmp(qname + hl, ".local") == 0) return true;
  return false;
}

size_t dnsBuildReply(const uint8_t* q, size_t n, const char* host, const uint8_t ip[4], uint8_t* out, size_t cap) {
  if (n < 12 || cap < n + 16) return 0;
  if (q[2] & 0x80) return 0;                       // QR=1 は応答
  if (((q[2] >> 3) & 0x0F) != 0) return 0;         // opcode は標準問い合わせだけ
  uint16_t qd = (uint16_t)((q[4] << 8) | q[5]);
  if (qd != 1) return 0;
  // 質問名を読む
  char name[64]; size_t ni = 0; size_t p = 12;
  for (;;) {
    if (p >= n) return 0;
    uint8_t l = q[p++];
    if (l == 0) break;
    if (l & 0xC0) return 0;                        // 質問に圧縮は来ない
    if (p + l > n || ni + l + 1 >= sizeof(name)) return 0;
    if (ni) name[ni++] = '.';
    for (uint8_t i = 0; i < l; i++) name[ni++] = (char)tolower(q[p + i]);
    p += l;
  }
  name[ni] = 0;
  if (p + 4 > n) return 0;
  uint16_t qtype = (uint16_t)((q[p] << 8) | q[p + 1]);
  size_t qend = p + 4;
  bool match = nameMatches(host, name);
  memcpy(out, q, qend);
  out[2] = (uint8_t)(0x80 | (q[2] & 0x01));        // QR=1, RD を写す
  out[3] = (uint8_t)(0x80 | (match ? 0 : 3));      // RA=1, RCODE: 0 = OK / 3 = NXDOMAIN
  out[6] = 0; out[7] = 0; out[8] = 0; out[9] = 0; out[10] = 0; out[11] = 0;
  size_t o = qend;
  if (match && (qtype == 1 /*A*/ || qtype == 255 /*ANY*/)) {
    out[7] = 1;
    out[o++] = 0xC0; out[o++] = 0x0C;
    out[o++] = 0; out[o++] = 1;                    // TYPE A
    out[o++] = 0; out[o++] = 1;                    // CLASS IN
    out[o++] = 0; out[o++] = 0; out[o++] = 0; out[o++] = 60;  // TTL 60
    out[o++] = 0; out[o++] = 4;
    memcpy(out + o, ip, 4); o += 4;
  }
  return o;
}

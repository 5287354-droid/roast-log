#pragma once
// AP 用の最小 DNS 応答（SPEC 6.5）。host.local と host（既定 roast.local / roast）にだけ ip を返し、
// 他の名前は NXDOMAIN にする。全ドメインに答えると iOS のキャプティブポータルの
// ミニブラウザが開き、localStorage が保持されないため。Arduino に依存しない。
#include <stddef.h>
#include <stdint.h>

// 戻り値: 応答の長さ。0 = 返さない（壊れたパケット・応答パケット）
size_t dnsBuildReply(const uint8_t* q, size_t n, const char* host, const uint8_t ip[4], uint8_t* out, size_t cap);

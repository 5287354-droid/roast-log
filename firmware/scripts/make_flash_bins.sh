#!/usr/bin/env bash
# ブラウザ書き込みページ（docs/flash/）用の bin を作る。
#   bash firmware/scripts/make_flash_bins.sh            # 既定: xiao_c3 xiao_c3_31856 esp32dev
#   bash firmware/scripts/make_flash_bins.sh xiao_c3     # env を指定
# 出力: docs/flash/firmware/<env>/roastlog-<env>-merged.bin と docs/flash/manifest*.json の version 更新
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FW="$(dirname "$HERE")"
ROOT="$(dirname "$FW")"
OUT="$ROOT/docs/flash/firmware"
ENVS=("$@")
[ ${#ENVS[@]} -eq 0 ] && ENVS=(xiao_c3 xiao_c3_31856 esp32dev)
VER="$(sed -n 's/^#define FW_VERSION "\(.*\)"/\1/p' "$FW/include/config.h")"
cd "$FW"
for e in "${ENVS[@]}"; do
  echo "== $e"
  pio run -e "$e"
  pio run -e "$e" -t buildfs
  pio run -e "$e" -t mergebin
  mkdir -p "$OUT/$e"
  cp ".pio/build/$e/roastlog-$e-merged.bin" "$OUT/$e/"
done
# manifest の version をファームの版に合わせる
for m in "$ROOT"/docs/flash/manifest*.json; do
  python3 - "$m" "$VER" <<'PY'
import json, sys
p, v = sys.argv[1], sys.argv[2]
j = json.load(open(p, encoding="utf-8")); j["version"] = v
json.dump(j, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2); open(p, "a").write("\n")
PY
done
echo "できあがり: $OUT （version $VER）"
ls -la "$OUT"/*/

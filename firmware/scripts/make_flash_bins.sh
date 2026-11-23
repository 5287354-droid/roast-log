#!/usr/bin/env bash
# ブラウザ書き込みページ（docs/flash/）用の bin を作る。
#   bash firmware/scripts/make_flash_bins.sh            # 既定: xiao_c3 xiao_c3_31856 esp32dev
#   bash firmware/scripts/make_flash_bins.sh xiao_c3     # env を指定
# 出力: docs/flash/firmware/<env>/{bootloader,partitions,boot_app0,firmware,littlefs}.bin と、docs/flash/manifest*.json
#
# SPEC 9.6: manifest は 5 つの部品（bootloader / パーティション表 / boot_app0 / app / LittleFS）に分け、
# NVS の領域には書かない（Wi-Fi・補正値が書き込みで消えない）。オフセットは PlatformIO（flashparts）が決めたものをそのまま使う。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FW="$(dirname "$HERE")"
ROOT="$(dirname "$FW")"
OUT="$ROOT/docs/flash/firmware"
ENVS=("$@")
[ ${#ENVS[@]} -eq 0 ] && ENVS=(xiao_c3 xiao_c3_31856 esp32dev)
cd "$FW"
for e in "${ENVS[@]}"; do
  echo "== $e"
  pio run -e "$e"
  pio run -e "$e" -t buildfs
  pio run -e "$e" -t flashparts
  mkdir -p "${OUT:?}/${e:?}"
  rm -f "${OUT:?}/${e:?}/"*.bin "${OUT:?}/${e:?}/flashparts.json"   # 前の版（merged bin など）を消す
  cp ".pio/build/$e/flashparts/"*.bin ".pio/build/$e/flashparts/flashparts.json" "$OUT/$e/"
done
# manifest を作り直す（version はファームの版、オフセットは flashparts.json から）
python3 "$HERE/make_manifests.py" "$ROOT"
# 組み立て手順（docs/HARDWARE.md）を、Pages でも開ける HTML にする（書き込みページのリンク先）
python3 "$HERE/md_to_html.py" "$ROOT"
echo "できあがり: $OUT"
ls -la "$OUT"/*/

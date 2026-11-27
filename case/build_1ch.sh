#!/bin/sh
# 1 本用ケースの STL とプレビュー画像を作る。OpenSCAD 2021.01 以降が必要。画像は xvfb-run が必要。
# 既定の基板は 7050（実物 70×50mm）。stl/1ch/ と preview/1ch/ に出す。
# 前に仮定した秋月 C タイプ（72×47）の STL は stl/1ch/akizukiC/ に出す（画像は作らない）。
set -e
cd "$(dirname "$0")"
mkdir -p stl/1ch stl/1ch/akizukiC preview/1ch
for p in body lid button; do
  openscad -D "part=\"$p\"" -D 'board="7050"' -o stl/1ch/$p.stl roastlogger_case_1ch.scad
  openscad -D "part=\"$p\"" -D 'board="akizukiC"' -o stl/1ch/akizukiC/$p.stl roastlogger_case_1ch.scad
done
img() { # 名前 part カメラ(平行移動,回転,距離)
  xvfb-run -a openscad -D "part=\"$2\"" -D 'board="7050"' --camera="$3" --projection=o --imgsize=1400,1000 --colorscheme=Tomorrow -o preview/1ch/$1.png roastlogger_case_1ch.scad
}
img assembly_oblique assembly "40,26,14,55,0,25,260"
img assembly_open_oblique assembly_open "40,26,14,55,0,25,260"
img assembly_open_top assembly_open "40,26,14,0,0,0,260"
img assembly_section assembly_cut "40,26,14,80,0,20,260"
img lid_oblique lid "40,26,5,55,0,25,260"
img body_oblique body "40,26,10,55,0,25,260"

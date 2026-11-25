#!/bin/sh
# 1 本用ケースの STL とプレビュー画像を作る。OpenSCAD 2021.01 以降が必要。画像は xvfb-run が必要。
set -e
cd "$(dirname "$0")"
mkdir -p stl/1ch preview/1ch
for p in body lid button; do openscad -D "part=\"$p\"" -o stl/1ch/$p.stl roastlogger_case_1ch.scad; done
img() { # 名前 part カメラ(平行移動,回転,距離)
  xvfb-run -a openscad -D "part=\"$2\"" --camera="$3" --projection=o --imgsize=1400,1000 --colorscheme=Tomorrow -o preview/1ch/$1.png roastlogger_case_1ch.scad
}
img assembly_oblique assembly "40,26,14,55,0,25,260"
img assembly_open_oblique assembly_open "40,26,14,55,0,25,260"
img assembly_open_top assembly_open "40,26,14,0,0,0,260"
img assembly_section assembly_cut "40,26,14,80,0,20,260"
img lid_oblique lid "40,26,5,55,0,25,260"
img body_oblique body "40,26,10,55,0,25,260"

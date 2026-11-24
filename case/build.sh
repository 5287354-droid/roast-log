#!/bin/sh
# STL とプレビュー画像を作る。OpenSCAD 2021.01 以降が必要。画像は xvfb-run が必要。
set -e
cd "$(dirname "$0")"
mkdir -p stl preview
for p in body lid button divider; do openscad -D "part=\"$p\"" -o stl/$p.stl roastlogger_case.scad; done
img() { # 名前 part カメラ(平行移動,回転,距離)
  xvfb-run -a openscad -D "part=\"$2\"" --camera="$3" --projection=o --imgsize=1400,1000 --colorscheme=Tomorrow -o preview/$1.png roastlogger_case.scad
}
img assembly_oblique assembly "52,38,18,55,0,25,330"
img assembly_open_oblique assembly_open "52,38,18,55,0,25,330"
img assembly_open_top assembly_open "52,38,18,0,0,0,330"
img assembly_section assembly_cut "52,60,18,80,0,20,330"
img lid_oblique lid "52,38,5,55,0,25,330"
img body_oblique body "52,38,10,55,0,25,350"

# roast-log

焙煎記録ノートを K型熱電対（1〜3本）で自動測定できるようにするプロジェクト。ESP32 がアプリのページと測定値を Wi-Fi で配信する。

- 仕様: docs/SPEC.md
- 部品と原価: docs/BOM.md
- 現行版（手入力）: legacy/roastlog-artifact-v1.html
- 温度計の組み立て（配線・はんだ付け・熱電対）: docs/HARDWARE.md
- ファームウェア（ESP32 / PlatformIO）: firmware/README.md
- ブラウザから温度計に書き込むページ: docs/flash/index.html（GitHub Pages で `/docs` を公開すると `…/flash/` で開ける。bin の作り方は firmware/README.md）

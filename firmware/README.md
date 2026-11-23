# ファームウェア（ESP32 / PlatformIO）

SPEC 6章の実装。フェーズ F1（計測の核）と F2（ネットワーク）。

## env

| env | ボード | アンプ | 用途 |
|---|---|---|---|
| `xiao_c3`（既定） | Seeed XIAO ESP32C3 | MAX31855 | 試作の標準 |
| `xiao_c3_31856` | XIAO ESP32C3 | MAX31856 | |
| `xiao_c3_sim` | XIAO ESP32C3 | SimTcDriver（熱電対なし） | 適合試験・Wi-Fi の確認 |
| `esp32dev` | ESP32 DevKitC | MAX31855 | 手持ちの DevKit |
| `esp32c3_devkit` | ESP32-C3-DevKitM-1 | MAX31855 | |
| `native` | PC | — | 単体テスト（Unity） |
| `native_bridge` | PC | SimTcDriver | ファームの C++ を PC で動かして適合試験に通す |

アンプはビルドフラグ `-DTC_DRIVER_MAX31855` / `-DTC_DRIVER_MAX31856` / `-DTC_DRIVER_SIM` で選びます（`-DTC_DRIVER_MCP9600` は F3）。

## よく使うコマンド

```sh
cd firmware
pio run -e xiao_c3                 # ビルド（app/index.html の gzip も自動で data/ に作る）
pio run -e xiao_c3 -t upload       # USB で書き込む
pio run -e xiao_c3 -t uploadfs     # LittleFS（アプリ）を書き込む
pio device monitor                 # シリアル 115200bps。1 秒ごとに {"type":"s",...}
pio test -e native                 # 単体テスト
```

## 実機なしでプロトコル適合試験を通す

```sh
cd firmware && pio run -e native_bridge && cd ..
node firmware/tools/fw-bridge.mjs --port 8788 --speed 20 [--amp max31855] &
node tools/test/proto/conformance.mjs --url ws://localhost:8788/ws
```

`fw-bridge.mjs` は `src/` の WsProtocol / Sampler / CfgModel / SimTcDriver を PC でそのまま動かし、WebSocket に見せる橋です（実機の WsHub の代わりに標準入出力を使う）。

## ブラウザ書き込みページ用の bin（merged bin）

```sh
bash firmware/scripts/make_flash_bins.sh          # xiao_c3 xiao_c3_31856 esp32dev
```

各 env で `pio run` → `pio run -t buildfs`（LittleFS の像）→ `pio run -t mergebin`（`scripts/merge_bin.py`）を行い、
`docs/flash/firmware/<env>/roastlog-<env>-merged.bin`（ブートローダ・パーティション表・boot_app0・ファーム・LittleFS を
オフセット 0 からの 1 本にまとめたもの、約 4MB）を作ります。`docs/flash/manifest*.json` の version もそろえます。

GitHub Pages で公開するとき: リポジトリの Settings → Pages で「Deploy from a branch」、フォルダ `/docs` を選ぶと、
`https://<ユーザー名>.github.io/<リポジトリ名>/flash/` が書き込みページになります。bin を作ってコミットしてから公開してください
（CI の firmware ジョブも同じ bin を作り、成果物 `flash-bins` としてダウンロードできます）。Web Serial は https でしか動かないので、Pages（https）で開きます。

## 構成

- `src/Sampler.*` 4 回の読取を中央2値の平均で 1 秒に集約、リングバッファ 3600、seq
- `src/CfgModel.*` 設定（rev 付き）と setcfg の検証・部分更新（baseRev が古ければ `stale`、MAX31855 で amp を変えようとしたら `unsupported`）
- `src/net/WsProtocol.*` JSON のエンコードと接続ごとの送信順（hello → bf をすべて → s、SPEC 9.5）
- `src/net/WsHub.*` AsyncWebSocket との橋。コールバックではキューに積むだけで、処理は loop() で行う
- `src/net/WebServer.*` `/`（LittleFS の index.html.gz）、`/api/info`、`/wifi`、`/api/scan`、`POST /api/wifi`
- `src/net/WifiManager.*` STA（20 秒）→ AP。mDNS `roast.local`。AP では `roast.local` / `roast` にだけ答える DNS（`DnsReply.*`）
- `src/tc/` ドライバ。`Max31855Decode.h` + `NistK.h`（NIST 多項式で直線近似を補正）、`TcFault.h`（故障コード・MAX31856 のレジスタ値）
- `src/Settings.*` NVS（Preferences）

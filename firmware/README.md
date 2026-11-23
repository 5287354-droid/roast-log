# ファームウェア（ESP32 / PlatformIO）

SPEC 6章の実装。フェーズ F1（計測の核）と F2（ネットワーク）。

## env

| env | ボード | アンプ | 用途 |
|---|---|---|---|
| `xiao_c3`（既定） | Seeed XIAO ESP32C3 | MAX31855 | 試作の標準 |
| `xiao_c3_31856` | XIAO ESP32C3 | MAX31856 | |
| `xiao_c3_sim` | XIAO ESP32C3 | SimTcDriver（熱電対なし） | 適合試験・Wi-Fi の確認 |
| `esp32dev` | ESP32 DevKitC | MAX31855 | 手持ちの DevKit |
| `esp32c3_devkit` | ESP32-C3-DevKitM-1 | MAX31855 | **実機で未検証**（ビルドだけ確認。書き込みページにも載せない） |
| `native` | PC | — | 単体テスト（Unity）。Sampler / WsProtocol / 故障 / DNS / HubCore（WsHub の中身）/ Improv / STA つなぎ直し |
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

## パーティション表（SPEC 9.6）

全 env で `roastlog_4mb.csv`（4MB）を使います。OTA は後から表を変えられないので、最初に決めた配分です。

| 名前 | オフセット | 大きさ | 用途 |
|---|---|---|---|
| nvs | 0x9000 | 20KB | Wi-Fi・補正値（書き込みページは**書かない**） |
| otadata | 0xE000 | 8KB | どちらの app で起動するか（boot_app0.bin） |
| app0 / app1 | 0x10000 / 0x1D0000 | 各 1.75MB | ファーム（OTA 用に 2 面） |
| coredump | 0x390000 | 64KB | クラッシュ時の記録 |
| spiffs（LittleFS） | 0x3A0000 | 384KB | アプリ（index.html.gz。約 80KB） |

## ブラウザ書き込みページ用の bin（5 つの部品）

```sh
bash firmware/scripts/make_flash_bins.sh          # xiao_c3 xiao_c3_31856 esp32dev
node firmware/tools/check-flash-page.mjs --bins   # manifest・オフセット・パーティション表の検査
```

各 env で `pio run` → `pio run -t buildfs`（LittleFS の像）→ `pio run -t flashparts`（`scripts/merge_bin.py`）を行い、
`docs/flash/firmware/<env>/` に **bootloader.bin / partitions.bin / boot_app0.bin / firmware.bin / littlefs.bin** を集めます。
`docs/flash/manifest*.json` は `scripts/make_manifests.py` が、PlatformIO が決めたオフセットから作ります（C3: bootloader 0x0、ESP32: 0x1000、
partitions 0x8000、boot_app0 0xE000、app 0x10000、LittleFS 0x3A0000）。**NVS の領域（0x9000〜0xDFFF）には書かない**ので、再書き込みで Wi-Fi の設定は消えません。
（`-t mergebin` は開発用で、NVS も 0xFF で埋めるので、書き込みページには使いません。）
組み立て手順 `docs/HARDWARE.md` は `scripts/md_to_html.py` が `docs/flash/hardware.html` にします（Pages では .md を開けないため）。

GitHub Pages で公開するとき: リポジトリの Settings → Pages で「Deploy from a branch」、フォルダ `/docs` を選ぶと、
`https://<ユーザー名>.github.io/<リポジトリ名>/flash/` が書き込みページになります。bin を作ってコミットしてから公開してください
（CI の firmware ジョブも同じ bin を作り、成果物 `flash-bins` としてダウンロードできます）。Web Serial は https でしか動かないので、Pages（https）で開きます。

## Wi-Fi の設定（SPEC 9.6）

- 本命は **Improv Serial**: 書き込みページの「Wi-Fi を設定」から、パソコンの USB 経由で設定できます（`src/net/Improv.*`）
- AP の間は、AP 名とパスワードを 10 秒ごとにシリアルに出します（書き込みページの「ログとコンソール」）
- `POST /api/wifi` は、AP のとき（STA ではボタンを短く押してから 60 秒だけ）、`Content-Type: application/json`、同じ Origin のときだけ受け付けます
- AP になったあとも、保存済みの Wi-Fi があれば 1 分ごとにつなぎ直します（クライアント 0 のときだけ）

## 構成

- `src/Sampler.*` 4 回の読取を中央2値の平均で 1 秒に集約、リングバッファ 3600、seq
- `src/CfgModel.*` 設定（rev 付き）と setcfg の検証・部分更新（baseRev が古ければ `stale`、MAX31855 で amp を変えようとしたら `unsupported`）
- `src/net/WsProtocol.*` JSON のエンコードと接続ごとの送信順（hello → bf をすべて → s、SPEC 9.5）
- `src/net/HubCore.*` WsHub の中身（Arduino に依存しない）。接続の出入りは「表」、メッセージは小さなキュー。1 秒ごとに実体の無い枠を片付ける。接続数は自前で数える
- `src/net/WsHub.*` AsyncWebSocket との橋。コールバックでは HubCore に書くだけで、処理は loop() で行う。bf は送信キューが空のときだけ積む
- `src/net/Improv.*` Improv Serial のパケット。`src/net/StaRetry.h` STA つなぎ直しの時機
- `src/net/WebServer.*` `/`（LittleFS の index.html.gz）、`/api/info`、`/wifi`、`/api/scan`、`POST /api/wifi`
- `src/net/WifiManager.*` STA（20 秒）→ AP。mDNS `roast.local`。AP では `roast.local` / `roast` にだけ答える DNS（`DnsReply.*`）
- `src/tc/` ドライバ。`Max31855Decode.h` + `NistK.h`（NIST 多項式で直線近似を補正）、`TcFault.h`（故障コード・MAX31856 のレジスタ値）
- `src/Settings.*` NVS（Preferences）

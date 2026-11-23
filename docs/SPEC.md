# 焙煎記録ノート v2 仕様書（K型熱電対 自動測定化）

- 対象リポジトリ: `roast-log/`
- 現行: `legacy/roastlog-artifact-v1.html`（以下 **v1**。行番号はこのファイルのもの）
- 本書の読者: 実装担当（工兵一番隊=アプリ、二番隊=ファーム、試験小隊）
- 用語: BT=豆温度、ET=排気温度、AMB=外気温、INLET=給気温度、RoR=1分あたりの温度上昇（℃/分）、TP=中点（投入後の最低温度）

---

## 1. 全体構成とリポジトリ

### 1.1 全体構成図

```
  ┌──────── 熱電対 K型 ×1〜3 (非接地型プローブ推奨) ───────┐
  │  CH1(BT)        CH2(ET)        CH3(AMB/INLET)           │
  └────┬───────────────┬───────────────┬────────────────────┘
       │               │               │
  ┌────▼────┐     ┌────▼────┐     ┌────▼────┐   試作: Adafruit MAX31856 ×n
  │ AMP #1  │     │ AMP #2  │     │ AMP #3  │   量産: MAX31855 / MCP9600 候補
  └────┬────┘     └────┬────┘     └────┬────┘
       └──── SPI共有 (SCK/MISO/MOSI) + CS×3 ──┐
                                              │
  ┌───────────────────────────────────────────▼──────────────────────┐
  │ ESP32-C3 (技適済みモジュール)                                    │
  │  TcDriver層 ─ Sampler(4Hz読取→1Hz集約, リングバッファ1h) ─┐      │
  │  NVS設定(チャンネル/補正/Wi-Fi)                            │      │
  │  WiFiManager: STA(家) → 失敗時 AP "RoastLog-XXXX"           │      │
  │  mDNS roast.local / AP時 DNSServer(roast.local→192.168.4.1)│      │
  │  HTTP: / (index.html.gz from LittleFS), /api/*, /wifi, /update     │
  │  WebSocket: /ws  ← 1Hz push / 再接続時バックフィル ◄────────┘      │
  └──────────────────────────┬───────────────────────────────────────┘
                             │ Wi-Fi (インターネット不要)
        ┌────────────────────┼─────────────────────┐
   iPhone Safari        Android Chrome          PC ブラウザ
   └──── app/index.html（単一HTML。保存=その端末の localStorage）
            接続層: [ESP32(WebSocket)] [シミュレーター] [手入力]  (将来: Web Bluetooth / Artisan)
                             │ JSON バックアップ (v2)
                             ▼
   claude.ai アーティファクト（同じ app/index.html を貼る。保存=claude.ai db）
   → 振り返り・味評価。接続は「手入力」「シミュレーター」のみ
```

### 1.2 決定事項
| 項目 | 決定 | 理由 |
|---|---|---|
| firmware | **PlatformIO（Arduino フレームワーク）** | `platformio.ini` でライブラリのバージョンを固定できる。試作ボードと量産ボードを env で切り替えられる。`pio test -e native` でハード無しの単体テストができる。`uploadfs` で LittleFS を書き込める。CI でビルドできる。Arduino IDE は依存の再現性が低く、テストも組めない |
| app | **ビルド不要の単一 HTML（`app/index.html`）** | claude.ai アーティファクトは1ファイルが前提。ESP32 には gzip 1本で載る。Sonnet がそのまま編集できる。ESP32 版と claude.ai 版を**同じファイル**にし、実行環境で自動的に切り替える |
| 共有コード | 純粋関数は `// @core-begin` 〜 `// @core-end` で囲み、`window.RoastCore` に公開する | Node のテストからこの区間を抜き出し、`vm` で評価して検証する |
| tools | Node（ESM）+ Playwright | シミュレーターのサーバ、プロトコル適合試験、E2E を同じ言語で書ける |

### 1.3 ディレクトリ構成
```
roast-log/
├─ README.md
├─ package.json                 # devDeps: @playwright/test, ws ／ scripts: test, test:core, test:e2e, sim, build:fs
├─ .github/workflows/ci.yml     # node test → playwright → pio run (全env) → pio test -e native
├─ docs/
│  ├─ SPEC.md                   # 本書
│  ├─ schema/roast-v2.schema.json   # 記録v2の JSON Schema（試験で使う）
│  ├─ schema/ws-messages.schema.json
│  ├─ HARDWARE.md               # 配線図・部品表・プローブの選び方
│  └─ USER_GUIDE.md             # Wi-Fi接続・画面ロック注意など利用者向け
├─ legacy/roastlog-artifact-v1.html   # 変更禁止（回帰比較用）
├─ app/
│  └─ index.html                # 唯一の正本。ESP32版=claude.ai版
├─ firmware/
│  ├─ platformio.ini            # env: xiao_c3 / esp32c3_devkit / esp32dev / native
│  ├─ include/pins.h            # env ごとのピン定義 (#if defined(BOARD_XIAO_C3) ...)
│  ├─ include/config.h          # 既定値・バージョン FW_VERSION, PROTO_VERSION
│  ├─ src/main.cpp
│  ├─ src/tc/TcDriver.h
│  ├─ src/tc/Max31856Driver.{h,cpp}
│  ├─ src/tc/Max31855Driver.{h,cpp}
│  ├─ src/tc/Mcp9600Driver.{h,cpp}
│  ├─ src/tc/SimTcDriver.{h,cpp}     # 熱電対無しで動作確認する用
│  ├─ src/Sampler.{h,cpp}            # 集約・リングバッファ・seq
│  ├─ src/Settings.{h,cpp}           # NVS(Preferences)
│  ├─ src/net/WifiManager.{h,cpp}
│  ├─ src/net/WebServer.{h,cpp}      # HTTP + /update(OTA)
│  ├─ src/net/WsProtocol.{h,cpp}     # メッセージのエンコード/デコード（native テスト対象）
│  ├─ src/net/wifi_page.h            # /wifi の HTML（PROGMEM。LittleFS が空でも出る）
│  ├─ data/                          # 生成物（gitignore）: index.html.gz
│  ├─ scripts/build_fs.py            # extra_scripts: app/index.html を gzip して data/ へ
│  └─ test/test_sampler/, test/test_proto/, test/test_fault/   # Unity, env:native
└─ tools/
   ├─ sim/roast-model.mjs       # 焙煎曲線モデル（app 内 SimSource と同一コード）
   ├─ sim/server.mjs            # ESP32 互換サーバ（静的配信 + /api/info + /ws）
   ├─ check-sync.mjs            # roast-model.mjs と app 内の @sim-begin/@sim-end 区間が一致するか検査
   ├─ convert/v1-to-v2.mjs      # バックアップ JSON の変換・検証 CLI
   ├─ test/core/*.test.mjs      # node:test（RoastCore の単体テスト）
   ├─ test/proto/conformance.mjs   # 実機 or sim サーバに接続してプロトコル適合を検査
   ├─ test/e2e/*.spec.ts        # Playwright
   └─ fixtures/                 # v1バックアップ実例、v2記録、故障シナリオ、録画セッション
```

---

## 2. WebSocket プロトコル（PROTO_VERSION = 1）

### 2.1 基本
- エンドポイント: `ws://<host>/ws`。host はアプリを配信しているホスト（`location.host`）。
- テキストフレーム 1 枚につき JSON 1 つ。すべてに `"type"` を付ける。
- 温度は **0.1℃ 単位の整数**（例 `1983` は 198.3℃）。欠損は `null`。
- チャンネルは配列で、添字 0..2 = `c1..c3`。無効なチャンネルの値は `null`、故障コードは `0`。
- 時刻はデバイスの起動からの経過ミリ秒 `ms`（uint32）と、通し番号 `seq`（1秒ごとに +1）。`bootId` は起動ごとに乱数 8 桁 16 進。

### 2.2 サンプリング周期
| 層 | 周期 | 内容 |
|---|---|---|
| アンプ読取 | 250ms/ch（4Hz） | MAX31856 は連続変換モードにして最新値を読む |
| 集約 | 1秒 | 有効値 4 個の**中央2値の平均**（有効値が 2〜3 個なら中央値、0 個なら null + 故障コード） |
| 送信・記録 | 1Hz（設定で 2Hz も可。v2 では 1Hz 固定を推奨） | |
| リングバッファ | 3600 サンプル（1時間） | `int16 v[3]` + `uint8 f[3]` + `uint32 ms` = 13B/サンプル、約 47KB |

### 2.3 サーバ→クライアント
```jsonc
// 接続直後（クライアントの hi に対する応答。hi が無くても 1 秒後に送る）
{"type":"hello","proto":1,"fw":"0.3.0","model":"RL-C3-2","amp":"max31856","id":"a4cf12",
 "bootId":"9f31c2aa","ms":912345,"seq":912,"bufFrom":0,"rateHz":1,"chMax":3,"speed":1,
 "cfg":{ /* cfg メッセージと同じ中身 */ }}

// 測定値（1Hz）
{"type":"s","seq":913,"ms":913002,"v":[1983,2107,null],"f":[0,0,0],"cj":254}

// バックフィル（列形式。最大 300 サンプル/フレーム）
{"type":"bf","from":700,"to":912,"lost":false,"ms0":700001,"dt":1000,
 "v":[[1975,1977,...],[2101,...],[null,...]],"f":[[0,...],[0,...],[0,...]]}
// 要求範囲がバッファ外なら lost:true で、残っている最古から送る

// 状態（10秒ごと）
{"type":"st","rssi":-61,"mode":"sta","ip":"192.168.1.42","heap":182344,"uptime":913,"clients":1}

// 設定（hello に含める。変更時は全クライアントへ送る）
{"type":"cfg","channels":[
   {"idx":0,"enabled":true,"role":"bt","name":"豆温度","color":"#C2410C","offset":-0.8},
   {"idx":1,"enabled":true,"role":"et","name":"排気","color":"#7A5AA6","offset":0.0},
   {"idx":2,"enabled":false,"role":"off","name":"","color":"#6B7280","offset":0.0}],
 "amp":{"type":"max31856","mains":50,"avg":4},"rateHz":1}

{"type":"ack","id":"c17","ok":true}
{"type":"ack","id":"c18","ok":false,"err":"bad_channel"}
{"type":"pong","id":"p5","t":1763870000123,"ms":913500}
```
- `v` は**補正値（offset）を足した後**の値です。生の値は `v - offset` で求まります（校正画面で使う）。
- `cj` は冷接点温度（0.1℃）。AMB チャンネルが無いときの外気温の代わりとして参考に表示します。
- `speed` は試験専用です。sim サーバが倍速で動くときに `>1` を送ります。実機は常に 1 です。

### 2.4 クライアント→サーバ
```jsonc
{"type":"hi","app":"roastlog","ver":"2.0.0","bootId":"9f31c2aa","lastSeq":699}   // 接続直後に必ず送る
{"type":"bf_req","from":700,"to":912}            // 任意（通常は hi で自動バックフィルされる）
{"type":"ping","id":"p5","t":1763870000100}      // 5秒ごと
{"type":"setcfg","id":"c17","channels":[...],"amp":{"mains":60,"avg":4}}   // 部分更新可。NVSに保存し cfg を送る
{"type":"identify","id":"c19"}                   // LED を 3 秒点滅（機器の特定用）
```

### 2.5 故障コード（`f`）
| code | 名前 | 表示 | MAX31856（SR 0x0F） | MAX31855 | MCP9600 |
|---|---|---|---|---|---|
| 0 | OK | — | — | — | — |
| 1 | OPEN | 断線 | bit0 OPEN | D0 OC | 非対応（MCP9601 なら対応） |
| 2 | SHORT_GND | GND短絡 | — | D1 SCG | — |
| 3 | SHORT_VCC | VCC短絡 | — | D2 SCV | — |
| 4 | OVUV | 電圧異常 | bit1 OVUV | — | — |
| 5 | TC_RANGE | 範囲外 | bit6 TCRANGE / bit3,2 TCHIGH/LOW | 温度 >1350 / <-200 | 状態レジスタ |
| 6 | CJ_RANGE | 基板温度異常 | bit7 CJRANGE / bit5,4 | 内部温度 >125 | — |
| 7 | NO_DEVICE | センサー未検出 | 読出しが全0/全FF、または CR1 が書き戻せない | 32bit全0/全1 | I2C NACK |
| 8 | STALE | 更新停止 | 連続3回同じ値かつ DRDY 相当の更新なし | — | burst 完了ビットが立たない |

集約の規則: 4 回の読取のうち故障でない値が 1 個以上あれば値を出し、`f=0` とします。0 個なら `v=null` とし、最後の故障コードを入れます。

### 2.6 時刻同期
- アプリ側で `offset = recvEpoch - ms` を**直近 30 個の `s` の最小値**で推定します（片道遅延が最小のものほど真値に近い）。バックフィルで受け取ったサンプルはこの推定に使いません。
- 各サンプルの時刻 `epoch = ms + offset`、焙煎時刻 `t = round((epoch - startedAt)/1000)`。
- `bootId` が変わったら（ESP32 が再起動した）offset を作り直します。再起動前後の時刻差のうちデータの無い区間は `gaps` に記録します。
- ESP32 の水晶の誤差は ±20ppm で、15 分で 0.02 秒なので補正しません。
- `ping`/`pong` は RTT の表示と死活監視にだけ使います。

### 2.7 断線・再接続・欠損補完
| 状況 | アプリの動作 |
|---|---|
| `s` が 3 秒来ない | 状態「受信待ち」（黄）。温度ゲージを薄く表示 |
| 10 秒来ない / `onclose` | 状態「再接続中」（赤）。0.5→1→2→4→5 秒（以後 5 秒ごと）で再接続 |
| 再接続 | `hi{bootId,lastSeq}` を送る → 同じ bootId ならサーバが `bf` を自動送信 → アプリは seq→t に変換して `series` の null を埋める |
| `bf.lost:true` / bootId 変化 | 埋まらない区間を `gaps:[[t0,t1],...]` に追加。グラフは線を切る |
| iOS で裏に回った後 `visibilitychange: visible` | ソケットが死んでいるものとして即座に再接続 → バックフィル |
| 焙煎中の STA 切断（ファーム側） | **焙煎中は AP に切り替えない**。STA を再試行する。30 秒切れたままでクライアント 0 なら AP を併用（AP_STA）にする |

---

## 3. 記録データ形式 v2

### 3.1 方針
- v1 のフィールドは**すべてそのまま**残します（v1 の画面で開いても壊れないようにするため）。
- `schema: 2` を付けます。多チャンネルの時系列は `series` に列形式で、0.1℃ の整数で持ちます。
- v1 互換の `points` は、主チャンネルから **5 秒間隔**で作って同梱します。
- RoR は保存しません（表示時に再計算します。v1 の `toRecord()` 906行は `ror` を保存していますが、v1 の `withRor()` は再計算しているので無くても影響しません）。

### 3.2 例
```json
{
  "schema": 2,
  "id": "rm3x9k2a1b", "beanId": "b...", "beanName": "エチオピア G1", "origin": "エチオピア", "process": "ウォッシュト",
  "greenWeight": 200, "roastedWeight": 170, "degree": "中煎り",
  "roomTemp": 18.4, "weather": null, "interval": 30,
  "initial": {"fire": "中", "damper": "閉", "rpm": "7"},
  "startedAt": 1763870000000, "dropTime": 652,
  "events": [{"type":"tp","t":88,"auto":true},{"type":"dry","t":290},{"type":"fc1","t":512},{"type":"drop","t":652}],
  "changes": [{"t":120,"kind":"fire","value":"強"}],
  "memo": "", "tasting": null, "savedAt": 1763870700000,

  "source": "esp32",
  "device": {"model":"RL-C3-2","fw":"0.3.0","amp":"max31856","id":"a4cf12"},
  "channels": [
    {"key":"c1","role":"bt","name":"豆温度","color":"#C2410C","offset":-0.8},
    {"key":"c2","role":"et","name":"排気","color":"#7A5AA6","offset":0.0}
  ],
  "primary": "c1",
  "series": {"dt":1, "start":-30, "scale":10, "data": {"c1":[1985,1983,"..."], "c2":[2110,"..."]}},
  "gaps": [[301,318]],
  "rorConfig": {"method":"lsq","window":30,"smooth":5},
  "points": [{"t":0,"temp":198.3},{"t":5,"temp":176.2}]
}
```
- `series.data[key][i]` は時刻 `t = start + i*dt` の値（÷`scale` で℃）です。全チャンネルで同じ長さにし、末尾は `dropTime` を含みます。
- `start` は投入前の記録秒数を負で表します。既定は投入前 30 秒（`-30`）です。投入温度は `t=0` の値です。
- `source`: `"esp32" | "sim" | "manual"`。手入力の v2 記録は `series` を持たず、`points` と `channels`（1 本、role `et`）だけを持ちます。
- `rorConfig` は記録したときの設定です。表示時は**現在の設定**で再計算します（v1 と同じ挙動）。

### 3.3 v1 との互換と変換規則（`RoastCore.normalizeRecord(r)`）
内部の表示用モデルは次のとおりです。
`{ channels:[{key,role,name,color}], primary, t:Float64Array|number[], v:{key:number[]|null}, sparse:boolean, gaps }`

| 入力 | 規則 |
|---|---|
| `schema` が無い（v1） | `channels=[{key:'c1',role:'et',name:'排気温度',color:'(--temp)'}]`、`primary='c1'`。`t`/`v` は `points` を時刻順に並べたもの。`sparse=true`、`source='manual'` とみなす |
| `schema:2` かつ `series` あり | `t[i]=start+i*dt`、`v[key][i]=data[key][i]/scale`（null は null）。`sparse=false` |
| `schema:2` かつ `series` なし | v1 と同じ扱い（`channels` があればそれを使う） |
| 未知のフィールド | 保持する（破棄しない） |

書き出し:
- `toRecord()`（v1 900-910行）を v2 化します。`schema:2` を常に付けます。手入力の記録も v2 になりますが、中身は v1 の上位互換です。
- `points` は `RoastCore.toV1Points(norm)` で作ります。主チャンネルについて `0 ≤ t ≤ dropTime` の範囲で、`t%5===0` かつ非 null の値を取り、`temp` は小数1桁にします。手入力の記録は従来どおり全点です。
- バックアップ JSON（1100行）は `version: 2` にします。読み込み（`importJson()` 1056行）は `version` 1/2 の両方を受け付け、各記録に `normalizeRecord` をかけて検証してから保存します。
- v1 アプリに v2 のバックアップを読ませた場合、`roasts` 配列なので受け付けられ、`points` によって ET 1 本として表示されます（劣化はしますが壊れません）。

### 3.4 容量の見積り
| ケース | series | points | メタ | 合計 |
|---|---|---|---|---|
| 1ch・12分・投入前30秒 | 750×5B ≒ 3.8KB | 145×24B ≒ 3.5KB | 2KB | **約 9KB** |
| 2ch・15分 | 930×2×5B ≒ 9.3KB | 4.5KB | 2KB | **約 16KB** |
| 3ch・20分 | 1230×3×5B ≒ 18.5KB | 6KB | 2KB | **約 27KB** |

- localStorage は Safari でおよそ 5MB です。2ch 記録なら約 250 件入ります。使用量が 4MB を超えたら、ホームに「書き出してください」と表示します（`JSON.stringify(cache).length` で概算）。
- draft の保存（`saveDraft()` 708行）は自動測定中は **5 秒ごとにまとめて**行います。イベントや操作の記録時は即座に保存します。

### 3.5 間引き方針
| 保存先 | 方針 |
|---|---|
| 端末 localStorage / JSON バックアップ | 1Hz のまま全部保存 |
| claude.ai db | `JSON.stringify(record).length > 150000` のときだけ `RoastCore.decimate(series, 2)` をかけ、2 秒平均にする（片方が null ならもう片方、両方 null なら null）。`series.decimated=2` を付ける |
| グラフ描画 | 横幅 1px あたり 1 バケットにまとめ、min/max の 2 点を描く（900 点でも描画は 1 回あたり O(幅)） |
| CSV | 1 秒ごとの行（手入力は従来どおり） |

---

## 4. 信号処理（すべて `RoastCore` の純粋関数にする）

### 4.1 処理の流れ（チャンネルごと・1Hz）
```
受信 v(0.1℃) → 故障なら null → [外れ値除去 despike] → 記録(series) ─┬→ 表示値: 3点中央値
                                                                     └→ RoR: 最小二乗傾き(W秒)×60 → EMA(τ秒) → 急変判定
```
外れ値除去の後の値を **series に保存**します。生の値は保存しません。ESP32 側は中央値による集約だけを行い、それ以上は平滑化しません（二重に平滑化しないため）。

### 4.2 外れ値・ノイズ処理 `despike(prev5, x, state)`
- 直近 5 点の中央値 `m` と比べ、`|x - m| > jump`（既定 12℃。1Hz の焙煎で物理的にありえない値）なら**保留**します。
- 保留中の値が同じ方向に **3 点連続**したら本物とみなし採用します（投入直後に BT が急降下するケースへの対応）。保留中は `m` で穴埋めせず `null` にします（グラフは線が切れ、RoR は残りの点で計算します）。
- 0℃未満または 600℃超は即座に null にします。
- 手網では振る動作で ±5〜15℃（0.5〜1Hz）の揺れが出ます。外れ値除去では消えないので、RoR の窓（30/60 秒）と EMA で吸収します（手網の既定窓は 60 秒）。

### 4.3 RoR（推奨: 最小二乗の傾き）
- `rorLsq(t[], v[], i, W)`: 区間 `[t_i - W, t_i]` の非 null 点で単回帰の傾きを求め、×60 します。有効点が `W/2` 個未満なら null を返します。
- 平滑化: `ror_s = ror_s + α(ror - ror_s)`、`α = 1 - exp(-dt/τ)`、既定 τ = 5 秒。
- 既定値: ドラムは W = 30 秒、手網は W = 60 秒。設定の選択肢は 15/30/60 です。遅れはおよそ W/2 + τ（30 秒窓なら約 20 秒）です。
- 計算方法の切り替え: `source==='manual'`（間隔の空いた手入力）は **v1 の補間方式を維持**します（`withRor()` 413-428行のロジックをそのまま `RoastCore.rorInterp` に移します）。これで v1 の記録の RoR 表示値は変わりません。
- 性能: 焙煎中は**差分計算**にします（新しい 1 点が来たらその点の RoR だけを計算し、配列に追加）。`updateGauges()`（740行）と `drawLive()`（759行）はキャッシュ `S.live.ror` を読むだけにします。現状の `withRor` は毎回全点をソートし、`tempAtTime` を線形探索するので O(n²) です。1Hz で 900 点・250ms ごとに呼ぶと端末が重くなるため、**必ず作り直します**。
- RoR を計算するのは主チャンネルです。設定「ET の RoR も表示」がオンなら ET も計算します。

### 4.4 急上昇・急降下の判定（`withRor()` 429-441行を作り直す）
v1 は「隣の点との RoR の差」で判定しています。1Hz にするとノイズで常に反応してしまうため、作り直します。
- 判定の対象期間: TP が確定してから、平滑化した RoR がピーク（TP+30 秒以降の最大値）より 1℃/分以上下がった後。v1 の「ピークを過ぎてから」の意図を引き継ぎます。
- `ΔRoR(t) = ror_s(t) - ror_s(t-30)`（30 秒前との差。v1 の 30 秒間隔の入力と同じ意味になるので、設定値 `flick`/`crash` は既定 3/4 のまま互換になります）。
- 判定にヒステリシスを入れます。`ΔRoR ≥ flick` が **3 秒続いたら** flick、`ΔRoR ≤ -crash` が 3 秒続いたら crash にします。条件が外れて 5 秒たったら解除します。
- 出力は `flags: Array<null|'flick'|'crash'>`。ゲージの色（98行の `.gauge.ror.flick`）と注記（751行）はそのまま流用します。グラフ上の印は区間の帯で表示します（点ごとの丸印 605行は手入力の記録だけにします）。
- 判定が始まるたび（初回のみ）に `beep()` を 1 回鳴らします（設定でオフにできます）。

### 4.5 投入の自動検知 `detectCharge(buf, mode)`
状態が `ready`（焙煎画面で投入前）のときだけ動かします。`buf` は投入前リングバッファ（直近 180 秒、メモリ上）です。対象は主チャンネルで、BT が無ければ ET です。

| mode | 条件（すべて 1Hz の外れ値除去後） | 投入時刻 |
|---|---|---|
| `drum`（ドラム・既定） | 直近 30 秒の最大値が 120℃以上（予熱済み）、かつ 10 秒以内に 15℃以上下がる、かつ傾き < -1.5℃/秒が 3 秒続く | 下がり始める直前の局所最大の時刻 |
| `tenami`（手網） | 待機中の基準値 = 直近 30 秒の中央値。現在値 > 基準値 + 15℃、かつ 5 秒の回帰傾き > +0.8℃/秒が 5 秒続く | 傾きが初めて +0.3℃/秒を超えた時刻 |

検知したら `charge()` を**さかのぼって**実行し（`startedAt = 検知サンプルの epoch`）、トースト「投入を検知しました（0:12 前）[取り消す]」を出します。取り消すと `status='ready'` に戻ります（undo の種類に `autoCharge` を追加）。設定 `autoCharge`（既定オン）で切り替えます。

### 4.6 中点の自動検出 `detectTP`（`stats()` 452-453行の全体最小値方式を置き換える）
- 投入から 20 秒以降、平滑化した主チャンネル温度の最小値 `m` を追跡します。
- 確定条件: 現在値 ≥ `m + 2℃` かつ `ror_s > 0` が 10 秒続く。そのときの最小時刻を TP とし、`events` に `{type:'tp',t,auto:true}` を追加します（手動の tp があれば何もしません。後から手動で押したら上書きします）。
- 投入後に 5℃以上下がらなかった場合（手網に多い）は TP を「なし」にします。
- 表示は `statTiles()` 873行の「中点（推定）」をそのまま使い、`auto:true` のときに付けます。

### 4.7 排出検知（補助・フェーズ A3 以降）
1ハゼ後に、BT が 10 秒で 20℃以上下がったら「排出しましたか？ [排出として記録]」というシートを出すだけにします（自動で終了はしません）。設定 `autoDropHint` で切り替えます。

### 4.8 焙煎段階の表示（自動測定時。カウントダウン 236行の代わり）
`乾燥 0→dry ｜ メイラード dry→fc1 ｜ 発達 fc1→今` の 3 区間の帯と、発達比率（DTR）をリアルタイムで出します。

---

## 5. 画面ごとの変更点

### 5.0 共通（土台）
- `DEFAULTS`（381-387行）に以下を追加します。v1 の設定は `{...DEFAULTS, ...saved}`（1136行）で自然に引き継がれます。
```js
conn: { type: 'auto', host: '' },          // auto: ESP32 から配信されていれば esp32、https なら manual
channels: [
  { key:'c1', enabled:true,  role:'bt',  name:'豆温度', color:'#C2410C', offset:0 },
  { key:'c2', enabled:false, role:'et',  name:'排気',   color:'#7A5AA6', offset:0 },
  { key:'c3', enabled:false, role:'amb', name:'外気温', color:'#6B7280', offset:0 } ],
roasterType: 'drum',            // 'drum' | 'tenami'
rorWindowAuto: 30, rorSmooth: 5, showEtRor: false,   // 既存の rorWindow(60) は手入力用にそのまま残す
autoCharge: true, autoTP: true, autoDropHint: true, flagBeep: true,
mains: 50, ampAvg: 4,
sim: { speed: 1, profile: 'drum', seed: 1, noise: 0.3 },
```
- **接続層** `Sources`（新規）。すべて同じインターフェースにします。
```js
// source.id: 'esp32'|'sim'|'manual'
// source.caps: { live, backfill, configurable, channels }
// source.connect(opts): Promise<void>
// source.disconnect()
// source.on('status', ({state:'idle'|'connecting'|'live'|'stale'|'down', detail}) => …)
// source.on('sample', ({seq, epoch, v:[℃|null...], f:[...], cj, backfill:boolean}) => …)
// source.on('config', cfg => …)
// source.setConfig(partial): Promise<ack>
// source.now(): number   // 焙煎時計の元（epoch ms）。手入力は Date.now()
```
  `Esp32WsSource` / `SimSource`（ページ内でモデルを回す。速度 ×1/×5/×20）/ `ManualSource`。`elapsed()`（707行）は `(Sources.active.now() - startedAt)/1000` にします（倍速シミュレーターと実機の時刻をサンプルと揃えるため）。
- **Store**（460-523行）: `init()` に判定を加えます。`location.protocol==='http:'` かつ `fetch('/api/info')` が成功したら ESP32 から配信されていると判断し、`S.device = info` とします（保存先は local のまま）。`renderHome()` のチップ（641行）は「ESP32 接続中・この端末に保存」などにします。
- **Wake Lock**: `requestWake()`（776-778行）は http では使えません。代わりに無音の小さな動画をループ再生する方式（NoSleep 方式）を `charge()` の操作の中で開始します。さらに焙煎画面の上に「画面の自動ロックをオフにしてください（iPhone: 設定>画面表示と明るさ>自動ロック）」を、初回と Wake Lock 不可の時に出します。
- **書き出し**: `offerFile()`（1025-1033行）で、claude.ai の downloads が無い場合は `Blob` + `<a download>` を試し、駄目ならテキストエリアに出します。`navigator.clipboard` も http では使えないので、1101行の代替処理（選択してコピー）がそのまま生きます。
- **フォント**: 6行の Google Fonts は `media="print" onload="this.media='all'"` で読み込みを止めない形にします（オフライン AP でも表示が遅れないように）。
- **グラフ** `drawChart()`（557-615行）を多系列にします。入力を `normalizeRecord` の結果にし、`channels` の色で描きます。AMB は線を描かず凡例に数値だけ出します。y 軸の範囲は表示中のチャンネル全体で計算します。点の丸印（605, 610行）は `sparse` のときだけ描きます。`gaps` の区間は線を切ります。`opts.preview=true` のときは投入前用に、t = -120..0（現在時刻基準）の横軸で描きます。凡例（239, 276行の固定 HTML）はチャンネルから動的に作り、タップで表示・非表示を切り替えます。
- `sparkline()`（630-636行）は主チャンネルの 10 秒間隔の値から描きます。

### 5.1 ホーム（`renderHome()` 639-662行）
- モードチップに接続の状態を出します（`ESP32 roast.local 接続中` / `シミュレーター` / `手入力`）。
- 再開バナー（645行）の「温度 n 件」は、自動測定なら「経過 m:ss・2ch」にします。
- 履歴の項目にタグ「自動 2ch」を追加します（`r.source==='esp32'`）。
- origin が IP アドレス（`/^\d+\.\d+\.\d+\.\d+/`）なら、「アドレスが違うと記録は別々に保存されます。普段は http://roast.local を使ってください」と一度だけ案内します。
- localStorage が 4MB を超えたら書き出しを促すバナーを出します。

### 5.2 焙煎の準備（`renderSetup()` 667-680行 / `startSetup()` 683-703行）
- 「測定」パネルを新たに作ります。接続方式（ESP32 / シミュレーター / 手入力）、接続状態、**チャンネルごとの現在温度と故障バッジ**の表示です（`role!=='off'` のチャンネル）。
- 「温度入力のお知らせ間隔」（211-213行）は手入力のときだけ表示します。
- 室温（218行）は AMB チャンネルがあれば現在値を自動で入れます（編集可）。
- `startSetup()` が作る draft に以下を追加します。
  `source, channels(設定のスナップショット, enabledのみ), primary, series:{dt:1,start:-30,scale:10,data:{}}, gaps:[], live:{bootId,lastSeq}`。

### 5.3 焙煎中（`renderRoast()` 710-718行 ほか）
| 箇所 | 変更 |
|---|---|
| ゲージ（231-235行 / `updateGauges()` 740-758行） | 1 段目は「経過・主チャンネル温度・RoR」のまま。2 段目に他チャンネルのチップ（色付きの名前と値）を追加。故障時は値の代わりに「断線」などを赤で表示。ラベル「排気温度」（233行）は主チャンネル名にする |
| 接続状態 | ゲージの上に `● 受信中` / `▲ 受信待ち` / `✕ 再接続中…` の行を出す |
| カウントダウン（236行 / `startTick()` 763-774行） | 手入力のときは現状のまま。自動のときは段階の帯（4.8）に置き換え、`alertInput()` は呼ばない |
| テンキー（241-247行 / `onKey` 801 / `recordTemp` 810-820行） | 自動のときは非表示。キーボード操作（1119-1124行）は Enter=投入だけ残す |
| 投入エリア（248行 / `charge()` 831-837行） | 自動のときの文言は「投入を自動で検知します（待機中）。手動で押してもOK」。待機中はプレビューグラフ（直近 2 分）を出す。`charge()` は `t0Epoch` 引数でさかのぼりに対応し、プレバッファから `t≥-30` の分を series に移す。0:00 の温度入力（813, 833行）は手入力専用にする |
| イベント（`renderEvents` 723 / `markEvent` 838-852行） | 時刻は `elapsed()`（source の時計基準）。自動の tp は「中点（自動）」で表示し、ボタンを押すと上書き。排出の後はサンプルの受信を止め、series の末尾を `dropTime` までにする |
| 操作記録（`renderControls` 730 / `changeCtrl` 853行） | 変更なし。シミュレーターのときは fire/damper の変更をモデルに渡す |
| undo（821-830行） | 種類 `autoCharge` を追加（投入前に戻る）。自動 tp の取り消しにも対応 |
| サンプル受信 | 新関数 `onSample(s)`。t を計算 → `despike` → `series.data[key][t-start] = round(v*10)` → RoR を差分更新 → `detectTP` / 急変判定 → `updateGauges()`。投入前はプレバッファに入れ、`detectCharge` を呼ぶ |
| 故障の通知 | 焙煎中に OK から故障に変わったら、`beep()` とトースト「CH2 排気: 断線」 |

### 5.4 焙煎おつかれさま（`renderFinish()` 878-885行 / `statTiles()` 864-877行 / `toRecord()` 900-910行）
- `statTiles` は `normalizeRecord` を使います。投入温度は主チャンネルの t=0 の値、排出時温度は `dropTime` の値です（v1 の 455行「最後の点」から変えます）。
- 自動の記録ではタイルを 4 つ追加します: **中点温度・最大RoR（TP以降）・1ハゼ時温度・乾燥/メイラード時間**。手入力の記録は従来の 8 枚のままです。
- `toRecord()` は 3.2 の v2 形式を出します（`points` は `toV1Points` で作る）。`saveFinish()`（890行）で、`Store.mode==='cloud'` かつ 150KB を超える場合だけ `decimate` します。

### 5.5 記録詳細（`renderDetail()` 914-941行）
- グラフは多系列にし、凡例タップで切り替えます。フェーズ A3 で、タッチ位置の値を読むカーソル（縦線と各チャンネルの値）を追加します。
- タイムライン（924-929行）の `tempAt`（942行）は「BT 152.3 / ET 201.1」のように全チャンネルを表示します。
- 修正欄: 温度表（939行）は**手入力の記録だけ**表示します。自動の記録は「温度データは自動測定（n 点）」の表示と**チャンネル別の補正値の後付け**（`series` 全体に Δ を足す）にします。イベント編集（940行）と `saveEdit()`（951-969行）のイベント部分は共通です。`saveEdit` の温度の作り直し（955-957行）は `sparse` のときだけ行います。
- `csvOne()`（1037-1047行）は列を `時間, 秒, <各チャンネル名>(℃), RoR(主), イベント, 設定変更` にし、1 秒ごとの行にします。
- 味の評価（931-934, 943-950行）は変更しません。claude.ai 版での主な使い道です。

### 5.6 豆の管理（978-1002行）
変更しません。

### 5.7 設定・バックアップ（`renderSettings()` 1006-1016行 / `saveSettings()` 1018-1024行、HTML 325-362行）
パネルの順番:
1. **接続**: 方式（自動/ESP32/シミュレーター/手入力）、ESP32 のアドレス（既定は配信元。https のときは「claude.ai 版では ESP32 に接続できません」と出して選択肢を隠す）、状態、ファーム版、RSSI。シミュレーターの場合は速度・プロファイル（ドラム/手網）・ノイズ・故障を起こすボタン。
2. **温度センサー（チャンネル）× 3**: 使う/使わない、役割（豆温度BT / 排気ET / 外気温AMB / 給気 / 未使用）、名前、色（`<input type=color>`）、補正値（±℃、0.1 刻み）、現在値。主チャンネルの選び方は自動（BT→ET→最初の有効チャンネル）。ESP32 接続時は保存で `setcfg` を送り、ESP32 の NVS を正本にします（`cfg` を受け取ったら `S.settings.channels` を更新）。
3. **校正**: チャンネルを選ぶ → 基準を選ぶ（氷水 0℃ / 沸騰水 `100 - 0.0033×標高m`（標高を入力）/ 基準温度計の値を入力）→「測定」で 10 秒間の生の値（`v - offset`）を集める → 標準偏差 < 0.2℃ を確認 → `offset = 基準 - 平均` → 保存。
4. **自動検知**: 焙煎機の種類（ドラム/手網。RoR 窓と投入検知方式の既定値が変わる）、投入の自動検知、中点の自動検出、排出の案内。
5. **RoR**: 計算幅（手入力 30/60 = 既存の `#sRorWindow` 336行、自動 15/30/60）、なめらかさ（τ 0/5/10 秒）、ET の RoR も表示、急上昇/急降下（既存 340-341行。説明を「30秒前の RoR との差」に変更）、急変時に音を鳴らす。
6. **焙煎機の段階**（既存 327-332行）: 変更しません。
7. **機器**（ESP32 から配信されているときだけ表示）: 電源周波数 50/60Hz（東日本 50 / 西日本 60）、平均化回数、「Wi-Fi 設定を開く」（`/wifi` へのリンク）、「ファームウェア更新」（`/update` へのリンク）、「機器を光らせる」（identify）。
8. **バックアップ**（既存 348-361行）: 書き出しは version 2。読み込みは v1/v2 対応。

---

## 6. ファームウェア仕様

### 6.1 ボードとピン割り当て（`include/pins.h`）
推奨する試作機は **Seeed XIAO ESP32C3**（技適取得済み、小型、USB-C、量産の小ロットにもそのまま使える）。手持ちの ESP32 DevKit 用の env も用意します。

| 信号 | XIAO ESP32C3 (`env:xiao_c3`) | ESP32-C3-DevKitM-1 (`env:esp32c3_devkit`) | ESP32 DevKitC (`env:esp32dev`) |
|---|---|---|---|
| SCK | D8 / GPIO8 | GPIO4 | GPIO18 |
| MISO (SDO) | D9 / GPIO9 | GPIO5 | GPIO19 |
| MOSI (SDI) | D10 / GPIO10 | GPIO6 | GPIO23 |
| CS1 | D1 / GPIO3 | GPIO7 | GPIO5 |
| CS2 | D2 / GPIO4 | GPIO10 | GPIO17 |
| CS3 | D3 / GPIO5 | GPIO3 | GPIO16 |
| 状態 LED | D4 / GPIO6（外付け、330Ω） | GPIO8（基板の RGB は使わず外付け推奨） | GPIO2 |
| ボタン（Wi-Fi リセット） | D5 / GPIO7（外付け、内部プルアップ、GND に落とす） | GPIO9 (BOOT) | GPIO0 (BOOT) |
| (MCP9600 用) SDA/SCL | D4/D5 は LED/ボタンと共用不可 → MCP9600 版は LED=D6/GPIO21・ボタン=D7/GPIO20 | GPIO8/GPIO9 | GPIO21/22 |

- XIAO の BOOT ボタンは GPIO9（MISO）と共用です。**動作中に押すと読み取りが壊れる**ので、ボタンは外付けにします。
- GPIO2/8/9 は C3 の起動モードを決めるピン（ストラッピング）です。CS には使いません。
- `setup()` で **全 CS を先に OUTPUT HIGH にしてから** `SPI.begin()` します（起動時のバス衝突を防ぐため）。
- DRDY/FAULT ピンは使いません（レジスタをポーリングで読む）。

### 6.2 ドライバ層
```cpp
// src/tc/TcDriver.h
enum TcFault : uint8_t { TC_OK=0, TC_OPEN=1, TC_SHORT_GND=2, TC_SHORT_VCC=3, TC_OVUV=4,
                         TC_RANGE=5, TC_CJ_RANGE=6, TC_NO_DEVICE=7, TC_STALE=8 };
struct TcReading { float tempC; float cjC; uint8_t fault; };
struct TcConfig  { uint8_t mains; /*50|60*/ uint8_t avg; /*1,2,4,8,16*/ };
class TcDriver {
public:
  virtual ~TcDriver() {}
  virtual bool begin() = 0;                    // 検出できなければ false（以後 fault=NO_DEVICE）
  virtual void configure(const TcConfig&) = 0;
  virtual bool read(TcReading& out) = 0;       // 250ms ごとに呼ぶ。新しい値なら true
  virtual const char* name() const = 0;        // "max31856" など（hello.amp）
};
TcDriver* makeDriver(uint8_t idx);  // ビルドフラグ -DTC_DRIVER_MAX31856 / _MAX31855 / _MCP9600 / _SIM で選択
```
- **Max31856Driver**（Adafruit_MAX31856 ライブラリ、`Adafruit_MAX31856(cs, &SPI)`）
  - `setThermocoupleType(MAX31856_TCTYPE_K)`、`setConversionMode(MAX31856_CONTINUOUS)`。
  - `setNoiseFilter(mains==50 ? MAX31856_NOISE_FILTER_50HZ : MAX31856_NOISE_FILTER_60HZ)`（CR0 bit0）。
  - 平均化: CR1(0x01) の bit6:4 AVGSEL（000=1, 001=2, **010=4（既定）**, 011=8, 100=16）。bit3:0 は TC 種別 K=0011 のまま。ライブラリに API が無ければ、レジスタを直接読んで書き換えて読み戻し、検証します。
  - 断線検出: CR0 の OCFAULT=01（プローブの抵抗 < 5kΩ 用）。
  - 故障: `readFault()` を 2.5 の表のとおりに対応付けます。値の読み出しは `readThermocoupleTemperature()`（連続モードなら待ち時間なし）。
  - 3 枚とも独立に連続変換するので並行に動きます。読み取りは 250ms ごと（平均 4 回 + 50Hz フィルタの変換周期に対して十分な余裕があります。実機で更新間隔を測り、`STALE` の閾値を決めます）。
- **Max31855Driver**: 32bit を読み、bit16 = fault、D0/D1/D2 = OC/SCG/SCV。温度は bit31:18 ×0.25。MAX31855 は直線近似なので、**NIST の K 型多項式で補正**します（測定値を µV に戻し、冷接点分を足して逆変換する）。フィルタと平均化の設定は無いので `configure` は何もしません。
- **Mcp9600Driver**: Adafruit_MCP9600、I2C アドレス 0x60〜0x67。`setADCresolution(MCP9600_ADCRESOLUTION_18)`、`setFilterCoefficient(3)`、K 型。断線検出はできません（MCP9601 なら可）。
- **SimTcDriver**: 内部時計から 20〜230℃ をゆっくり往復する値にノイズを足して返します。`identify` コマンドで疑似的な断線を起こせます。熱電対無しで ESP32 単体の動作確認と OTA 試験に使います。

### 6.3 SPI 共有
- MAX31856 は SPI モード 1、MAX31855 はモード 0。どちらも最大 5MHz です。ドライバは**毎回 `SPI.beginTransaction(SPISettings(1000000, MSBFIRST, mode))`** で始めます（Adafruit_SPIDevice が内部でそうしているので、混在しても問題ありません）。
- SPI は `loop()` の中だけで触ります。WebSocket のコールバック（AsyncTCP のタスク）からは SPI に触らず、キューやフラグで受け渡します。
- クロックは 1MHz に抑えます（配線 10cm 程度、ノイズ耐性を優先）。

### 6.4 Sampler
- 250ms ごと: 全チャンネルを `read()` して 4 個のスロットに入れます。
- 1000ms ごと: 2.2 の規則で集約し、offset を足して 0.1℃ 整数にします。`seq++` してリングバッファ（3600）に入れ、WS で全クライアントに `s` を送ります。
- `bootId = esp_random()` を 16 進 8 桁にします。

### 6.5 Wi-Fi・HTTP
- 起動: NVS の STA 情報があれば 20 秒間接続を試みます。成功したら STA、mDNS は `roast`（変更可）で `_http._tcp` を広告します。失敗したら AP にします。
- AP: SSID `RoastLog-XXXX`（MAC の下位 4 桁）、WPA2、既定パスワードは機器ごとに作る 8 桁（ラベルに印刷。NVS に保存）、IP 192.168.4.1。
  `DNSServer` は **`roast.local` と `roast` にだけ** 192.168.4.1 を返し、それ以外はエラーを返します（全ドメインに応答すると iOS のキャプティブポータル用ミニブラウザが開き、localStorage が保持されないため）。
- 焙煎中の扱いは 2.7 のとおりです（AP_STA を併用する）。
- ボタン 5 秒長押しで STA 情報を消して再起動します（AP で起動）。
- LED: 速い点滅 = STA 接続中、ゆっくり点滅 = AP、点灯 = STA 接続済み、2 回点滅の繰り返し = 熱電対の故障あり、identify = 3 秒高速点滅。
- HTTP エンドポイント（ESPAsyncWebServer）:
  - `GET /` → LittleFS の `/index.html.gz`（`Content-Encoding: gzip`、`Cache-Control: no-cache`、`ETag: <FW_BUILD>-<fs hash>`）。ファイルが無ければ `/wifi` へ。
  - `GET /api/info` → `{proto, fw, model, amp, id, bootId, mode, ip, host}`
  - `GET /wifi`（PROGMEM の HTML）、`GET /api/scan`、`POST /api/wifi {ssid, pass, apPass?, host?}` → 保存して再起動。
  - `GET /update`（PROGMEM の HTML）、`POST /update?target=fw|fs`（multipart。フォームに機器パスワードが必須）。
  - `WS /ws`（最大 4 クライアント）。
- パーティション: `board_build.partitions = default.csv`（app 1.25MB×2 で OTA 可、LittleFS 約 1.4MB）、`board_build.filesystem = littlefs`。
- OTA: **可**。HTTP アップロード方式で、`Update.h` を使い、ロールバックを有効にします。起動して WS サーバが立ち上がったら `esp_ota_mark_app_valid_cancel_rollback()` を呼びます。アプリ（LittleFS）も同じ画面から更新できます。インターネット経由の自動更新はやりません（将来課題）。

### 6.6 ライブラリ（`platformio.ini` で固定する）
`mathieucarbou/ESPAsyncWebServer`（+ AsyncTCP）、`bblanchon/ArduinoJson@^7`、`adafruit/Adafruit MAX31856 library`、`adafruit/Adafruit MAX31855 library`、`adafruit/Adafruit MCP9600 Library`。標準で入るもの: `ESPmDNS`、`DNSServer`、`Preferences`、`LittleFS`、`Update`。`env:native` は Unity で、`Sampler` と `WsProtocol` と故障の対応付けだけをビルドします（Arduino 依存はインターフェースで切り離す）。

### 6.7 NVS のキー
`wifi.ssid, wifi.pass, ap.pass, host, mains, avg, ch{0..2}.en/role/name/color/off`

---

## 7. テスト計画

### 7.1 ハード無しで検証する方法
| 層 | 方法 | 担当 |
|---|---|---|
| 信号処理 | `tools/test/core/*.test.mjs`（node:test）。`app/index.html` の `@core` 区間を `vm` で評価して `RoastCore` を得る | 試験小隊 |
| アプリと ESP32 の結合 | `tools/sim/server.mjs` が実機と同じプロトコルを話す。Playwright で `http://localhost:8787/` を開くと「ESP32 から配信されている」状態を再現できる | 試験小隊 + 一番隊 |
| プロトコル適合 | `tools/test/proto/conformance.mjs --url ws://localhost:8787/ws` と `--url ws://roast.local/ws`。**同じ試験を sim と実機の両方に通す** | 試験小隊 + 二番隊 |
| ファーム単体 | `pio test -e native`（集約、リングバッファ、バックフィルの範囲計算、故障の対応付け、JSON のエンコード） | 二番隊 |
| ファームの結合（熱電対なし） | `-DTC_DRIVER_SIM` で ESP32 単体を動かし、適合試験・OTA・Wi-Fi 切り替えを確認 | 二番隊 |
| claude.ai 環境 | Playwright で `window.claude` のモック（`use('db')` が collection/doc の get/set/delete を返す）を注入して Store の cloud 経路を試す。https での ESP32 選択肢の非表示も確認 | 試験小隊 |

### 7.2 シミュレーターの焙煎曲線モデル（`roast-model.mjs`。アプリの `@sim` 区間と同一コード）
- 乱数は seed 付き（mulberry32）。1 秒刻みで、状態は豆の温度 Tb、プローブの温度 Tp、空気の温度 Ta。
- 熱源: `Ta_target = 150 + 45*fireLevel(0..2) - 15*damperLevel(0..4 を 0..1 に正規化)`、`dTa/dt = (Ta_target - Ta)/40`。
- 豆: `dTb/dt = h*(Ta - Tb) + exo(Tb)`。h = 0.012。`exo` は 195〜205℃で +0.08℃/秒（1ハゼの発熱）、1ハゼ直後 30 秒は -0.05℃/秒（水分の放出。RoR の急降下を再現）。
- プローブ（BT）: `dTp/dt = (0.8*Tb + 0.2*Ta - Tp)/τp`、τp = 8 秒。投入前は Tp = 予熱温度 200℃、Tb = 室温 20℃ → **TP が自然に出る**。
- ET = Ta + 5、AMB = 室温 + 小さな揺れ。
- 手網プロファイル: 投入前の Tp は室温。Ta に振る動作の揺れ `A*sin(2π*0.7t)`（A = 8℃）を足す。予熱はしない。
- ノイズ: ガウス σ = 0.3℃。外れ値は確率 1/300 で +40℃。故障を注入: 指定区間で `f=1`, `v=null`。
- 真値: `truth = {chargeT, tpT, fc1T}` を `/api/sim/truth` で出す（試験の照合用）。
- sim サーバの CLI: `--speed 20 --profile drum|tenami --seed 1 --charge-at 40 --disconnect 300:20 --fault c2:open@400-420 --reboot-at 500`。

### 7.3 単体テスト（主なもの）
- `rorLsq`: 傾き 10℃/分の直線に σ = 0.3 のノイズを足したとき、窓 30 秒で |誤差| < 0.5℃/分、遅れ ≤ 窓/2 + 1 秒。
- `rorInterp`: v1 の fixtures で `legacy` の `withRor` の出力と完全に一致（`legacy` から `withRor` を抜き出して比較）。
- `despike`: 単発の +40℃ は除去、BT が実際に 100℃下がる場合は 3 秒以内に追従、600℃超は null。
- `detectCharge`: drum/tenami の sim で真値 ±3 秒。待機中に揺らしても誤検知しない（10 シードで誤検知 0）。
- `detectTP`: 真値 ±3 秒。手網では TP なし。
- 急変判定: 1ハゼ直後の急降下で crash。定常的な下降では判定ゼロ。
- `normalizeRecord` / `toV1Points` / `decimate`: 往復で値が保たれる。JSON Schema で検証。
- 容量: 3ch・20 分の記録が 35KB 以下。

### 7.4 E2E（Playwright。プロジェクトは iPhone 13(WebKit) / Pixel 7(Chromium) / Desktop Chrome）
1. **回帰**: `legacy` と `app` の両方で、v1 の fixtures を読み込んで詳細画面のスクリーンショットを比較（許容差 1%）。手入力の焙煎を最後まで通す。
2. **sim の焙煎（ページ内）**: `page.clock` で早送りし、自動投入 → 自動 TP → 1ハゼ/排出のボタン → 保存。保存された記録を schema で検証。
3. **ESP32 経路**: sim サーバを `--speed 20` で起動。接続、2ch 表示、`--disconnect 300:20` の後に**欠損 0**（バックフィルされている）、`--reboot-at` で gaps が記録される、故障の注入で「断線」が表示されて音が鳴る。
4. **設定**: チャンネルの役割と補正を変えると `setcfg` が送られ、sim サーバが `cfg` を返して画面に反映される。校正の流れ。
5. **claude.ai モック**: v2 の記録を読み込んで表示し、評価を保存。150KB を超える記録が間引かれて保存される。
6. **サイズ予算**: `app/index.html` を gzip して 60KB 以下。

### 7.5 実地試験（試験小隊。チェックリストを `docs/USER_GUIDE.md` の付録にする）
- 基準温度計と比べる（氷水・沸騰水・オーブン 200℃）。補正後に ±1℃。
- 2ch で実際に焙煎を 3 回（ドラム 1、手網 2）。自動投入・自動 TP の当否を記録。
- iPhone 実機: 自動ロックをオンにして 5 分放置 → 復帰で欠損が補完される。Safari を裏に回して戻る。
- Android: 「インターネット接続なし」の Wi-Fi で通信が維持されるか。モバイルデータへの自動切り替えの影響。
- 30 分の連続運転、AP/STA の切り替え、OTA の往復とロールバック。

---

## 8. 実装フェーズと完了条件

依存関係: P0 → (A1 ‖ F1) → (A2 ‖ F2) → A3（F2 の適合試験が通った sim サーバを使う）→ A4 / F3 → 実地試験

### P0 土台（試験小隊が先に行う）
- 作業: ディレクトリ構成、`package.json`、CI、`docs/schema/*.json`、`tools/fixtures/`（v1 のバックアップ実例 3 本と手書きの v2 記録 3 本）、`tools/sim/roast-model.mjs`、sim サーバの骨組み（hello と s だけ）。
- 完了条件: `npm test` と `pio run` の空ビルドが CI で通る。

### 工兵一番隊（アプリ）
**A1 v2 データ基盤（claude.ai 互換の改修を含む）**
- `legacy` を `app/index.html` にコピー。`@core` 区間を作り、`withRor` / `stats` / `evTime` を移し、`normalizeRecord` / `toV1Points` / `decimate` / `validate` を追加。
- `drawChart` / `sparkline` / `statTiles` / `renderDetail` / `csvOne` / `csvAll` / `importJson` / `toRecord` / エクスポート（1100行）を v2 に対応。`offerFile` に Blob 方式を追加。フォントの読み込みを止めない形にする。
- 完了条件: E2E-1（回帰）が通る。v2 の fixtures が詳細画面に多チャンネルで出る。`version:2` の書き出しを v1 アプリで読んでも壊れない。core の単体テスト（normalize 系）が通る。

**A2 接続層・シミュレーター・自動測定の焙煎画面**
- `Sources`（Manual / Sim）、`elapsed()` の時計の付け替え、`onSample`、despike / rorLsq / 急変判定 / detectCharge / detectTP の差分計算、焙煎画面（5.3）、終了画面（5.4）、Wake Lock の代替。
- 完了条件: E2E-2 と 7.3 の単体テストがすべて通る。焙煎中の `updateGauges` 1 回が 2ms 未満（Pixel 7 の CPU 4 倍遅延の条件で 900 点時）。

**A3 ESP32 接続と設定画面**
- `Esp32WsSource`（再接続、バックフィル、時刻同期、故障）、設定画面（5.7 の 1〜5, 7）、校正、凡例の切り替え、読み取りカーソル、補正の後付け、排出の案内。
- 完了条件: E2E-3 と E2E-4 が通る。

**A4 claude.ai 版の仕上げ**
- https のときの ESP32 選択肢の非表示、db 保存時の間引き、実際の claude.ai アーティファクトに貼っての動作確認。
- 完了条件: E2E-5 が通る。手動の確認表（読み込み・表示・評価の保存・再読み込み後の保持）がすべて OK。

### 工兵二番隊（ファーム）
**F1 計測の核**
- PlatformIO の env 一式、`pins.h`、`TcDriver` と Max31856 / Sim、`Sampler`、シリアルに 1Hz の JSON を出力。
- 完了条件: 試作機で室温と指で温めた変化が読める。熱電対を外すと 1 秒以内に `f=1`。50/60Hz と平均化の設定がレジスタを読み戻して確認できる。`pio test -e native` が通る。

**F2 ネットワーク**
- WifiManager（STA → AP、mDNS、DNSServer）、HTTP（gz 配信、`/api/info`、`/wifi`）、WS プロトコル全部（hello/s/bf/st/cfg/ack/pong、hi/bf_req/ping/setcfg/identify）、`build_fs.py`。
- 完了条件: `conformance.mjs` が実機（Sim ドライバ）と sim サーバの両方で通る。iPhone と Android から `http://roast.local` と `http://192.168.4.1` でアプリが動く。

**F3 運用機能**
- NVS 設定の保存、OTA（fw/fs、パスワード、ロールバック）、LED/ボタン、Max31855 / Mcp9600 ドライバ（コンパイルと SimBus での単体テスト）、焙煎中の AP_STA 併用。
- 完了条件: OTA の往復とわざと壊した版のロールバック。全 env のビルドが CI で通る。

### 試験小隊
- T1（A1 と並行）: core の単体テスト、fixtures、legacy 比較の仕組み。
- T2（A2/A3 と並行）: Playwright 一式、sim サーバの全オプション。
- T3（F2 と並行）: 適合試験。
- T4（全部の後）: 7.5 の実地試験とその報告。
- 完了条件: 各フェーズの完了条件の自動試験を CI に組み込む。T4 の報告書。

---

## 9. リスクと未決事項

### 9.1 主なリスク
| # | リスク | 影響 | 対策 |
|---|---|---|---|
| R1 | http は安全なコンテキストではないため Wake Lock が使えない。iOS は画面ロックや裏に回ると WS を止める | 焙煎中に記録が抜ける | 無音動画のループ再生 + ESP32 の 1 時間リングバッファ + 再接続時のバックフィル（2.7）+ 自動ロックオフの案内。**記録の欠損は構造的に起きない**設計にする |
| R2 | localStorage がアクセス先のアドレスごとに分かれる（roast.local / IP / AP の IP） | 履歴が分散したように見える | AP でも DNSServer で roast.local を使えるようにする。IP でアクセスしたら警告。フェーズ F3 以降で ESP32 に記録の控えを置く案（D3） |
| R3 | Android で mDNS（.local）が解決できない機種がある / プライベート DNS が ESP32 の DNS を迂回する | roast.local で開けない | IP の QR コードを本体ラベルに印刷。`/api/info` で表示したアドレスをブックマークしてもらう |
| R4 | Android が「インターネットなし」の Wi-Fi を嫌ってモバイルデータへ切り替える / iOS が AP から自動で離脱する | 通信が途切れる | バックフィルで救う。USER_GUIDE に「この Wi-Fi に接続を維持」の手順を書く |
| R5 | 熱電対のノイズ（ガスの炎、ドラムの接地、商用電源、モーター） | RoR が暴れる | **非接地型プローブ**を推奨。MAX31856 の 50/60Hz フィルタ + 平均化。アプリ側の despike と最小二乗。MAX31855 は接地されたプローブで誤動作するので要注意 |
| R6 | claude.ai db の 1 文書あたりの容量上限が不明 | 保存失敗 | 150KB を超えたら間引く。A4 で 30KB/100KB/200KB の文書を実際に保存して上限を確かめる |
| R7 | 単一 HTML の肥大（推定 130KB） | 工兵の編集ミス | 区間マーカー、目次コメント、サイズ予算の試験、core と sim は Node 側で検証 |
| R8 | 手網環境での熱（電子回路が炎に近い） | 故障・火災 | 本体は炎から離して置く。K 型の補償導線で延長。ガラス繊維被覆の耐熱を明記（HARDWARE.md） |
| R9 | ESPAsyncWebServer は LGPL-3.0 | 販売時のライセンス対応 | D6 で決める |
| R10 | 1 台の ESP32 に複数の端末が接続する | どれが記録係か混乱する | v2 ではどの端末も独立して記録する（表示用途なら問題なし）。「記録係」の概念は将来課題 |

### 9.2 大将軍の決裁事項（推奨案付き）
| # | 論点 | 推奨案 | 対案 |
|---|---|---|---|
| D1 | 試作のマイコン | **XIAO ESP32C3**（量産機と同じチップ・技適済み） | 手持ちの ESP32 DevKit（`env:esp32dev` で併用可） |
| D2 | 量産のアンプ | **MAX31855（1〜2ch）**。SPI で単純、断線検出あり、安い。NIST 補正をファームで行う。T4 のノイズ評価で劣れば MCP9601 | MCP9600（フィルタ優秀だが断線検出なし）、MAX31856 継続（高価だが最良） |
| D3 | 記録の正本 | **端末の localStorage + JSON 書き出し**（v2 初版）。F3 以降で ESP32 の LittleFS に直近 20 件の控え（`/api/roasts`）を追加 | 最初から ESP32 を正本にする（工数大） |
| D4 | 自動投入検知の既定 | **オン + 取り消しトースト** | オフ（手動の投入のみ） |
| D5 | RoR の既定 | **最小二乗 30 秒 + EMA 5 秒（ドラム）／60 秒（手網）**。手入力の記録は v1 の補間を維持 | Artisan と同様の差分 + 移動平均 |
| D6 | ファームのライセンス | **ファームのソースを公開（OSS）にする**。LGPL の義務を満たすいちばん簡単な方法 | ESP-IDF の `esp_http_server`（Apache-2.0）に移行して非公開にする（工数大） |
| D7 | 50/60Hz の既定 | **初回設定で地域を選ぶ（既定 50Hz）** | 60Hz 固定 |
| D8 | claude.ai 版を同一ファイルにするか | **同一ファイル**（機能は実行環境で出し分け） | 振り返り専用の別ファイル（二重管理になる） |
| D9 | 単位 | **℃のみ** | ℉対応（表示変換だけなら後付け可） |
| D10 | AP の常時併用 | **既定オフ。STA が切れたまま 30 秒・クライアント 0 で AP を併用** | 常時 AP_STA（電波の干渉とチャンネル固定のデメリット） |
| D11 | OTA の認証 | **機器パスワード必須** | ボタンを押してから 5 分間だけ受け付ける |
| D12 | 将来の接続 | Phase 4: ファームに Artisan 互換の WS 端点（`/artisan`。`getData` に `{"data":{"BT":..,"ET":..}}` で応答）。アプリに `WebBluetoothSource`（BLE GATT で同じ `s` メッセージを送る。Web Bluetooth は iOS Safari 非対応なので Android/PC 向け） | — |

---

### 9.3 大将軍の決裁（2026-11-23）
| # | 決定 | 備考 |
|---|---|---|
| D1 | **採用**: 試作は XIAO ESP32C3。手持ちの ESP32 DevKit 用の env も残す | 技適済みで、量産機と同じチップ |
| D2 | **保留**: 試作は MAX31856。量産のアンプは T4 のノイズ評価を見て MAX31855 / MCP9601 / MAX31856 から決める | ドライバ層で差し替えられるので、今は決めなくてよい |
| D3 | **採用**: 正本は端末の localStorage と JSON 書き出し。ESP32 への控えの保存は F3 以降 | |
| D4 | **採用**: 投入の自動検知は既定オン。取り消しトーストを出す | |
| D5 | **採用**: 最小二乗 30秒＋EMA 5秒（ドラム）、60秒（手網）。手入力の記録は v1 の方式のまま | |
| D6 | **採用（ユーザー決定）**: ファームとアプリのコードを公開する。ライセンスは MIT（同梱の LGPL ライブラリはそのまま LGPL） | ESPAsyncWebServer をそのまま使う |
| D7 | **採用**: 初回設定で 50/60Hz を選ぶ（既定 50Hz） | |
| D8 | **採用**: claude.ai 版と同じファイルにする | |
| D9 | **採用**: ℃のみ | |
| D10 | **採用**: AP は必要なときだけ併用する | |
| D11 | **採用**: OTA は機器パスワード必須 | |
| D12 | **採用**: Artisan 互換と Web Bluetooth は Phase 4 で行う | |

追加の決定:
- **手網を最初から一級の対象にする**: 販売先が手網ユーザーのため、`roasterType:'tenami'` の既定値（RoR 60秒、上昇による投入検知、TP なしを許す）を A2 の完了条件に含める。操作記録の初期ラベルは、手網のときに「火力・網の高さ・振り」へ切り替えられるようにする
- 実装の順番は P0 → A1 → A2（シミュレーターで全部確かめられる）を最優先にし、ファームの F1 は部品が届いてから始める

### 9.4 大将軍の決裁（監察第1回を受けて、2026-11-23）
- **シミュレーターの定数**: SPEC 7.2 の値は現実に合わないため、試験小隊が調整した値を正とする（h=0.0030、τp ドラム25秒/手網15秒、1ハゼ直後 exoDown=-0.10）
- **pong.t**: ESP32 は実時刻を知らないので、pong の `t` は ping の `t` をそのまま返す
- **焙煎の時計**: ESP32（と互換サーバー）から受けるときは、焙煎の経過時間を**機器の ms で数える**（`t = (ms - 投入時のms)/1000`）。端末の実時刻への換算（2.6 の offset 推定）は、表示用の開始時刻を出すときだけに使う。こうすれば `speed>1` のときも時刻が合う
- **gaps の形**: 配列の中の配列は claude.ai の db に入らないおそれがあるので、`gaps:[{from,to}]` にする。`from`〜`to` は両端を含む（その秒のサンプルが無い）。古い `[[a,b]]` 形式も読み込めるようにする
- **シミュレーターの真値**: `truth` の時刻はサンプルの `seq` と同じ数え方にそろえる

### 9.5 大将軍の決裁（監察第3回を受けて、2026-11-23）
- **送る順番**: 機器は接続ごとに `hello` → 必要な `bf` をすべて → `s` の順で送る。アプリは、bf の外れ値除去の状態を s と分けて持つ
- **焙煎の時刻は seq で数える**: 同じ起動の中では `t = seq - 投入時のseq`。起動が変わったら、新しい起動の基準を ms から決め、gaps に入れる
- **設定の版番号**: `cfg` に `rev`（設定を変えるたびに +1、NVS に保存）を付ける。`setcfg` は `baseRev` を付け、変える項目だけを送る（差分）。`baseRev` が今の `rev` と違えば `ack {ok:false, err:"stale", rev}` を返し、アプリは読み直しを促す。焙煎中に他の端末から補正値が変わったら警告する
- **切断中の排出**: 排出の時刻はタップした時点。接続が live でないときは、排出の後も最大15秒、残りの bf を待つ（「機器から残りを受け取っています」）。受け取れなかった分は gaps に入れる
- **RoR の表示**: ドラムは中点までゲージを「—」（小さく「中点のあと表示」）。手網は窓（60秒）が埋まるまで「—」。グラフは今のまま
- **焙煎中の書き込みは1タブだけ**: 下書きに書き手のタブ id を持たせる。他のタブは `storage` イベントで変化を知り、読み取り専用になる
- **手網の排出案内**: 既定でオフ。オンでもシートではなくバナーで出す
- **熱電対の線の色**: ANSI（黄+・赤−）、JIS（赤+・白−）、IEC（緑+・白−）を並べて案内し、「K型は − 側（アルメル）が磁石に付く」確かめ方も載せる
- 補足（9.5 の実装で確定）: `ack` は成功時も `rev` を付ける。失敗の `err` は `stale` / `unsupported`（MAX31855 で amp を変えようとした）/ `bad_channel`。機器が再起動したあとの新しい起動分の bf は、アプリが hello を見て `bf_req` で求める

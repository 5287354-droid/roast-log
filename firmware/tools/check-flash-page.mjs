#!/usr/bin/env node
// docs/flash（ブラウザ書き込みページ）の静的検査。CI の firmware ジョブで動かす。
//   node firmware/tools/check-flash-page.mjs [--bins]   # --bins: bin の実体があることも確かめる
// SPEC 9.6: manifest は bootloader / パーティション表 / boot_app0 / app / LittleFS の 5 つで、NVS の領域には書かない。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'docs', 'flash');
const needBins = process.argv.includes('--bins');
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'ok' : 'not ok'} - ${m}`); if (!c) fail++; };

// ---- パーティション表（csv）
const csvPath = path.join(ROOT, 'firmware', 'roastlog_4mb.csv');
const ini = fs.readFileSync(path.join(ROOT, 'firmware', 'platformio.ini'), 'utf8');
ok(/board_build\.partitions\s*=\s*roastlog_4mb\.csv/.test(ini), 'platformio.ini の共通設定が roastlog_4mb.csv');
ok([...ini.matchAll(/^board_build\.partitions\s*=\s*(\S+)/gm)].every(x => x[1] === 'roastlog_4mb.csv' || x[1].startsWith('${common')), '各 env は共通のパーティション表を使う（別の表を指していない）');
const num = s => { s = s.trim(); return /^0x/i.test(s) ? parseInt(s, 16) : parseInt(s, 10); };
const part = {};
for (const line of fs.readFileSync(csvPath, 'utf8').split('\n')) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  const c = line.split(',').map(x => x.trim());
  part[c[0]] = { type: c[1], sub: c[2], off: num(c[3]), size: num(c[4]) };
}
ok(part.nvs && part.otadata && part.app0 && part.app1 && part.spiffs && part.coredump, 'csv に nvs / otadata / app0 / app1 / coredump / spiffs がある');
ok(part.app0.size === part.app1.size, 'app0 と app1（OTA）が同じ大きさ');
ok(part.spiffs.size >= 256 * 1024 && part.spiffs.size <= 384 * 1024, `LittleFS が 256〜384KB（${part.spiffs.size / 1024}KB）`);
ok(part.spiffs.off + part.spiffs.size <= 4 * 1024 * 1024, '4MB に収まる');
const sorted = Object.values(part).sort((a, b) => a.off - b.off);
ok(sorted.every((p, i) => i === 0 || sorted[i - 1].off + sorted[i - 1].size <= p.off), 'パーティションが重ならない');
ok(part.app0.off % 0x10000 === 0 && part.app1.off % 0x10000 === 0, 'app は 64KB 境界');

// ---- ページ本体
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const m = /unpkg\.com\/esp-web-tools@(\d+\.\d+\.\d+)\/dist\/web\/install-button\.js/.exec(html);
ok(m, 'esp-web-tools を unpkg から版を固定して読み込む');
ok(/<esp-web-install-button[^>]*manifest="manifest\.json"/.test(html), '既定の manifest は manifest.json');
ok(/BOOT/.test(html) && /押したまま/.test(html), 'BOOT ボタンを押しながら挿す手順がある');
ok(/Wi-Fi を設定/.test(html) && /ログとコンソール/.test(html), 'Improv: 「Wi-Fi を設定」「ログとコンソール」の手順がある');
ok(/THIRD_PARTY_NOTICES/.test(html), '同梱ライブラリのライセンス表記（THIRD_PARTY_NOTICES）へのリンクがある');
const notices = path.join(ROOT, 'docs', 'flash', 'THIRD_PARTY_NOTICES.txt');
ok(fs.existsSync(notices), 'docs/flash/THIRD_PARTY_NOTICES.txt がある');
if (fs.existsSync(notices)) {
  const t = fs.readFileSync(notices, 'utf8');
  const libs = [...ini.matchAll(/^\s+[\w-]+\/([\w-]+)@([\d.]+)/gm)].map(x => [x[1], x[2]]);
  for (const [n, v] of libs) ok(t.includes(n) && t.includes(v), `ライセンス表記に ${n} ${v} がある`);
  ok(/LGPL-3\.0/.test(t) && /LGPL-2\.1/.test(t) && /MIT/.test(t), 'LGPL-3.0 / LGPL-2.1 / MIT の表記がある');
  const plat = /\.git#([\d.]+)/.exec(ini);
  ok(plat && t.includes(plat[1]), `pioarduino ${plat && plat[1]} の表記がある`);
}
// 組み立て手順（HARDWARE.md から作った hardware.html）が最新か
import crypto from 'node:crypto';
const hw = path.join(DIR, 'hardware.html');
ok(fs.existsSync(hw), 'docs/flash/hardware.html がある（書き込みページから HARDWARE を開ける）');
if (fs.existsSync(hw)) {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'docs', 'HARDWARE.md'))).digest('hex');
  ok(fs.readFileSync(hw, 'utf8').includes(sha), 'hardware.html が docs/HARDWARE.md の最新版から作られている（python3 firmware/scripts/md_to_html.py .）');
}
// リンクは Pages（/docs 以下）でそのまま開ける形にする。../HARDWARE.md は Pages では開けない
ok(!/href="\.\.\/[^"]*\.md"/.test(html), 'docs の .md への相対リンクが無い（Pages では開けない）');
for (const h of [...html.matchAll(/href="(\.\.?\/[^"#]+)"/g)].map(x => x[1])) ok(fs.existsSync(path.join(DIR, h)), `リンク先がある: ${h}`);

// ---- manifest
const fwVer = /#define FW_VERSION "([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, 'firmware', 'include', 'config.h'), 'utf8'))[1];
const radios = [...html.matchAll(/value="(manifest[^"]*\.json)"/g)].map(x => x[1]);
ok(radios.length >= 2, `アンプの選択肢 ${radios.join(', ')}`);
const envs = new Set(fs.readFileSync(path.join(ROOT, 'firmware', 'platformio.ini'), 'utf8').match(/^\[env:([^\]]+)\]/gm).map(s => s.slice(5, -1)));
const BOOT_OFF = { 'ESP32-C3': 0x0, 'ESP32': 0x1000 };
const NAMES = ['bootloader.bin', 'partitions.bin', 'boot_app0.bin', 'firmware.bin', 'littlefs.bin'];
for (const f of radios) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  ok(j.version === fwVer, `${f}: version ${j.version} がファーム ${fwVer} と同じ`);
  ok(!j.new_install_prompt_erase, `${f}: 消去の選択肢を出さない（NVS を消さない）`);
  ok(Array.isArray(j.builds) && j.builds.length > 0, `${f}: builds がある`);
  for (const b of j.builds) {
    ok(['ESP32', 'ESP32-C3'].includes(b.chipFamily), `${f}: chipFamily ${b.chipFamily}`);
    ok(b.parts.length === 5, `${f}: ${b.chipFamily} は 5 つの部品（bootloader / パーティション表 / boot_app0 / app / LittleFS）`);
    const e = /^firmware\/([^/]+)\//.exec(b.parts[0].path);
    ok(e && envs.has(e[1]), `${f}: ${b.parts[0].path} は platformio.ini の env を指す`);
    if (e) {
      const want = e[1].startsWith('xiao') || e[1].includes('c3') ? 'ESP32-C3' : 'ESP32';
      ok(want === b.chipFamily, `${f}: ${e[1]} のチップは ${want}`);
    }
    const want = [
      [BOOT_OFF[b.chipFamily], 'bootloader.bin'], [0x8000, 'partitions.bin'], [0xE000, 'boot_app0.bin'],
      [part.app0.off, 'firmware.bin'], [part.spiffs.off, 'littlefs.bin'],
    ];
    want.forEach(([off, name], i) => {
      const p = b.parts[i];
      ok(p && p.offset === off && p.path === `firmware/${e && e[1]}/${name}`, `${f}: ${b.chipFamily} ${name} は 0x${off.toString(16)}`);
    });
    // NVS（nvs の領域）に書く部品が無い。boot_app0 は otadata（0xE000〜）に書く
    const nvs0 = part.nvs.off, nvs1 = part.nvs.off + part.nvs.size;
    const sizes = { 'bootloader.bin': 0x8000, 'partitions.bin': 0x1000, 'boot_app0.bin': part.otadata.size, 'firmware.bin': part.app0.size, 'littlefs.bin': part.spiffs.size };
    for (const p of b.parts) {
      const nm = path.basename(p.path);
      ok(p.offset + sizes[nm] <= nvs0 || p.offset >= nvs1, `${f}: ${nm} は NVS の領域（0x${nvs0.toString(16)}〜0x${(nvs1 - 1).toString(16)}）にかからない`);
    }
    if (needBins) for (const p of b.parts) {
      const fp = path.join(DIR, p.path);
      ok(fs.existsSync(fp) && fs.statSync(fp).size > 0, `${f}: ${p.path} がある`);
      if (!fs.existsSync(fp)) continue;
      const sz = fs.statSync(fp).size, nm = path.basename(p.path);
      if (nm === 'firmware.bin') ok(sz <= part.app0.size, `${f}: ${p.path} (${sz}B) が app0 (${part.app0.size}B) に入る`);
      if (nm === 'littlefs.bin') ok(sz === part.spiffs.size, `${f}: ${p.path} の大きさが LittleFS 領域と同じ`);
      if (nm === 'partitions.bin') {
        // 実際のパーティション表（バイナリ）が csv と同じか
        const buf = fs.readFileSync(fp); const got = {};
        for (let i = 0; i + 32 <= buf.length && buf.readUInt16LE(i) === 0x50AA; i += 32) {
          got[buf.toString('latin1', i + 12, i + 28).replace(/\0.*$/, '')] = { off: buf.readUInt32LE(i + 4), size: buf.readUInt32LE(i + 8) };
        }
        for (const k of Object.keys(part)) ok(got[k] && got[k].off === part[k].off && got[k].size === part[k].size, `${f}: partitions.bin の ${k} が csv と同じ`);
      }
    }
  }
}
console.log(fail ? `# ${fail} 件失敗` : '# すべて通過');
process.exit(fail ? 1 : 0);

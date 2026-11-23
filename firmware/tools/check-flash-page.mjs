#!/usr/bin/env node
// docs/flash（ブラウザ書き込みページ）の静的検査。CI の firmware ジョブで動かす。
//   node firmware/tools/check-flash-page.mjs [--bins]   # --bins: bin の実体があることも確かめる
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'docs', 'flash');
const needBins = process.argv.includes('--bins');
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'ok' : 'not ok'} - ${m}`); if (!c) fail++; };

const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const m = /unpkg\.com\/esp-web-tools@(\d+\.\d+\.\d+)\/dist\/web\/install-button\.js/.exec(html);
ok(m, 'esp-web-tools を unpkg から版を固定して読み込む');
ok(/<esp-web-install-button[^>]*manifest="manifest\.json"/.test(html), '既定の manifest は manifest.json');
ok(/BOOT/.test(html) && /押したまま/.test(html), 'BOOT ボタンを押しながら挿す手順がある');
const fwVer = /#define FW_VERSION "([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, 'firmware', 'include', 'config.h'), 'utf8'))[1];
const radios = [...html.matchAll(/value="(manifest[^"]*\.json)"/g)].map(x => x[1]);
ok(radios.length >= 2, `アンプの選択肢 ${radios.join(', ')}`);
const envs = new Set(fs.readFileSync(path.join(ROOT, 'firmware', 'platformio.ini'), 'utf8').match(/^\[env:([^\]]+)\]/gm).map(s => s.slice(5, -1)));
for (const f of radios) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  ok(j.version === fwVer, `${f}: version ${j.version} がファーム ${fwVer} と同じ`);
  ok(Array.isArray(j.builds) && j.builds.length > 0, `${f}: builds がある`);
  for (const b of j.builds) {
    ok(['ESP32', 'ESP32-C3'].includes(b.chipFamily), `${f}: chipFamily ${b.chipFamily}`);
    ok(b.parts.length === 1 && b.parts[0].offset === 0, `${f}: ${b.chipFamily} は merged bin 1 本（offset 0）`);
    const p = b.parts[0].path, e = /^firmware\/([^/]+)\/roastlog-\1-merged\.bin$/.exec(p);
    ok(e && envs.has(e[1]), `${f}: ${p} は platformio.ini の env を指す`);
    if (e) {
      const want = e[1].startsWith('xiao') || e[1].includes('c3') ? 'ESP32-C3' : 'ESP32';
      ok(want === b.chipFamily, `${f}: ${e[1]} のチップは ${want}`);
    }
    if (needBins) ok(fs.existsSync(path.join(DIR, p)) && fs.statSync(path.join(DIR, p)).size > 1e6, `${f}: ${p} がある`);
  }
}
console.log(fail ? `# ${fail} 件失敗` : '# すべて通過');
process.exit(fail ? 1 : 0);

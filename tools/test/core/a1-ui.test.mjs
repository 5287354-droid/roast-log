// A1: Playwright で app/index.html を実際に開いて確認する（回帰・v2 多チャンネル表示・手入力の焙煎を最後まで）
// 実行: node --test tools/test/core/a1-ui.test.mjs  （スクリーンショットは test-results/a1/ に保存）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const shots = path.join(root, 'test-results/a1'); fs.mkdirSync(shots, { recursive: true });
const APP = pathToFileURL(path.join(root, 'app/index.html')).href;
const LEGACY = pathToFileURL(path.join(root, 'legacy/roastlog-artifact-v1.html')).href;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-'));

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// 小さな v1 バックアップ（手入力 30 秒間隔・12 分）
function v1Backup() {
  const R = rng(11); const points = []; let temp = 190;
  for (let i = 0; i <= 24; i++) { temp += i < 4 ? -22 + R() * 4 : 7 - i * .12 + R() * 2; points.push({ t: i * 30, temp: Math.round(temp * 10) / 10 }); }
  const roast = { id: 'rv1', beanId: 'b1', beanName: 'エチオピア G1', origin: 'エチオピア', process: 'ウォッシュト', greenWeight: 200, roastedWeight: 170, degree: '中煎り', roomTemp: 18, weather: '晴れ', interval: 30,
    initial: { fire: '中', damper: '閉', rpm: '7' }, startedAt: 1763870000000, dropTime: 720, points: points.map(p => ({ ...p, ror: 0 })),
    events: [{ type: 'tp', t: 90 }, { type: 'dry', t: 300 }, { type: 'fc1', t: 560 }, { type: 'drop', t: 720 }], changes: [{ t: 120, kind: 'fire', value: '強' }], memo: 'テスト', tasting: null, savedAt: 1763870700000 };
  return { app: 'roastlog', version: 1, exportedAt: '2026-01-01T00:00:00Z', roasts: [roast], beans: [{ id: 'b1', name: 'エチオピア G1', origin: 'エチオピア', process: 'ウォッシュト', shop: '', memo: '', createdAt: 1 }], settings: null };
}
// v2 の 3ch（BT/ET/AMB）、投入前 30 秒、欠測 1 か所
function v2Backup() {
  const R = rng(5); const n = 750, start = -30, data = { c1: [], c2: [], c3: [] };
  for (let i = 0; i < n; i++) { const t = start + i; data.c1.push(t < 0 ? 2000 : Math.round((2000 - 800 * Math.exp(-t / 35) + t * 1.3) * 1 + R() * 3)); data.c2.push(Math.round(2300 + t * 0.4 + R() * 3)); data.c3.push(Math.round(240 + R() * 2)); }
  for (let i = 300; i < 318; i++) { data.c1[i] = null; data.c2[i] = null; }
  const roast = { schema: 2, id: 'rv2', beanId: 'b2', beanName: '自動測定テスト', origin: 'ケニア', process: 'ウォッシュト', greenWeight: 200, roastedWeight: 168, degree: '中煎り', roomTemp: 24, weather: null, interval: 30,
    initial: { fire: '中', damper: '閉', rpm: '7' }, startedAt: 1763880000000, dropTime: 719, events: [{ type: 'tp', t: 85, auto: true }, { type: 'dry', t: 290 }, { type: 'fc1', t: 520 }, { type: 'drop', t: 719 }], changes: [{ t: 120, kind: 'fire', value: '強' }],
    memo: '', tasting: null, savedAt: 1763880700000, source: 'esp32', device: { model: 'RL-C3-2', fw: '0.3.0', amp: 'max31856', id: 'a4cf12' },
    channels: [{ key: 'c1', role: 'bt', name: '豆温度', color: '#C2410C', offset: -0.8 }, { key: 'c2', role: 'et', name: '排気', color: '#2563EB', offset: 0 }, { key: 'c3', role: 'amb', name: '外気温', color: '#6B7280', offset: 0 }],
    primary: 'c1', series: { dt: 1, start, scale: 10, data }, gaps: [[300, 317]], rorConfig: { method: 'lsq', window: 30, smooth: 5 }, points: [], futureField: { keep: 'me' } };
  return { app: 'roastlog', version: 2, exportedAt: '2026-01-01T00:00:00Z', roasts: [roast], beans: [], settings: null };
}
const v1File = path.join(tmp, 'v1.json'), v2File = path.join(tmp, 'v2.json');
fs.writeFileSync(v1File, JSON.stringify(v1Backup())); fs.writeFileSync(v2File, JSON.stringify(v2Backup()));

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function open(url) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true, colorScheme: 'light' });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  return { ctx, page, errors };
}
const goto = (page, to) => page.locator(`[data-action="go"][data-to="${to}"]:visible`).first().click();
async function importFile(page, file) {
  if (!(await page.locator('#importFile').isVisible())) await goto(page, 'settings');
  await page.setInputFiles('#importFile', file);
  await page.waitForSelector('.overlay [data-r="1"]'); await page.click('.overlay [data-r="1"]');
  await page.waitForSelector('.toast'); await goto(page, 'home');
  await page.waitForSelector('.roast-item');
}
async function openDetail(page) { await page.click('.roast-item'); await page.waitForSelector('#dStats .stat'); await page.waitForTimeout(300); }
const canvasPixels = page => page.evaluate(() => { const c = document.querySelector('#detailChart'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; return Array.from(d); });

test('(a) v1 バックアップ: 詳細画面が legacy と同じ表示（タイル・タイムライン・グラフ）', async () => {
  const L = await open(LEGACY), A = await open(APP);
  await importFile(L.page, v1File); await importFile(A.page, v1File);
  // ホームの履歴
  assert.equal(await A.page.textContent('#historyList'), await L.page.textContent('#historyList'));
  assert.equal(await A.page.innerHTML('.roast-item svg'), await L.page.innerHTML('.roast-item svg'), 'スパークライン');
  await L.page.screenshot({ path: path.join(shots, 'a-home-legacy.png') }); await A.page.screenshot({ path: path.join(shots, 'a-home-app.png') });
  await openDetail(L.page); await openDetail(A.page);
  for (const sel of ['#dStats', '#dTimeline', '#dSub', '#dTitle', '#eEvents']) assert.equal(await A.page.textContent(sel), await L.page.textContent(sel), sel);
  assert.equal(await A.page.textContent('#eTemps'), await L.page.textContent('#eTemps'), '温度表');
  assert.equal(await A.page.locator('#dStats .stat').count(), 8);
  // グラフのピクセル比較
  const pl = await canvasPixels(L.page), pa = await canvasPixels(A.page);
  assert.equal(pl.length, pa.length);
  let diff = 0; for (let i = 0; i < pl.length; i += 4) if (pl[i] !== pa[i] || pl[i + 1] !== pa[i + 1] || pl[i + 2] !== pa[i + 2] || pl[i + 3] !== pa[i + 3]) diff++;
  const ratio = diff / (pl.length / 4); console.log(`  グラフ差分ピクセル: ${diff} (${(ratio * 100).toFixed(3)}%)`);
  assert.ok(ratio < 0.01, 'グラフの差が 1% 未満');
  await L.page.screenshot({ path: path.join(shots, 'a-detail-legacy.png'), fullPage: true }); await A.page.screenshot({ path: path.join(shots, 'a-detail-app.png'), fullPage: true });
  assert.deepEqual(A.errors, []); assert.deepEqual(L.errors, []);
  await L.ctx.close(); await A.ctx.close();
});

test('(b) v2 多チャンネル記録: 詳細画面で多系列・凡例・追加タイル・CSV・未知フィールド保持', async () => {
  const A = await open(APP); const { page } = A;
  await importFile(page, v2File);
  const home = await page.textContent('.roast-item'); assert.match(home, /自動 3ch/);
  await openDetail(page);
  assert.equal(await page.locator('#dStats .stat').count(), 12, '自動記録はタイル 12 枚');
  const tiles = await page.textContent('#dStats');
  for (const w of ['中点温度', '最大RoR（中点以降）', '1ハゼ時温度', '乾燥 / メイラード']) assert.ok(tiles.includes(w), w);
  // 投入温度=t0 の BT（data[30]）、排出温度=dropTime の BT
  const bt = v2Backup().roasts[0].series.data.c1; assert.ok(tiles.includes(String(bt[30] / 10)), '投入温度'); assert.ok(tiles.includes(String(bt[719 + 30] / 10)), '排出時温度（dropTime の BT）');
  // 最大RoR（TP+30 秒以降）は RoastCore の計算と一致する値まで検査
  const vmCtx = { window: {} }; vm.createContext(vmCtx); const src = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
  vm.runInContext(src.slice(src.indexOf('// @core-begin'), src.indexOf('// @core-end')), vmCtx);
  const expect = vmCtx.window.RoastCore.stats(v2Backup().roasts[0], { rorWindowAuto: 30, rorSmooth: 5, flick: 3, crash: 4, rorWindow: 60 }).maxRor;
  assert.ok(expect != null && expect > 0, 'maxRor が計算できる');
  assert.ok(tiles.includes(expect.toFixed(1) + '℃/分'), `最大RoR ${expect.toFixed(1)} が表示される: ${tiles}`);
  // 凡例: BT と ET はボタン、AMB は数値のみ
  assert.equal(await page.locator('#detailLegend button[data-lg]').count(), 3); // c1 c2 RoR
  const lg = await page.textContent('#detailLegend'); assert.match(lg, /外気温 \d+(\.\d)?℃/); assert.ok(!(await page.locator('#detailLegend [data-lg="c3"]').count()));
  // タイムラインに全チャンネル
  assert.match(await page.textContent('#dTimeline'), /BT \d+\.\d℃ \/ ET \d+\.\d℃/);
  assert.match(await page.textContent('#dTimeline'), /中点（自動）/);
  // 修正欄: 温度表ではなく「自動測定」＋補正値
  assert.equal(await page.locator('#eTemps').count(), 0);
  assert.match(await page.textContent('#eTempBox'), /自動測定（750 点）/); assert.equal(await page.locator('#eTempBox input[data-off]').count(), 3);
  // グラフ: 2 系列（オレンジと青）が描かれている。AMB のグレーは線にならない
  const count = async () => page.evaluate(() => { const c = document.querySelector('#detailChart'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let o = 0, b = 0; for (let i = 0; i < d.length; i += 4) { const [r, g, bl] = [d[i], d[i + 1], d[i + 2]]; if (Math.abs(r - 0xC2) < 12 && Math.abs(g - 0x41) < 12 && Math.abs(bl - 0x0C) < 12) o++; if (Math.abs(r - 0x25) < 12 && Math.abs(g - 0x63) < 12 && Math.abs(bl - 0xEB) < 12) b++; } return { o, b }; });
  const c1 = await count(); assert.ok(c1.o > 300 && c1.b > 300, JSON.stringify(c1));
  await page.screenshot({ path: path.join(shots, 'b-detail-v2-3ch.png'), fullPage: true });
  // 凡例タップで ET を隠す
  await page.click('#detailLegend [data-lg="c2"]'); await page.waitForTimeout(100);
  const c2 = await count(); assert.ok(c2.b < 5 && c2.o > 300, JSON.stringify(c2));
  assert.equal(await page.getAttribute('#detailLegend [data-lg="c2"]', 'aria-pressed'), 'false');
  await page.screenshot({ path: path.join(shots, 'b-detail-v2-et-hidden.png') });
  await page.click('#detailLegend [data-lg="c2"]');
  // 補正値の後付け: BT に +1.0 → series が全体に +10、offset も加算、points が作り直される
  await page.click('#dEdit summary'); await page.fill('#eOff_c1', '1'); await page.click('[data-action="save-edit"]'); await page.waitForTimeout(300);
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('roastlog.cache')).roasts[0]);
  assert.equal(rec.series.data.c1[0], 2000 + 10 + (bt[0] - 2000)); assert.equal(rec.series.data.c1[300], null);
  assert.equal(rec.channels[0].offset, 0.2); assert.deepEqual(rec.futureField, { keep: 'me' }); assert.equal(rec.schema, 2); assert.ok(rec.points.length > 100);
  assert.equal(rec.points[0].temp, (bt[30] + 10) / 10);
  // CSV: チャンネル列・1 秒行
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="csv-one"]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8'); const lines = csv.split('\r\n');
  const head = lines.find(l => l.startsWith('時間,秒')); assert.equal(head, '時間,秒,豆温度(℃),排気(℃),外気温(℃),RoR(主チャンネル・℃/分),イベント,設定変更');
  assert.ok(lines.length >= 719 + 11, `行数 ${lines.length}`);
  assert.deepEqual(A.errors, []); await A.ctx.close();
});

test('(c) 手入力で焙煎を最後まで通して保存（v2 で保存・v1 と同じ流れ）。書き出しは version:2 で、legacy でも読める', async () => {
  const A = await open(APP); const { page } = A;
  await page.click('[data-action="new-roast"]');
  await page.fill('#suBeanName', 'テスト豆'); await page.fill('#suGreen', '200'); await page.fill('#suRoom', '20');
  await page.click('[data-action="to-roast"]'); await page.waitForSelector('#gauges');
  for (const k of ['2', '0', '0']) await page.click(`[data-k="${k}"]`);
  await page.click('[data-action="charge"]'); await page.waitForTimeout(1100);
  for (const k of ['1', '5', '0']) await page.click(`[data-k="${k}"]`); await page.click('[data-k="enter"]'); await page.waitForTimeout(1100);
  for (const k of ['1', '4', '5', '.', '5']) await page.click(`[data-k="${k}"]`); await page.click('[data-k="enter"]');
  await page.click('[data-ev="tp"]'); await page.waitForTimeout(600); await page.click('[data-ev="fc1"]');
  await page.click('[data-ctrl="fire"][data-v="強"]');
  assert.match(await page.textContent('#liveLegend'), /排気温度/);
  await page.screenshot({ path: path.join(shots, 'c-roasting.png'), fullPage: true });
  await page.click('[data-ev="drop"]'); await page.waitForSelector('.overlay [data-r="1"]'); await page.click('.overlay [data-r="1"]');
  await page.waitForSelector('#fStats .stat'); assert.equal(await page.locator('#fStats .stat').count(), 8);
  await page.fill('#fRoasted', '170'); await page.screenshot({ path: path.join(shots, 'c-finish.png'), fullPage: true });
  await page.click('[data-action="save-finish"]'); await page.waitForSelector('#dStats .stat'); await page.waitForTimeout(300);
  assert.match(await page.textContent('#dTitle'), /テスト豆/); assert.match(await page.textContent('#dStats'), /投入温度200℃/);
  await page.screenshot({ path: path.join(shots, 'c-detail-saved.png'), fullPage: true });
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('roastlog.cache')).roasts[0]);
  assert.equal(rec.schema, 2); assert.equal(rec.source, 'manual'); assert.equal(rec.primary, 'c1'); assert.equal(rec.channels.length, 1); assert.equal(rec.channels[0].role, 'et');
  assert.ok(rec.points.length >= 3 && rec.points.every(p => 't' in p && 'temp' in p && !('ror' in p))); assert.equal(rec.points[0].t, 0);
  assert.ok(rec.events.some(e => e.type === 'drop')); assert.equal(rec.rorConfig.method, 'interp'); assert.equal(rec.roastedWeight, 170);
  assert.equal(await page.evaluate(() => localStorage.getItem('roastlog.draft')), null);
  // 書き出し
  await goto(page, 'home'); await goto(page, 'settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export-json"]')]);
  const out = JSON.parse(fs.readFileSync(await dl.path(), 'utf8')); assert.equal(out.version, 2); assert.equal(out.roasts.length, 1);
  // 注: headless Chromium は日本語のファイル名を 'download' と報告することがある（アプリの問題ではない）
  assert.match(dl.suggestedFilename(), /^(焙煎記録バックアップ_\d{8}\.json|download)$/);
  const exported = path.join(tmp, 'exported-v2.json'); fs.writeFileSync(exported, JSON.stringify(out));
  // v2 バックアップを legacy（v1 アプリ）で読んでも壊れない（ET 1 本として表示）
  const L = await open(LEGACY); await importFile(L.page, exported); await openDetail(L.page);
  assert.match(await L.page.textContent('#dTitle'), /テスト豆/); assert.equal(await L.page.locator('#dStats .stat').count(), 8);
  await L.page.screenshot({ path: path.join(shots, 'c-v2-backup-in-legacy.png'), fullPage: true });
  assert.deepEqual(L.errors, []); await L.ctx.close();
  // app で読み直して同じ記録に上書き
  await importFile(page, exported);
  assert.equal(await page.locator('.roast-item').count(), 1, '同じ id は上書き');
  assert.deepEqual(A.errors, []); await A.ctx.close();
});

test('(d) 壊れた記録の読み込みは除外し、version 3 は拒否', async () => {
  const A = await open(APP); const { page } = A;
  const b = v1Backup(); b.roasts.push({ id: 'broken', points: [{ t: 0, temp: 'abc' }] });
  const f = path.join(tmp, 'broken.json'); fs.writeFileSync(f, JSON.stringify(b));
  await goto(page, 'settings'); await page.setInputFiles('#importFile', f); await page.waitForSelector('.overlay');
  assert.match(await page.textContent('.overlay'), /形式が正しくない記録 1 件/); await page.click('.overlay [data-r="1"]'); await goto(page, 'home'); await page.waitForSelector('.roast-item');
  assert.equal(await page.locator('.roast-item').count(), 1);
  const f3 = path.join(tmp, 'v3.json'); fs.writeFileSync(f3, JSON.stringify({ ...v1Backup(), version: 3 }));
  await goto(page, 'settings'); await page.setInputFiles('#importFile', f3); await page.waitForSelector('.toast >> text=新しい形式');
  assert.deepEqual(A.errors, []); await A.ctx.close();
});

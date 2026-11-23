// A3 / E2E-3: ESP32 互換サーバー（node tools/sim/server.mjs --speed 20）から配信されたアプリで、焙煎を最後まで通す。
// 2ch 表示 → --disconnect の後も欠損 0（バックフィル）→ --fault で「断線」と音 → 長い切断で「再接続中」→ --reboot-at で gaps → 排出・保存・読み取りカーソル。
// 焙煎中の再読み込み（S1）も、ESP32 互換サーバーとシミュレーター（ページ内）の両方で確かめる。スクリーンショットは test-results/a3/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startSim } from '../lib/sim-proc.mjs';
import { validateRoast } from '../lib/schemas.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const shots = path.join(root, 'test-results/a3'); fs.mkdirSync(shots, { recursive: true });
let browser; const sims = [];
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); await Promise.all(sims.map(s => s.stop())); });
const sim = async args => { const s = await startSim(args); sims.push(s); return s; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, label, ms = 60000, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + label); await sleep(step); } }

async function open(url, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await ctx.newPage(); const errors = [], frames = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|Failed to load resource|fonts/i.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('websocket', ws => { ws.on('framesent', f => { try { frames.push(JSON.parse(f.payload)); } catch {} }); });
  // 音の数を数える（AudioContext の差し替え）
  await page.addInitScript(() => { window.__osc = 0; const A = window.AudioContext || window.webkitAudioContext; if (A) { const mk = A.prototype.createOscillator; A.prototype.createOscillator = function () { window.__osc++; return mk.call(this); }; } });
  await page.goto(url + '/'); await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  return { ctx, page, errors, frames };
}
const D = page => page.evaluate(() => { const S = window.__roastlog.S, d = S.draft; return d ? { status: d.status, sa: d.startedAt, n: d.series ? d.series.data[d.primary].length : 0, gaps: d.gaps, start: d.series && d.series.start, c1: d.series && d.series.data.c1, c2: d.series && d.series.data.c2, ev: d.events, src: d.source, live: d.live, lastT: S.live && S.live.lastT } : null; });
async function startRoast(page, name) {
  await page.click('[data-action="new-roast"]');
  await page.fill('#suBeanName', name); await page.fill('#suGreen', '200');
  await waitFor(() => page.evaluate(() => !!window.__roastlog.Sources.active.info), 'ESP32 に接続');
  await page.click('[data-action="to-roast"]');
  await page.waitForSelector('[data-view="roast"]:not([hidden])');
}

test('E2E-3: ESP32 から配信 → 2ch 表示 → 切断で欠損 0 → 断線と音 → 再接続中 → 再起動で gaps → 排出・保存・カーソル', { timeout: 150000 }, async () => {
  const srv = await sim(['--speed', '20', '--charge-at', 'none', '--noise', '0.2', '--outlier-p', '0', '--disconnect', '150:20', '--fault', 'c2:open@260-280', '--reboot-at', '800']);
  const { ctx, page, errors } = await open(srv.url);
  // ESP32 から配信されている状態
  assert.ok(await page.evaluate(() => !!window.__roastlog.S.device && window.__roastlog.Sources.resolve('auto') === 'esp32'), '自動 → esp32');
  assert.match(await page.textContent('#modeChip'), /ESP32/);
  await page.click('[data-action="new-roast"]');
  await waitFor(() => page.evaluate(() => !!window.__roastlog.Sources.active.info), 'hello');
  await sleep(1200);
  const chips = await page.textContent('#suChans'); assert.ok(chips.includes('豆温度') && chips.includes('排気'), '2ch: ' + chips); assert.ok(!chips.includes('外気温'), 'CH3 は使わない');
  assert.ok(await page.isVisible('#suMeas')); assert.equal(await page.isVisible('#suIntervalBox'), false);
  await page.screenshot({ path: path.join(shots, 'setup-esp32.png') });
  await page.click('[data-action="go"][data-to="home"]:visible');
  await startRoast(page, 'ESP32 の焙煎');
  assert.equal(await page.isVisible('#keypad'), false);
  await waitFor(async () => (await page.textContent('#connRow')).includes('受信中'), '受信中');
  await sleep(1500);
  await srv.api('/api/sim/charge');
  await waitFor(async () => (await D(page)).sa != null, '自動投入', 30000);
  assert.match(await page.textContent('.toast'), /投入を検知しました/);
  // 9.4: 焙煎の時計は機器の ms。×20 でもサーバーの seq とずれない
  const sync = async () => { const d = await D(page), tr = await srv.api('/api/sim/truth'); return { lastT: d.lastT, expect: tr.seq - tr.chargeT, seq: tr.seq, chargeT: tr.chargeT }; };
  await waitFor(async () => (await D(page)).lastT > 40, 't>40');
  { const s = await sync(); assert.ok(Math.abs(s.lastT - s.expect) <= 3, `×20 でも時刻がずれない: アプリ ${s.lastT} / 機器 ${s.expect}`); }
  await page.screenshot({ path: path.join(shots, 'roast-esp32.png') });
  assert.match(await page.textContent('#gChips'), /排気/);
  // --disconnect 150:20 のあと
  await waitFor(async () => (await srv.api('/api/sim/state')).virtualSec > 190, '切断のあと', 40000);
  await waitFor(async () => (await page.textContent('#connRow')).includes('受信中'), '再接続', 20000);
  await waitFor(async () => (await D(page)).lastT > (await sync()).expect - 8, 'バックフィルで追いつく', 20000);
  { const d = await D(page); const from = 8 - d.start; // 投入直後の数秒は、外れ値除去（despike）が保留した null が入る
    const nulls = d.c1.slice(from, d.lastT - d.start - 1).filter(x => x == null).length + d.c2.slice(from, d.lastT - d.start - 1).filter(x => x == null).length;
    assert.equal(nulls, 0, '切断のあとも欠損 0（バックフィル）: ' + JSON.stringify([d.c1, d.c2].map(a => a.map((x, i) => x == null ? i + d.start : null).filter(x => x != null)))); assert.deepEqual(d.gaps, [], 'gaps なし'); }
  assert.ok(await page.evaluate(() => window.__roastlog.S.live.m.gaps.length === 0));
  // 故障: --fault c2:open@260-280 → 「断線」と音
  const osc0 = await page.evaluate(() => window.__osc);
  await waitFor(async () => (await page.textContent('#gChips')).includes('断線'), '断線の表示', 30000, 50);
  assert.match(await page.textContent('.toast.err'), /CH2.*断線/);
  await page.screenshot({ path: path.join(shots, 'roast-fault.png') });
  assert.ok(await page.evaluate(() => window.__osc) > osc0, '音が鳴る');
  await waitFor(async () => !(await page.textContent('#gChips')).includes('断線'), '断線の解消', 20000);
  // 長い切断（API）→ 再接続中の表示 → 戻る
  await srv.api('/api/sim/disconnect?sec=160');
  await waitFor(async () => (await page.textContent('#connRow')).includes('再接続中'), '再接続中の表示', 10000, 50);
  assert.equal(await page.evaluate(() => document.querySelector('#gauges').style.opacity), '0.55', '温度ゲージを薄く表示');
  await page.screenshot({ path: path.join(shots, 'reconnecting.png') });
  await waitFor(async () => (await page.textContent('#connRow')).includes('受信中'), '再接続できた', 40000);
  await waitFor(async () => (await D(page)).lastT > (await sync()).expect - 8, 'バックフィル（長い切断）', 20000);
  { const d = await D(page), end = d.lastT - d.start - 1;
    // c2 は故障の区間だけ null（260-280 の仮想秒）。c1 は欠損 0
    assert.equal(d.c1.slice(8 - d.start, end).filter(x => x == null).length, 0, 'c1 欠損 0');
    const n2 = d.c2.slice(8 - d.start, end).filter(x => x == null).length; assert.ok(n2 >= 15 && n2 <= 25, `c2 の null は故障の ~21 秒だけ: ${n2}`);
    assert.deepEqual(d.gaps, []); const s = await sync(); assert.ok(Math.abs(d.lastT - s.expect) <= 8, `時刻 ${d.lastT}/${s.expect}`); }
  // 1ハゼ（手動）→ 排出の案内（温度が急に下がる）。投入をもう一度して BT を落とす
  await page.click('[data-ev="fc1"]');
  // --reboot-at 800: gaps が入る
  const bid0 = (await srv.api('/api/sim/state')).bootId;
  await waitFor(async () => (await srv.api('/api/sim/state')).bootId !== bid0, '再起動', 60000);
  await waitFor(async () => (await D(page)).gaps.length >= 1, 'gaps の記録', 30000);
  const gp = (await D(page)).gaps; const gsum = gp.reduce((a, g) => a + g.to - g.from + 1, 0);
  assert.ok(gsum >= 1 && gsum <= 20, `再起動の欠測は短い: ${JSON.stringify(gp)}`);
  assert.ok(gp.every(g => typeof g.from === 'number' && typeof g.to === 'number' && g.from <= g.to), 'gaps は {from,to}');
  await waitFor(async () => (await page.textContent('#connRow')).includes('受信中'), '再起動後の受信', 20000);
  await sleep(600);
  await page.screenshot({ path: path.join(shots, 'roast-esp32-after-reboot.png') });
  // 排出の案内: 1ハゼのあと BT が 10 秒で 20℃ 下がる（投入し直す）
  await srv.api('/api/sim/rebatch');
  await page.waitForSelector('#dropHintSheet', { timeout: 30000 });
  assert.match(await page.textContent('#dropHintSheet'), /排出しましたか/);
  await page.screenshot({ path: path.join(shots, 'drop-hint.png') });
  await page.click('#dropHintSheet [data-r="0"]'); // まだ
  assert.equal(await page.locator('#dropHintSheet').count(), 0);
  assert.equal((await D(page)).status, 'roasting');
  // 排出（手動）→ 保存
  const before = await D(page);
  await page.click('[data-ev="drop"]'); await page.click('.overlay [data-r="1"]');
  await page.waitForSelector('[data-view="finish"]:not([hidden])');
  await page.fill('#fRoasted', '170'); await page.click('[data-action="save-finish"]');
  await page.waitForSelector('[data-view="detail"]:not([hidden])');
  const rec = await page.evaluate(() => window.__roastlog.S.roasts[0]);
  assert.equal(rec.source, 'esp32'); assert.equal(rec.schema, 2); assert.equal(rec.channels.length, 2); assert.ok(rec.device && rec.device.model);
  assert.ok(rec.series.data.c1.length >= before.n - 1, `排出で series を削らない ${rec.series.data.c1.length} / ${before.n}`);
  assert.ok(rec.gaps.length >= 1 && rec.gaps.every(g => 'from' in g && 'to' in g), 'gaps は {from,to}');
  assert.ok(Math.abs(rec.startedAt - Date.now()) < 3 * 3600 * 1000, '開始時刻は端末の実時刻（×20 でも未来にならない）');
  assert.deepEqual(validateRoast(rec), [], '記録が schema に合格');
  // 読み取りカーソル
  await page.waitForSelector('#detailChart'); await page.locator('#detailChart').scrollIntoViewIfNeeded(); await sleep(300);
  const box = await page.locator('#detailChart').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5); await page.mouse.up();
  const cur = await page.textContent('#detailCursor');
  assert.match(cur, /\d+:\d\d/); assert.match(cur, /BT \d+\.\d℃/); assert.match(cur, /ET \d+\.\d℃/); assert.match(cur, /RoR/);
  const t1 = cur.match(/\d+:\d\d/)[0];
  await page.mouse.move(box.x + box.width * 0.2, box.y + 80); await page.mouse.down(); await page.mouse.up();
  assert.notEqual((await page.textContent('#detailCursor')).match(/\d+:\d\d/)[0], t1, 'タッチ位置で値が変わる');
  await page.locator('#detailChart').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, 'detail-cursor.png') });
  assert.deepEqual(errors, []); await ctx.close();
});

test('S1: 焙煎中に再読み込み（ESP32 互換サーバー）→ 続ける → 時計が飛ばず、排出で series が削られない', { timeout: 90000 }, async () => {
  const srv = await sim(['--speed', '20', '--charge-at', 'none', '--outlier-p', '0']);
  const { ctx, page, errors } = await open(srv.url);
  await startRoast(page, '再読み込み ESP32'); await sleep(1500);
  await srv.api('/api/sim/charge');
  await waitFor(async () => ((await D(page)) || {}).lastT > 90, '90 秒', 30000);
  await sleep(5500); // draft の保存は実時間 5 秒ごと
  const b = await D(page); const n0 = b.n;
  await page.reload(); await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  await page.click('[data-action="resume"]'); await page.waitForSelector('[data-view="roast"]:not([hidden])');
  await waitFor(async () => (await page.textContent('#connRow')).includes('受信中'), '再接続', 20000);
  await waitFor(async () => { const d = await D(page); return d && d.lastT > b.lastT + 20; }, '続きの受信', 20000);
  const a = await D(page), tr = await srv.api('/api/sim/truth');
  assert.equal(a.sa, b.sa, '投入の時刻は変わらない');
  assert.ok(Math.abs(a.lastT - (tr.seq - tr.chargeT)) <= 8, `時計が飛ばない: アプリ ${a.lastT} / 機器 ${tr.seq - tr.chargeT}`);
  assert.ok(a.n >= n0, `series が縮まない ${a.n} / ${n0}`);
  assert.equal(a.c1.slice(8 - a.start, a.lastT - a.start - 1).filter(x => x == null).length, 0, '再読み込みのあいだもバックフィルで欠損 0');
  await page.click('[data-ev="drop"]'); await page.click('.overlay [data-r="1"]');
  await page.waitForSelector('[data-view="finish"]:not([hidden])');
  const d2 = await page.evaluate(() => { const d = window.__roastlog.S.draft; return { n: d.series.data.c1.length, drop: d.dropTime }; });
  assert.ok(d2.n >= n0, `排出で series を削らない ${d2.n} / ${n0}`); assert.ok(d2.drop >= b.lastT);
  assert.deepEqual(errors, []); await ctx.close();
});

test('S1: 焙煎中に再読み込み（ページ内シミュレーター）→ 続ける → 時計が飛ばず、排出で series が削られない', { timeout: 90000 }, async () => {
  const srv = await sim([]);   // アプリの配信にだけ使う
  const { ctx, page, errors } = await open(srv.url);
  await page.evaluate(() => { localStorage.setItem('roastlog.cache', JSON.stringify({ roasts: [], beans: [], settings: { conn: { type: 'sim', host: '' }, sim: { speed: 20, profile: 'drum', seed: 1, noise: 0.3, chargeAfter: 3 } } })); });
  await page.reload(); await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  await page.click('[data-action="new-roast"]'); await page.fill('#suBeanName', 'sim 再読み込み'); await page.fill('#suGreen', '200');
  await sleep(800); await page.click('[data-action="to-roast"]');
  await waitFor(async () => ((await D(page)) || {}).lastT > 120, '120 秒', 30000);
  await sleep(5500);
  const b = await D(page);
  await page.reload(); await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  await page.click('[data-action="resume"]'); await page.waitForSelector('[data-view="roast"]:not([hidden])');
  await waitFor(async () => { const d = await D(page); return d && d.lastT > b.lastT + 20; }, '続きの受信', 20000);
  const a = await D(page);
  assert.equal(a.sa, b.sa, '投入の時刻は変わらない');
  const el = await page.evaluate(() => window.__roastlog.S.draft && (window.__roastlog.Sources.active.now() - window.__roastlog.S.draft.startedAt) / 1000);
  assert.ok(Math.abs(el - a.lastT) <= 3, `経過時間が記録の時刻と合う: ${el} / ${a.lastT}`);
  assert.ok(a.n >= b.n, `series が縮まない ${a.n} / ${b.n}`);
  await page.click('[data-ev="drop"]'); await page.click('.overlay [data-r="1"]');
  await page.waitForSelector('[data-view="finish"]:not([hidden])');
  const d2 = await page.evaluate(() => { const d = window.__roastlog.S.draft; return { n: d.series.data.c1.length, drop: d.dropTime }; });
  assert.ok(d2.n >= b.n, `排出で series を削らない ${d2.n} / ${b.n}`);
  assert.deepEqual(errors, []); await ctx.close();
});

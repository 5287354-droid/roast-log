// A2: Playwright（続き）。取り消し・故障・容量・壊れた記録・性能・手入力の回帰・編集
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateRoast } from '../lib/schemas.mjs';
import { createModel } from '../../sim/roast-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const shots = path.join(root, 'test-results/a2'); fs.mkdirSync(shots, { recursive: true });
const APP = pathToFileURL(path.join(root, 'app/index.html')).href;
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function open({ clock = false, init, settings } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (clock) await page.clock.install({ time: new Date('2026-11-23T09:00:00+09:00') });
  if (settings) await page.addInitScript(s => { if (!localStorage.getItem('roastlog.cache')) localStorage.setItem('roastlog.cache', JSON.stringify({ roasts: [], beans: [], settings: s })); }, settings);
  if (init) await page.addInitScript(init);
  await page.goto(APP); await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  return { ctx, page, errors };
}
const SIM = (type = 'drum', extra = {}) => ({ roasterType: type, conn: { type: 'sim', host: '' }, sim: { speed: 20, profile: type, seed: 1, noise: 0.3, chargeAfter: 30, ...extra } });
const run = async (page, ms, step = 500) => { for (let t = 0; t < ms; t += step) await page.clock.runFor(Math.min(step, ms - t)); };
async function startRoast(page) {
  await page.click('[data-action="new-roast"]'); await page.fill('#suBeanName', '試験豆'); await page.fill('#suGreen', '200');
  await run(page, 2000); await page.click('[data-action="to-roast"]');
}

test('自動検知の取り消し: トーストの「取り消す」で投入前に戻り、以後は自動検知しない。手動の投入ボタンで始まる', async () => {
  const { ctx, page, errors } = await open({ clock: true, settings: SIM() });
  await startRoast(page);
  for (let i = 0; i < 100 && !(await page.evaluate(() => !!window.__roastlog.S.draft.startedAt)); i++) await page.clock.runFor(500);
  assert.match(await page.textContent('#flowBanner'), /投入を検知しました（\d+:\d\d 前）/);
  // 取り消しは確認を出す。いったん「戻る」で何も消えないことを確かめ、やり直しも試す
  assert.ok((await page.locator('#flowBanner [data-toast-action]').boundingBox()).height >= 44, 'ボタンは44px以上');
  await page.click('#flowBanner [data-toast-action]');
  await page.click('.overlay [data-r="0"]');
  assert.equal(await page.evaluate(() => window.__roastlog.S.draft.status), 'roasting', '確認で戻ると消えない');
  await page.click('[data-action="undo"]'); await page.click('.overlay [data-r="0"]');
  assert.equal(await page.evaluate(() => window.__roastlog.S.draft.status), 'roasting', '「1つ前の操作を取り消す」も確認が出る');
  await page.click('[data-action="undo"]'); await page.click('.overlay [data-r="1"]');
  await page.click('#flowBanner [data-toast-action]'); // やり直す
  assert.equal(await page.evaluate(() => window.__roastlog.S.draft.status), 'roasting', 'やり直すで戻る');
  assert.ok(await page.evaluate(() => window.__roastlog.S.draft.series.data.c1.length) > 30, '記録も戻る');
  await page.click('[data-action="undo"]'); await page.click('.overlay [data-r="1"]');
  const d = await page.evaluate(() => { const d = window.__roastlog.S.draft; return { status: d.status, sa: d.startedAt, ev: d.events.length, n: d.series.data.c1.length, off: d.autoOff }; });
  assert.deepEqual(d, { status: 'ready', sa: null, ev: 0, n: 0, off: true });
  await run(page, 15000); // もう一度は検知しない
  assert.equal(await page.evaluate(() => window.__roastlog.S.draft.status), 'ready');
  await page.screenshot({ path: path.join(shots, 'undo-autocharge.png') });
  // 手動で投入（Enter キー）→ 始まる。シミュレーターの豆も投入される
  await page.keyboard.press('Enter'); await run(page, 3000);
  const e = await page.evaluate(() => ({ s: window.__roastlog.S.draft.status, tr: window.__roastlog.Sources.active.truth().chargeT, n: window.__roastlog.S.draft.series.data.c1.length }));
  assert.equal(e.s, 'roasting'); assert.ok(e.tr >= 30, `手動の投入はモデル秒 ${e.tr}（自動投入なし）`); assert.ok(e.n >= 31);
  assert.deepEqual(errors, []); await ctx.close();
});

test('故障: 焙煎中に断線すると赤いトースト・チップに「断線」。直ると戻る', async () => {
  const { ctx, page, errors } = await open({ clock: true, settings: SIM() });
  await startRoast(page);
  await run(page, 5000);
  await page.evaluate(() => window.__roastlog.Sources.active.fault('c2', 'open', 100));
  await run(page, 500);
  assert.match(await page.textContent('.toast.err'), /CH2 排気: 断線/);
  assert.match(await page.textContent('#gChips'), /断線/);
  await run(page, 8000, 1000); assert.doesNotMatch(await page.textContent('#gChips'), /断線/);
  assert.deepEqual(errors, []); await ctx.close();
});

test('Wake Lock が無い環境では無音動画のループ再生を始める。自動ロックの案内が出る', async () => {
  const { ctx, page } = await open({ clock: true, settings: SIM(), init: () => { try { delete Navigator.prototype.wakeLock; } catch {} } });
  await startRoast(page);
  assert.equal(await page.locator('#noSleepVideo').count(), 1);
  assert.equal(await page.evaluate(() => { const v = document.querySelector('#noSleepVideo'); return v.loop && v.muted; }), true);
  assert.equal(await page.isVisible('#lockNote'), true);
  await page.click('[data-action="dismiss-lock"]'); assert.equal(await page.isVisible('#lockNote'), false);
  await ctx.close();
});

test('手網の操作ラベル「火力・網の高さ・振り」と initial の鍵 fire/height/shake', async () => {
  const { ctx, page } = await open({ clock: true, settings: SIM('tenami') });
  await page.click('[data-action="new-roast"]');
  assert.equal(await page.textContent('#lbDamper'), '網の高さ'); assert.equal(await page.textContent('#lbRpm'), '振り');
  await page.fill('#suBeanName', 'x'); await run(page, 1500); await page.click('[data-action="to-roast"]');
  assert.deepEqual(await page.evaluate(() => Object.keys(window.__roastlog.S.draft.initial).sort()), ['fire', 'height', 'shake']);
  assert.match(await page.textContent('#controls'), /網の高さ/); assert.match(await page.textContent('#controls'), /振り/);
  await ctx.close();
});

// ---- 性能: 900 点の draft を再開して updateGauges を測る（CPU 4 倍遅延）----
function draft900() {
  const m = createModel({ profile: 'drum', seed: 2, chargeAt: 30, noise: 0.3 }); const data = { c1: [], c2: [], c3: [] };
  for (let k = 0; k < 930; k++) { const s = m.step({ fire: 2 }); if (k >= 0) s.v.forEach((v, i) => data['c' + (i + 1)].push(Math.round(v * 10))); }
  const ch = [{ key: 'c1', role: 'bt', name: '豆温度', color: '#C2410C', offset: 0 }, { key: 'c2', role: 'et', name: '排気', color: '#0F766E', offset: 0 }, { key: 'c3', role: 'amb', name: '外気温', color: '#6B7280', offset: 0 }];
  // series は投入の 30 秒前（k=0）が start=-30 になるよう、k=0 を t=0-30... ここでは k=0 を t=-30 とみなす（chargeAt=30 なので t=0 が投入）
  return { schema: 2, id: 'rperf', status: 'roasting', beanId: 'b', beanName: '性能', greenWeight: 200, degree: '中煎り', interval: 30, initial: { fire: '強', damper: '閉', rpm: '7' }, current: { fire: '強', damper: '閉', rpm: '7', knob: null }, roasterType: 'drum',
    startedAt: Date.now() - 900 * 1000, dropTime: null, points: [], events: [], changes: [], undo: [], memo: '', source: 'sim', channels: ch, primary: 'c1', series: { dt: 1, start: -30, scale: 10, data }, gaps: [] };
}
test('性能: 900 点のとき updateGauges 1 回（CPU 4 倍遅延）', async () => {
  const d = draft900(); fs.writeFileSync(path.join(root, 'test-results/a2/perf-draft-points.txt'), String(d.series.data.c1.length));
  const { ctx, page } = await open({ settings: SIM('drum', { speed: 1, chargeAfter: 0 }), init: dd => localStorage.setItem('roastlog.draft', JSON.stringify(dd)) });
  // init は文字列化できる関数なので draft を埋め込む
  await ctx.close();
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 900 } }); const p2 = await ctx2.newPage();
  await p2.addInitScript(`localStorage.setItem('roastlog.draft', ${JSON.stringify(JSON.stringify(d))}); localStorage.setItem('roastlog.cache', ${JSON.stringify(JSON.stringify({ roasts: [], beans: [], settings: SIM('drum', { speed: 1, chargeAfter: 0 }) }))});`);
  await p2.goto(APP); await p2.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  await p2.click('[data-action="resume"]'); await p2.waitForTimeout(500);
  const cdp = await ctx2.newCDPSession(p2); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const r = await p2.evaluate(() => {
    const L = window.__roastlog, N = 300, t0 = performance.now(); for (let i = 0; i < N; i++) L.updateGauges(); const ms = (performance.now() - t0) / N;
    const t1 = performance.now(); L.drawLive(true); const draw = performance.now() - t1;
    return { ms, draw, pts: L.S.live.pts.length };
  });
  console.log(`# updateGauges 1回: ${r.ms.toFixed(3)} ms（CPU 4 倍遅延・${r.pts} 点）／ drawLive 1回: ${r.draw.toFixed(1)} ms`);
  assert.ok(r.pts >= 880, `点数 ${r.pts}`); assert.ok(r.ms < 2, `updateGauges ${r.ms} ms`);
  fs.writeFileSync(path.join(root, 'test-results/a2/perf.json'), JSON.stringify(r));
  await ctx2.close();
});

// ---- 容量・壊れた記録・手入力・編集 ----
test('G1: 容量不足で保存に失敗すると、赤いトーストで知らせる（保存成功のトーストは出さない）', async () => {
  const { ctx, page } = await open();
  await page.evaluate(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'roastlog.cache') throw new DOMException('full', 'QuotaExceededError'); return o.call(this, k, v); }; });
  await page.locator('[data-action="go"][data-to="settings"]:visible').first().click();
  await page.locator('[data-action="save-settings"]').click();
  await page.waitForSelector('.toast.err'); assert.match(await page.textContent('.toast.err'), /端末の容量がいっぱいです。書き出してください/);
  assert.equal(await page.locator('.toast:not(.err)').count(), 0);
  await ctx.close();
});
test('G1: localStorage 4MB 超でホームに書き出しの案内', async () => {
  const { ctx, page } = await open({ init: () => localStorage.setItem('roastlog.cache', JSON.stringify({ roasts: [{ id: 'big', beanName: 'x', startedAt: 1, points: [{ t: 0, temp: 100 }], events: [], changes: [], memo: 'x'.repeat(4100000) }], beans: [], settings: null })) });
  assert.match(await page.textContent('#noteBox'), /容量がいっぱいに近づいています/);
  await ctx.close();
});
test('G2: 壊れた記録が 1 件あってもホームは落ちず、ほかの記録を表示する', async () => {
  const good = { id: 'ok', beanName: '正常', startedAt: 1763870000000, dropTime: 60, points: [{ t: 0, temp: 100 }, { t: 30, temp: 90 }, { t: 60, temp: 120 }], events: [], changes: [] };
  const bad = { schema: 2, id: 'bad', beanName: '壊れ', startedAt: 1763870000000, series: { dt: 1, start: 0, scale: 10, data: {} }, channels: [], points: null, events: 'x' };
  const bad2 = { id: 'bad2', beanName: '壊れ2', startedAt: 1, points: [{ t: 0, temp: 1 }], events: [null] };
  const { ctx, page, errors } = await open({ init: `localStorage.setItem('roastlog.cache', ${JSON.stringify(JSON.stringify({ roasts: [good, bad, bad2], beans: [], settings: null }))})` });
  const t = await page.textContent('#historyList'); assert.match(t, /正常/); assert.match(t, /読めない記録/);
  assert.equal(await page.locator('.roast-item').count(), 3);
  assert.deepEqual(errors.filter(e => !/console/.test(e)), []); await ctx.close();
});

test('手入力の焙煎（v1 と同じ操作）→ 保存した記録が schema に合格。手入力は series を持たない', async () => {
  const { ctx, page, errors } = await open({ clock: true });
  await page.click('[data-action="new-roast"]'); await page.fill('#suBeanName', '手入力'); await page.fill('#suGreen', '200');
  assert.equal(await page.isVisible('#suMeas'), false); assert.equal(await page.isVisible('#suIntervalBox'), true);
  await page.click('[data-action="to-roast"]');
  assert.equal(await page.isVisible('#keypad'), true); assert.equal(await page.isVisible('#connRow'), false);
  for (const k of ['2', '0', '0']) await page.click(`[data-k="${k}"]`); await page.click('[data-action="charge"]');
  for (let i = 0; i < 3; i++) { await page.clock.runFor(30000); for (const k of ['1', '8', '0']) await page.click(`[data-k="${k}"]`); await page.click('[data-k="enter"]'); }
  await page.click('[data-ev="tp"]'); await page.click('[data-ev="drop"]'); await page.click('.overlay [data-r="1"]');
  await page.click('[data-action="save-finish"]'); await page.waitForSelector('[data-view="detail"]:not([hidden])');
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('roastlog.cache')).roasts[0]);
  assert.deepEqual(validateRoast(rec), []); assert.equal(rec.source, 'manual'); assert.equal(rec.series, undefined); assert.ok(rec.points.length >= 4);
  assert.deepEqual(errors, []); await ctx.close();
});

test('M2/M4: 取り込みは points:[] でも series から points を作り直す。編集はイベントの auto と未知 type を保持、channels 無しの v2 も補う', async () => {
  const data = { c1: [], c2: [] }; for (let i = 0; i < 400; i++) { data.c1.push(1900 - i); data.c2.push(2400); }
  const rec = { schema: 2, id: 'imp', beanName: '取込', startedAt: 1763880000000, dropTime: 359, source: 'esp32', points: [], events: [{ type: 'tp', t: 80, auto: true }, { type: 'fc1', t: 300 }, { type: 'zzz', t: 5 }, { type: 'drop', t: 359 }], changes: [],
    series: { dt: 1, start: -30, scale: 10, data }, primary: 'c1', memo: '' };   // channels なし
  const dir = fs.mkdtempSync(path.join(root, 'test-results/a2/tmp-')); const f = path.join(dir, 'b.json'); fs.writeFileSync(f, JSON.stringify({ app: 'roastlog', version: 2, roasts: [rec], beans: [] }));
  const { ctx, page } = await open();
  await page.locator('[data-action="go"][data-to="settings"]:visible').first().click();
  await page.setInputFiles('#importFile', f); await page.waitForSelector('.overlay [data-r="1"]'); await page.click('.overlay [data-r="1"]');
  await page.waitForSelector('.toast');
  let saved = await page.evaluate(() => window.__roastlog.S.roasts[0]); assert.ok(saved.points.length > 10 && saved.points.at(-1).t === 359, 'points が作られる（dropTime 含む）');
  await page.locator('[data-action="go"][data-to="home"]:visible').first().click(); await page.click('.roast-item'); await page.waitForSelector('#dStats .stat');
  await page.click('#dEdit summary'); await page.fill('#eOff_c1', '1.5');
  await page.click('[data-action="save-edit"]'); await page.waitForSelector('.toast');
  saved = await page.evaluate(() => window.__roastlog.S.roasts[0]);
  assert.ok(saved.events.find(e => e.type === 'tp').auto === true, 'auto 保持'); assert.ok(saved.events.some(e => e.type === 'zzz'), '未知 type 保持');
  assert.ok(Array.isArray(saved.channels) && saved.channels.length === 2); assert.equal(saved.series.data.c1[0], 1915);
  fs.rmSync(dir, { recursive: true, force: true }); await ctx.close();
});

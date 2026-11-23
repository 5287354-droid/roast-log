// A2: Playwright。シミュレーターで 自動投入 → 自動TP → 1ハゼ → 排出 → 保存 を（ドラム・手網で）通す。
// page.clock で仮想時間を進める。スクリーンショットは test-results/a2/。実行: node --test tools/test/core/a2-ui.test.mjs
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

async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (opts.clock) await page.clock.install({ time: new Date('2026-11-23T09:00:00+09:00') });
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(APP); await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  return { ctx, page, errors };
}
const st = page => page.evaluate(() => { const S = window.__roastlog.S, d = S.draft; return d ? { status: d.status, startedAt: d.startedAt, ev: d.events, n: d.series && d.series.data[d.primary] ? d.series.data[d.primary].length : 0, view: S.view } : { view: S.view }; });
// 仮想時間を進める（ms）。1 回の runFor を細かく刻んで、ゲージ・描画・保存のタイマーも動かす
async function run(page, ms, step = 1000) { for (let t = 0; t < ms; t += step) await page.clock.runFor(Math.min(step, ms - t)); }
async function until(page, fn, label, maxMs = 120000, step = 500) { for (let t = 0; t < maxMs; t += step) { if (await page.evaluate(fn)) return t; await page.clock.runFor(step); } throw new Error('timeout: ' + label); }

async function setSettings(page, { type, speed, chargeAfter }) {
  await page.locator('[data-action="go"][data-to="settings"]:visible').first().click();
  await page.click(`#sType [data-v="${type}"]`); await page.click('#sConn [data-v="sim"]'); await page.click(`#sSimSpeed [data-v="${speed}"]`);
  await page.fill('#sSimCharge', String(chargeAfter));
  await page.locator('#pConn [data-action="save-settings"]').click();
  await page.locator('[data-action="go"][data-to="home"]:visible').first().click();
}

async function fullRoast(type) {
  const { ctx, page, errors } = await open({ clock: true });
  await setSettings(page, { type, speed: 20, chargeAfter: 30 });
  await page.click('[data-action="new-roast"]');
  await page.fill('#suBeanName', `シミュレーター ${type}`); await page.fill('#suGreen', '200');
  assert.equal(await page.inputValue('#suFire'), '強', 'シミュレーターの既定は強');
  // 室温が外気温チャンネル（AMB）から自動で入る
  await run(page, 3000);
  const room = await page.inputValue('#suRoom'); assert.ok(Number(room) > 15 && Number(room) < 30, `室温 ${room}`);
  assert.equal(await page.isVisible('#suMeas'), true);
  assert.ok((await page.textContent('#suChans')).includes('豆温度'), '測定パネルにチャンネル');
  await page.click('[data-action="to-roast"]');
  assert.equal(await page.isVisible('#keypad'), false, '自動測定はテンキーなし');
  // 投入前: プレビュー表示（ready のまま）
  await run(page, 1500);
  assert.equal((await st(page)).status, 'ready');
  assert.match(await page.textContent('#startNote'), /自動で検知/);
  await page.screenshot({ path: path.join(shots, `preview-${type}.png`) });
  // 自動投入
  await until(page, () => !!window.__roastlog.S.draft.startedAt, '自動投入');
  assert.ok(await page.isVisible('.toast'), '検知のトースト');
  assert.match(await page.textContent('.toast'), /投入を検知しました/);
  const truth = await page.evaluate(() => window.__roastlog.Sources.active.truth());
  const sim0 = await st(page);
  assert.equal(sim0.status, 'roasting');
  const chargeT = truth.chargeT;
  // 投入の検知時刻は真値 ±3 秒（モデル秒 = 仮想秒。startedAt はサンプルの epoch）
  const det = await page.evaluate(() => { const d = window.__roastlog.S.draft, sa = d.startedAt; return { startedAt: sa, k: (sa - d.live.base) / 1000, n: d.series.data[d.primary].length }; });
  assert.ok(Math.abs(det.k - chargeT) <= 3, `投入の検知は真値 ±3 秒（検知 ${det.k} / 真値 ${chargeT}）`);
  assert.ok(det.n >= 31, '投入前 30 秒ぶんが series に入る');
  // 自動 TP（ドラムのみ）
  if (type === 'drum') {
    await until(page, () => window.__roastlog.S.draft.events.some(e => e.type === 'tp'), '自動TP', 400000);
    const ev = (await st(page)).ev.find(e => e.type === 'tp');
    assert.equal(ev.auto, true);
    const tr = await page.evaluate(() => window.__roastlog.Sources.active.truth());
    assert.ok(Math.abs(ev.t - (tr.tpT - tr.chargeT)) <= 3, `TP ${ev.t} / 真値 ${tr.tpT - tr.chargeT}`);
    assert.match(await page.textContent('#events'), /中点（自動）/);
  }
  // 1 ハゼ（真値の時刻まで進めてボタン）
  const fc1 = await page.evaluate(() => { const t = window.__roastlog.Sources.active.truth(); return t.fc1T; });
  assert.equal(fc1, null, '投入直後は 1ハゼ前');
  await until(page, () => window.__roastlog.Sources.active.truth().fc1T != null, '1ハゼ', 800000, 1000);
  assert.ok(await page.evaluate(() => { const t = window.__roastlog.Sources.active.truth(); return t.fc1T > t.chargeT; }), '1ハゼは投入のあと');
  await run(page, 2000);
  await page.click('[data-ev="fc1"]');
  await page.screenshot({ path: path.join(shots, `roasting-${type}.png`) });
  const gaugeText = await page.textContent('#gauges'); assert.match(gaugeText, /℃/);
  assert.ok((await page.textContent('#stageBand')).includes('乾燥'), '段階帯');
  assert.ok((await page.textContent('#gChips')).includes('排気'), '2段目チャンネルチップ');
  assert.match(await page.textContent('#connRow'), /受信中/);
  // 1ハゼ終了後の急降下を待ってから排出
  await until(page, () => { const t = window.__roastlog.Sources.active.truth(); return t.fc1eT != null && t.now - t.fc1eT > 70; }, '1ハゼ終了後', 400000, 1000);
  await page.click('[data-ev="drop"]'); await page.click('.overlay [data-r="1"]');
  await page.waitForSelector('[data-view="finish"]:not([hidden])');
  const tiles = await page.textContent('#fStats'); for (const w of type === 'tenami' ? ['150℃ 到達まで', '最大RoR（投入2分以降）', '1ハゼ時温度', '乾燥 / メイラード'] : ['中点温度', '最大RoR', '1ハゼ時温度', '乾燥 / メイラード']) assert.ok(tiles.includes(w), w);
  await page.fill('#fRoasted', '170');
  await page.click('[data-action="save-finish"]');
  await page.waitForSelector('[data-view="detail"]:not([hidden])');
  await run(page, 500);
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('roastlog.cache')).roasts[0]);
  return { ctx, page, errors, rec, truth: await page.evaluate(() => null), type };
}

for (const type of ['drum', 'tenami']) {
  test(`シミュレーター（${type}）: 自動投入 → ${type === 'drum' ? '自動TP → ' : ''}1ハゼ → 排出 → 保存。記録が schema に合格`, async () => {
    const { ctx, page, errors, rec } = await fullRoast(type);
    const errs = validateRoast(rec); assert.deepEqual(errs, [], JSON.stringify(errs).slice(0, 500));
    assert.equal(rec.source, 'sim'); assert.equal(rec.schema, 2); assert.equal(rec.roasterType, type);
    assert.equal(rec.channels.length, 3);
    const types = rec.events.map(e => e.type); assert.ok(types.includes('fc1') && types.includes('drop'));
    if (type === 'drum') assert.ok(rec.events.find(e => e.type === 'tp').auto === true); else assert.ok(!types.includes('tp'), '手網は TP なし');
    assert.equal(rec.series.start, -30);
    const lens = Object.values(rec.series.data).map(a => a.length); assert.ok(lens.every(l => l === lens[0]));
    assert.equal(lens[0], rec.dropTime + 30 + 1, 'series の末尾は dropTime');
    assert.equal(rec.points.at(-1).t, rec.dropTime, 'points に dropTime の点');
    assert.ok(Array.isArray(rec.gaps) && rec.gaps.length === 0, `欠測なし ${JSON.stringify(rec.gaps)}`);
    // 詳細画面
    await page.waitForSelector('#dStats .stat'); await run(page, 500);
    await page.screenshot({ path: path.join(shots, `detail-${type}.png`), fullPage: true });
    assert.equal(await page.locator('#dStats .stat').count(), 12);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

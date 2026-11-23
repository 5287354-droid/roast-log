// A3 / E2E-4: 設定画面（チャンネル・校正・機器）と、センサー診断画面。ESP32 互換サーバー（--speed 20 --profile tenami）につないで確かめる。
// setcfg が送られ、cfg が返って画面に反映される。https（claude.ai）では ESP32 の選択肢が隠れる。スクリーンショットは test-results/a3/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startSim } from '../lib/sim-proc.mjs';

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
async function waitFor(fn, label, ms = 40000, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + label); await sleep(step); } }
async function open(url) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await ctx.newPage(); const errors = [], frames = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|Failed to load resource|fonts/i.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('websocket', ws => { ws.on('framesent', f => { try { frames.push(JSON.parse(f.payload)); } catch {} }); });
  await page.goto(url + '/'); await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  return { ctx, page, errors, frames };
}
const SIMARGS = ['--speed', '20', '--profile', 'tenami', '--charge-at', 'none', '--noise', '0.05', '--outlier-p', '0'];
const live = page => waitFor(() => page.evaluate(() => { const L = window.__roastlog.LV, s = window.__roastlog.Sources.active; return s.id === 'esp32' && !!s.info && !!(L && L.cur); }), '受信');
const go = (page, to) => page.locator(`[data-action="go"][data-to="${to}"]:visible`).first().click();

test('E2E-4: チャンネルの役割と補正を変えると setcfg が送られ、cfg で画面に反映される。機器パネル', { timeout: 90000 }, async () => {
  const srv = await sim(SIMARGS);
  const { ctx, page, errors, frames } = await open(srv.url);
  await go(page, 'settings'); await live(page);
  assert.equal(await page.isVisible('#pDev'), true, '機器パネルは ESP32 のときだけ');
  await waitFor(async () => (await page.textContent('#sConnState')).includes('-55 dBm'), 'RSSI');
  const cs = await page.textContent('#sConnState'); assert.ok(cs.includes('0.0.0-sim') && cs.includes('受信中'), cs);
  assert.equal(await page.isVisible('#sConnEsp'), true);
  assert.equal(await page.inputValue('#chRole2'), 'off', '機器の cfg が反映されている（CH3 は未使用）');
  // CH3 を外気温で使う、CH2 に補正 +1.5
  await page.selectOption('#chRole2', 'amb');
  assert.equal(await page.isChecked('#chEn2'), true); assert.equal(await page.inputValue('#chName2'), '外気温');
  await page.fill('#chOff1', '1.5'); await page.fill('#chName1', '排気（炉）'); await page.fill('#chColor0', '#0f766e');
  await page.locator('#pCh').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(shots, 'settings-channels.png') });
  const n0 = frames.length;
  await page.click('#chSave');
  await waitFor(() => frames.slice(n0).some(f => f.type === 'setcfg'), 'setcfg');
  const sc = frames.slice(n0).find(f => f.type === 'setcfg');
  assert.ok(sc.id && Array.isArray(sc.channels) && sc.channels.length === 3, 'setcfg の形');
  assert.deepEqual(sc.channels.map(c => c.idx), [0, 1, 2]);
  assert.equal(sc.channels[1].offset, 1.5); assert.equal(sc.channels[2].role, 'amb'); assert.equal(sc.channels[2].enabled, true); assert.equal(sc.channels[0].color, '#0f766e');
  await waitFor(async () => (await srv.api('/api/sim/state')).cfg.channels[1].offset === 1.5, '機器が保存');
  const st = await srv.api('/api/sim/state'); assert.equal(st.cfg.channels[2].role, 'amb'); assert.equal(st.cfg.channels[1].name, '排気（炉）');
  // cfg で画面に反映（設定の channels が機器の値になる）
  await waitFor(() => page.evaluate(() => { const c = window.__roastlog.S.settings.channels; return c[1].offset === 1.5 && c[2].role === 'amb' && c[2].enabled && c[1].name === '排気（炉）'; }), '設定に反映');
  assert.equal(await page.inputValue('#chOff1'), '1.5'); assert.equal(await page.inputValue('#chName1'), '排気（炉）');
  await waitFor(async () => /\d+\.\d℃/.test(await page.textContent('#chCur2')), 'CH3 の現在値');
  assert.match(await page.textContent('#chPrimary'), /CH1/);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('roastlog.cache')).settings.channels[1].offset), 1.5, '設定は保存される');
  // 機器: 60Hz・identify・リンク
  await page.locator('#pDev').scrollIntoViewIfNeeded();
  await page.click('#sMains [data-v="60"]'); await page.click('#sAvg [data-v="8"]');
  const n1 = frames.length; await page.click('[data-action="save-device"]');
  await waitFor(() => frames.slice(n1).some(f => f.type === 'setcfg' && f.amp && f.amp.mains === 60 && f.amp.avg === 8), 'setcfg(amp)');
  await waitFor(async () => { const s = await srv.api('/api/sim/state'); return s.cfg.amp.mains === 60 && s.cfg.amp.avg === 8; }, '機器の amp');
  await page.click('#pDev [data-action="dev-identify"]');
  await waitFor(async () => (await srv.api('/api/sim/state')).identifyCount >= 1, 'identify');
  assert.ok(frames.some(f => f.type === 'identify' && f.id));
  assert.equal(await page.getAttribute('#devWifi', 'href'), '/wifi'); assert.equal(await page.getAttribute('#devUpdate', 'href'), '/update');
  await page.screenshot({ path: path.join(shots, 'settings-device.png') });
  assert.deepEqual(errors, []); await ctx.close();
});

test('E2E-4: 校正（氷水・沸騰水・基準温度計）。10 秒平均、標準偏差 < 0.2 を確かめてから補正値を保存', { timeout: 90000 }, async () => {
  const srv = await sim(SIMARGS);
  const { ctx, page, errors, frames } = await open(srv.url);
  await go(page, 'settings'); await live(page);
  await page.selectOption('#chRole2', 'amb'); await page.click('#chSave'); await waitFor(async () => (await srv.api('/api/sim/state')).cfg.channels[2].enabled, 'CH3 を使う');
  await waitFor(() => page.evaluate(() => window.__roastlog.LV.cur && window.__roastlog.LV.cur.raw[2] != null), 'CH3 の値');
  await page.selectOption('#calCh', '2');
  await page.click('#calRef [data-v="ice"]'); assert.match(await page.textContent('#calTarget'), /基準: 0℃/);
  await page.click('#calRef [data-v="boil"]'); await page.fill('#calAlt', '500'); assert.match(await page.textContent('#calTarget'), /98\.35℃/);
  // 基準温度計 21.0℃。温度の途中でつまんで、ばらつくときは補正値を出さない
  await page.click('#calRef [data-v="thermo"]'); await page.fill('#calThermo', '21.0');
  await page.click('#calStart'); await srv.api('/api/sim/pinch?ch=c3&delta=12&sec=40');
  await waitFor(async () => (await page.textContent('#calOut')).includes('ばらつき'), '不安定の判定');
  assert.equal(await page.locator('[data-action="cal-apply"]').count(), 0, '不安定なら保存できない');
  await sleep(4000);
  const n0 = frames.length;
  await waitFor(async () => { const t = (await srv.api('/api/sim/state')); return true; }, 'x');
  await page.click('#calStart'); assert.match(await page.textContent('#calOut'), /測定中/);
  await page.locator('#pCal').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(shots, 'calibration-measuring.png') });
  await waitFor(async () => (await page.textContent('#calOut')).includes('標準偏差'), '測定の結果');
  const out = await page.textContent('#calOut'); assert.ok(out.includes('安定'), out);
  const sd = +out.match(/標準偏差(\d\.\d\d)/)[1]; assert.ok(sd < 0.2, 'SD ' + sd);
  const mean = +out.match(/平均(-?\d+\.\d)/)[1], off = +out.match(/補正値([+-]?\d+\.\d)/)[1];
  assert.ok(Math.abs(off - (21 - mean)) <= 0.11, `補正値 ${off} = 21 - ${mean}`);
  await page.screenshot({ path: path.join(shots, 'calibration.png') });
  await page.click('[data-action="cal-apply"]');
  await waitFor(() => frames.slice(n0).some(f => f.type === 'setcfg' && f.channels.length === 1 && f.channels[0].idx === 2 && Math.abs(f.channels[0].offset - off) < 1e-9), 'setcfg(offset)');
  await waitFor(async () => Math.abs((await srv.api('/api/sim/state')).cfg.channels[2].offset - off) < 0.01, '機器の補正値');
  // 補正のあと、現在値は基準（21.0℃）に合う
  await waitFor(async () => { const t = await page.textContent('#chCur2'); const v = parseFloat(t); return Math.abs(v - 21) < 0.4; }, '補正後の値が 21℃');
  assert.deepEqual(errors, []); await ctx.close();
});

test('センサー診断: つまむと光る・別の CH が反応したら案内・断線の表示・未使用の CH を有効に・機器を光らせる', { timeout: 90000 }, async () => {
  const srv = await sim(['--speed', '20', '--profile', 'drum', '--charge-at', 'none', '--noise', '0.05', '--outlier-p', '0']); // 温度が落ち着いた予熱後の状態
  const { ctx, page, errors, frames } = await open(srv.url);
  await go(page, 'diag'); await live(page);
  assert.ok((await page.textContent('[data-view="diag"]')).includes('指でつまむ'), '手順を案内する');
  assert.equal(await page.locator('.dg-card').count(), 3);
  await waitFor(async () => (await srv.api('/api/sim/state')).virtualSec > 500, '落ち着くまで', 60000);
  await waitFor(async () => /\d+\.\d/.test(await page.textContent('#dgVal0')) && /\d+\.\d/.test(await page.textContent('#dgCjVal')), '値と冷接点温度');
  assert.match(await page.textContent('#dgCard2'), /未使用/);
  assert.equal(await page.getAttribute('#dgCard0', 'data-lit'), '0');
  await page.screenshot({ path: path.join(shots, 'diag-idle.png'), fullPage: true });
  // CH1 をつまむ → CH1 のカードが光る
  await srv.api('/api/sim/pinch?ch=c1&delta=6&sec=12');
  await waitFor(async () => (await page.getAttribute('#dgCard0', 'data-lit')) === '1', 'CH1 が光る');
  assert.equal(await page.getAttribute('#dgCard1', 'data-lit'), '0', await page.textContent('#dgCards'));
  await page.screenshot({ path: path.join(shots, 'diag-lit.png'), fullPage: true });
  await sleep(2500);
  // 「CH2 をつまんで確認」→ CH1 が反応（配線ミス）
  await waitFor(async () => (await page.getAttribute('#dgCard0', 'data-lit')) === '0', '光が消える', 20000);
  await page.click('[data-action="dg-test"][data-i="1"]');
  assert.match(await page.textContent('#dgCard1'), /指でつまんで/);
  await sleep(1500); await srv.api('/api/sim/pinch?ch=c1&delta=8&sec=15');
  await waitFor(async () => (await page.textContent('#dgFinds')).includes('CH2 ではなく CH1'), '入れ替わりの案内', 20000);
  assert.match(await page.textContent('#dgRes1'), /CH2 ではなく CH1 が反応/);
  await page.screenshot({ path: path.join(shots, 'diag-wrong-channel.png'), fullPage: true });
  // 断線
  await srv.api('/api/sim/fault?ch=c1&kind=open&sec=30');
  await waitFor(async () => (await page.textContent('#dgVal0')).includes('断線'), '断線の表示');
  assert.match(await page.textContent('#dgFinds'), /CH1: 断線（F1）.*端子/); assert.match(await page.getAttribute('#dgCard0', 'class'), /bad/);
  await page.screenshot({ path: path.join(shots, 'diag-fault.png'), fullPage: true });
  // 未使用の CH3 を有効にして診断する
  await page.click('[data-action="dg-enable"][data-i="2"]');
  await waitFor(async () => (await srv.api('/api/sim/state')).cfg.channels[2].enabled, 'CH3 を有効に');
  await waitFor(async () => !(await page.textContent('#dgCard2')).includes('未使用'), '診断に出る');
  // 機器を光らせる
  await page.click('[data-view="diag"] [data-action="dev-identify"]');
  await waitFor(async () => (await srv.api('/api/sim/state')).identifyCount >= 1, 'identify');
  assert.ok(frames.some(f => f.type === 'identify'));
  assert.deepEqual(errors, []); await ctx.close();
});

test('段階帯: 黄色化なしは BT 150℃ 到達を推定で薄く表示 → 押すと押した時刻。手網の RoR 窓は設定画面を通して 60 秒。ET の RoR', { timeout: 120000 }, async () => {
  const srv = await sim(['--speed', '20', '--profile', 'tenami', '--charge-at', 'none', '--noise', '0.2', '--outlier-p', '0']);
  const { ctx, page, errors } = await open(srv.url);
  await go(page, 'settings'); await live(page);
  // 設定画面から手網にする（窓は種類で 60 秒になる）。ET の RoR も表示。推定温度を 120℃ に
  await page.click('#sType [data-v="tenami"]');
  assert.equal(await page.evaluate(() => document.querySelector('#sRorAuto .on').dataset.v), '60');
  await page.check('#sShowEt'); await page.fill('#sDryTemp', '120');
  await page.locator('#pAuto [data-action="save-settings"]').click();
  await go(page, 'home'); await page.click('[data-action="new-roast"]');
  await page.fill('#suBeanName', '手網 ESP32'); await page.fill('#suGreen', '100');
  await waitFor(() => page.evaluate(() => !!window.__roastlog.Sources.active.info), 'hello'); await sleep(2500);
  await page.click('[data-action="to-roast"]'); await sleep(1200);
  await srv.api('/api/sim/charge');
  await waitFor(() => page.evaluate(() => !!(window.__roastlog.S.draft && window.__roastlog.S.draft.startedAt)), '投入', 40000);
  assert.equal(await page.evaluate(() => window.__roastlog.S.live.R.W), 60, '手網の RoR 窓は 60 秒（設定画面を通して）');
  await waitFor(() => page.evaluate(() => window.__roastlog.S.live.ptsE.length > 5), 'ET の RoR');
  await waitFor(async () => /RoR/.test(await page.textContent('#gChips')), 'ET チップの RoR', 20000);
  // BT が 120℃ に着くまで
  await waitFor(async () => (await page.textContent('#stageBand')).includes('推定'), '乾燥の終わりの推定', 100000, 200);
  const est = await page.evaluate(() => window.__roastlog.S.live.dryEst); assert.ok(est > 0);
  assert.match(await page.textContent('#stageBand'), /120℃ 到達で推定/);
  assert.equal(await page.locator('#stageBand i.est').count() >= 1, true);
  await page.screenshot({ path: path.join(shots, 'stage-estimate.png') });
  await page.click('[data-ev="dry"]');
  await sleep(600);
  assert.ok(!(await page.textContent('#stageBand')).includes('推定'), '黄色化を押したら押した時刻を使う');
  assert.equal(await page.locator('#stageBand i.est').count(), 0);
  const dry = await page.evaluate(() => window.__roastlog.S.draft.events.find(e => e.type === 'dry').t); assert.ok(dry >= est);
  // 1ハゼだけ押しても帯がおかしくならない（別の焙煎: 黄色化なしで 1ハゼ）— ここでは帯の乾燥の幅が 1ハゼまでになる
  assert.deepEqual(errors, []); await ctx.close();
});

test('https（claude.ai 版）では ESP32 の選択肢が隠れ、案内が出る。自動は手入力になる', async () => {
  const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } }); const page = await ctx.newPage();
  await page.route('https://roastlog.test/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto('https://roastlog.test/'); await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  await page.locator('[data-action="go"][data-to="settings"]:visible').first().click();
  assert.equal(await page.isVisible('#sConnEsp'), false); assert.equal(await page.isVisible('#sHttpsNote'), true); assert.match(await page.textContent('#sHttpsNote'), /claude\.ai 版では ESP32 に接続できません/);
  assert.equal(await page.evaluate(() => window.__roastlog.Sources.resolve('esp32')), 'manual');
  assert.equal(await page.evaluate(() => window.__roastlog.Sources.resolve('auto')), 'manual');
  assert.equal(await page.isVisible('#pDev'), false);
  await ctx.close();
});

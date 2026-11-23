// 工兵一番隊: 監察第4回（アプリ）の指摘への対応の試験。ESP32 互換サーバー（--speed 20）につないで確かめる。
//   中-A1 RoR ゲージ（中点なしでも 90 秒で出る） / 中-A2 排出待ち（bf_req で求めて返事を待つ） / 軽-A3 despike / 軽-A5 stale / 軽-A6 排出待ちの再読み込み / A7 ota
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startSim } from '../lib/sim-proc.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
let browser; const sims = [];
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); await Promise.all(sims.map(s => s.stop())); });
const sim = async args => { const s = await startSim(args); sims.push(s); return s; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, label, ms = 40000, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + label); await sleep(step); } }
const BASE = ['--speed', '20', '--charge-at', 'none', '--noise', '0.2', '--outlier-p', '0'];

async function open(url) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 1 });
  const errors = [], frames = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('websocket', ws => ws.on('framesent', f => { try { frames.push(JSON.parse(f.payload)); } catch {} }));
  await page.goto(url + '/'); await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  return { ctx, page, errors, frames };
}
const D = page => page.evaluate(() => { const S = window.__roastlog.S, d = S.draft; return d ? { status: d.status, sa: d.startedAt, n: d.series ? d.series.data[d.primary].length : 0, gaps: d.gaps, start: d.series && d.series.start, c1: d.series && d.series.data.c1, c2: d.series && d.series.data.c2, lastT: S.live && S.live.lastT, drop: d.dropTime, dp: d.dropPending, dws: d.dropWaitStart } : null; });
async function startRoast(page, srv, name = 'x') {
  await page.click('[data-action="new-roast"]');
  await page.fill('#suBeanName', name); await page.fill('#suGreen', '200');
  await waitFor(() => page.evaluate(() => !!window.__roastlog.Sources.active.info), 'hello');
  await page.click('[data-action="to-roast"]'); await page.waitForSelector('[data-view="roast"]:not([hidden])');
  await sleep(1500); await srv.api('/api/sim/charge');
  await waitFor(async () => (await D(page)).sa != null, '投入', 30000);
}
const holes = (d, key, end) => { const a = d[key], f = a.findIndex(x => x != null), out = []; for (let i = f; i < end; i++) { const t = d.start + i; if (a[i] == null && !(d.gaps || []).some(g => t >= g.from && t <= g.to)) out.push(t); } return out; };
const core = () => {
  const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
  const ctx = { window: {} }; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(html.slice(html.indexOf('// @core-begin'), html.indexOf('// @core-end')), ctx);
  return ctx.window.RoastCore;
};

test('軽-A3: despike は 2 点だけの外れ値を本物として採用しない（213,213 → 202）。本物の段差は従来どおり', () => {
  const C = core();
  const run = (xs, J = 12) => { const p = [], st = { pend: [] }, out = [], back = []; xs.forEach((x, k) => { out.push(C.despike(p, x, st, J, 100 + k)); back.push(st.confirmed ? { v: [...st.confirmed], tags: [...st.confirmedTags] } : null); st.confirmed = null; st.confirmedTags = null; }); return { out, back }; };
  const base = n => Array.from({ length: n }, () => 200);
  { const v = base(14); v[6] = 213; v[7] = 213; v[8] = 202; const r = run(v); assert.deepEqual(r.out.slice(6, 9), [null, null, 202]); assert.equal(r.back[8], null, '外れ値は返さない'); }
  { const v = base(14); v[6] = 185; v[7] = 175; v[8] = 172; v[9] = 171; const r = run(v); assert.equal(r.out[8], 172); assert.deepEqual(r.back[8].v, [185, 175], '3 点続けば本物'); assert.deepEqual(r.back[8].tags, [106, 107], '保留した値の seq（目印）を返す'); }
  { const v = base(14); for (let k = 6; k < 14; k++) v[k] = 160; const r = run(v); assert.equal(r.out[8], 160); assert.deepEqual(r.back[8].v, [160, 160]); }
  { const v = base(14); v[6] = 240; const r = run(v); assert.equal(r.out[6], null); assert.equal(r.back[7], null); }
});

test('軽-A3: 保留した値の書き戻し位置は seq に合わせる（途中に故障サンプルがあってもずれない）', async () => {
  const srv = await sim(BASE);
  const { ctx, page, errors } = await open(srv.url);
  await startRoast(page, srv, 'seq');
  await waitFor(async () => (await D(page)).lastT > 40, 't>40', 30000);
  // 機器からの受信を止め（以後のサンプルは来ない）、アプリの onSample に、故障をはさんだ跳びを直接流す
  await page.evaluate(() => window.__roastlog.Sources.active.disconnect());
  const r = await page.evaluate(() => {
    const W = window.__roastlog, LV = W.LV, S = W.S, d = S.draft, start = d.series.start;
    const seq0 = LV.sq.seq, boot = LV.sq.boot, ep0 = LV.cur.epoch, X = LV.cur.v[0];
    const t0 = S.live.lastT;
    const mk = (k, v, f) => ({ seq: seq0 + k, boot, epoch: ep0 + k * 1000, v: [v, 20, 20], f: [f, 0, 0], cj: 25, backfill: false });
    for (let k = 1; k <= 6; k++) W.onSample(mk(k, X, 0));
    W.onSample(mk(7, X + 30, 0));       // 保留 1
    W.onSample(mk(8, null, 1));         // 故障（despike を通らない）
    W.onSample(mk(9, X + 30, 0));       // 保留 2
    W.onSample(mk(10, X + 30, 0));      // 3 点目: 本物と確定 → seq7, seq9 を書き戻す
    const a = d.series.data.c1, at = k => a[t0 + k - start];
    return { X, v6: at(6), v7: at(7), v8: at(8), v9: at(9), v10: at(10) };
  });
  assert.equal(r.v7, Math.round((r.X + 30) * 10), 'seq7 の位置に戻る');
  assert.equal(r.v8, null, '故障の秒は null のまま（ずれて埋まらない）');
  assert.equal(r.v9, Math.round((r.X + 30) * 10), 'seq9 の位置');
  assert.equal(r.v10, Math.round((r.X + 30) * 10));
  assert.deepEqual(errors, []); await ctx.close();
});

test('中-A1: ドラムで中点が無くても、投入から 90 秒たったら RoR ゲージを出す（自動の中点オフ）。それまでは「—」', { timeout: 120000 }, async () => {
  const srv = await sim([...BASE, '--speed', '30']);
  const { ctx, page, errors } = await open(srv.url);
  await page.locator('[data-action="go"][data-to="settings"]:visible').first().click();
  await page.uncheck('#sAutoTP'); await page.click('#sSaveAll');
  await page.locator('[data-action="go"][data-to="home"]:visible').first().click();
  await startRoast(page, srv, 'notp');
  await waitFor(async () => (await D(page)).lastT >= 30, 't>=30', 30000);
  assert.equal((await page.textContent('#gRor')).trim(), '—'); assert.match(await page.textContent('#gRorNote'), /中点のあと表示/);
  await waitFor(async () => (await D(page)).lastT >= 95, 't>=95', 30000);
  const ev = await page.evaluate(() => window.__roastlog.S.draft.events.map(e => e.type)); assert.ok(!ev.includes('tp'), '中点は無い');
  const v = (await page.textContent('#gRor')).trim(); assert.notEqual(v, '—', 'RoR が出る'); assert.ok(Number.isFinite(Number(v)), v);
  assert.doesNotMatch(await page.textContent('#gRorNote'), /中点のあと表示/);
  assert.deepEqual(errors, []); await ctx.close();
});

test('中-A2: --bf-delay 4000 でも、切断中の排出は bf_req で求めて返事を待ち、欠測 0 で終わる（2.5 秒で打ち切らない）', { timeout: 120000 }, async () => {
  const srv = await sim([...BASE, '--bf-delay', '4000']);
  const { ctx, page, errors, frames } = await open(srv.url);
  await startRoast(page, srv, 'bfdelay');
  await waitFor(async () => (await D(page)).lastT > 150, 't>150', 40000);
  await srv.api('/api/sim/disconnect?sec=30');   // 実時間 1.5 秒
  await waitFor(async () => (await page.textContent('#connRow')).includes('再接続'), '切断を検知');
  await page.click('[data-ev="drop"]'); await page.click('.overlay [data-r="1"]');
  const n0 = frames.length;
  await page.waitForSelector('[data-view="finish"]:not([hidden])', { timeout: 25000 });
  const d = await D(page);
  assert.ok(frames.slice(n0).some(f => f.type === 'bf_req'), '欠けている範囲を bf_req で求めた: ' + JSON.stringify(frames.slice(n0).map(f => f.type)));
  assert.deepEqual(d.gaps, [], '欠測 0');
  assert.deepEqual(holes(d, 'c1', d.n), []); assert.notEqual(d.c1[d.n - 1], null);
  assert.deepEqual(errors, []); await ctx.close();
});

test('軽-A6: 排出待ちの再読み込みで 15 秒を数え直さない（開始時刻を下書きに保存）。待っている間のタップには知らせる', { timeout: 120000 }, async () => {
  const srv = await sim(BASE);
  const { ctx, page, errors } = await open(srv.url);
  await startRoast(page, srv, 'reload');
  await waitFor(async () => (await D(page)).lastT > 100, 't>100', 40000);
  await srv.api('/api/sim/disconnect?sec=900');
  await waitFor(async () => (await page.textContent('#connRow')).includes('再接続'), '切断を検知');
  await page.click('[data-ev="drop"]'); await page.click('.overlay [data-r="1"]');
  await page.waitForSelector('#flowBanner [data-fb="dropwait"]', { timeout: 5000 });
  const d1 = await D(page); assert.ok(d1.dws > 0, '開始時刻が下書きにある');
  await page.click('[data-ev="drop"]', { force: true }).catch(() => {});
  await waitFor(async () => /受け取り中/.test(await page.locator('.toast').allTextContents().then(a => a.join('|'))), '受け取り中の案内', 3000);
  await sleep(9000);
  await page.reload(); await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  await page.click('[data-action="resume"]');
  const t0 = Date.now();
  await page.waitForSelector('[data-view="finish"]:not([hidden])', { timeout: 20000 });
  const took = Date.now() - t0; assert.ok(took < 9000, `残りは 15-約10=約5 秒: ${took}ms`);
  assert.deepEqual(errors, []); await ctx.close();
});

test('軽-A5: stale のとき書きかけのフォームを捨てない（差分を最新の cfg の上に載せ直し、もう一度確認を促す）。ack.rev を CfgS に入れる', { timeout: 120000 }, async () => {
  const srv = await sim(BASE);
  const { ctx, page, errors, frames } = await open(srv.url);
  await page.locator('[data-action="go"][data-to="settings"]:visible').first().click();
  await waitFor(() => page.evaluate(() => { const s = window.__roastlog.Sources.active; return s.id === 'esp32' && !!s.info; }), 'hello');
  const { WebSocket } = require('ws');
  const other = new WebSocket(srv.url.replace('http', 'ws') + '/ws'); const om = [];
  other.on('message', r => om.push(JSON.parse(r.toString())));
  await new Promise(r => other.on('open', r)); other.send(JSON.stringify({ type: 'hi', app: 'x', ver: 't' }));
  const rev0 = (await waitFor(() => om.find(m => m.type === 'hello'), 'other hello')).cfg.rev;
  await page.fill('#chName0', 'BT-A');
  other.send(JSON.stringify({ type: 'setcfg', id: 'b1', baseRev: rev0, channels: [{ idx: 1, offset: -2.5 }] }));
  await waitFor(() => om.find(m => m.type === 'ack' && m.id === 'b1' && m.ok), 'B');
  await page.waitForSelector('#chConflict:not([hidden])');
  await page.click('#chSave');
  await waitFor(async () => /保存しませんでした/.test(await page.textContent('.toast.err')), 'stale');
  assert.equal(await page.inputValue('#chName0'), 'BT-A', '書きかけは残る');
  assert.equal(await page.inputValue('#chOff1'), '-2.5', '最新の cfg の上に載る');
  assert.equal(await page.isVisible('#chConflict'), true, '確かめるよう促す');
  assert.equal(await page.evaluate(() => window.__roastlog.CfgS.rev), rev0 + 1, 'CfgS.rev は最新');
  const n1 = frames.length; await page.click('#chSave');
  await waitFor(async () => (await srv.api('/api/sim/state')).cfg.channels[0].name === 'BT-A', '2 回目は保存できる');
  assert.equal(frames.slice(n1).find(f => f.type === 'setcfg').baseRev, rev0 + 1);
  assert.equal((await srv.api('/api/sim/state')).cfg.channels[1].offset, -2.5);
  await waitFor(() => page.evaluate(r => window.__roastlog.CfgS.rev === r, rev0 + 2), '成功の ack の rev も入る', 3000);
  other.close(); assert.deepEqual(errors, []); await ctx.close();
});

test('A7: /api/info の ota が true でない機器では「ファームウェア更新」を隠す', { timeout: 60000 }, async () => {
  const srv = await sim(BASE);
  assert.equal((await srv.api('/api/info')).ota, false);
  const { ctx, page, errors } = await open(srv.url);
  await page.locator('[data-action="go"][data-to="settings"]:visible').first().click();
  await waitFor(() => page.evaluate(() => !!window.__roastlog.Sources.active.info), 'hello'); await sleep(500);
  assert.equal(await page.isVisible('#devWifi'), true);
  assert.equal(await page.isHidden('#devUpdate'), true);
  await page.evaluate(() => { window.__roastlog.S.device = { ...(window.__roastlog.S.device || {}), ota: true }; window.__roastlog.Sources.active.dev = { ...(window.__roastlog.Sources.active.dev || {}) }; });
  await page.evaluate(() => document.querySelector('[data-action="go"][data-to="home"]').click());
  await page.locator('[data-action="go"][data-to="settings"]:visible').first().click(); await sleep(500);
  assert.equal(await page.isVisible('#devUpdate'), true, 'ota:true なら出る');
  assert.deepEqual(errors, []); await ctx.close();
});

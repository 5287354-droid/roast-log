// A3 監察（第3回）の指摘への対応の試験。ESP32 互換サーバー（--speed 20）につないで確かめる。スクリーンショットは test-results/a3fix/
//   重-1 切断中の排出 / 中-1 中点の取り消しと再読み込み / 中-3 setcfg 競合 / 中-7 s が bf より先 / 中-2 複数タブ /
//   中-4 RoR ゲージ / 中-5 バナー / 中-6 診断（室温・お湯・線の色） / 手網の排出案内 / 軽（https・file://・校正・文字切れ）
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
const { WebSocket } = require('ws');
const shots = path.join(root, 'test-results/a3fix'); fs.mkdirSync(shots, { recursive: true });
let browser; const sims = [];
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); await Promise.all(sims.map(s => s.stop())); });
const sim = async args => { const s = await startSim(args); sims.push(s); return s; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, label, ms = 40000, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + label); await sleep(step); } }
const BASE = ['--speed', '20', '--charge-at', 'none', '--noise', '0.2', '--outlier-p', '0'];

async function newPage(ctx, url, errors, frames, recv) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|Failed to load resource|fonts/i.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('websocket', ws => {
    ws.on('framesent', f => { try { frames.push(JSON.parse(f.payload)); } catch {} });
    ws.on('framereceived', f => { try { recv.push(JSON.parse(f.payload)); } catch {} });
  });
  await page.goto(url + '/'); await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  return page;
}
async function open(url) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const errors = [], frames = [], recv = [];
  const page = await newPage(ctx, url, errors, frames, recv);
  return { ctx, page, errors, frames, recv, more: () => newPage(ctx, url, errors, frames, recv) };
}
const D = page => page.evaluate(() => { const S = window.__roastlog.S, d = S.draft; return d ? { status: d.status, sa: d.startedAt, n: d.series ? d.series.data[d.primary].length : 0, gaps: d.gaps, start: d.series && d.series.start, c1: d.series && d.series.data.c1, c2: d.series && d.series.data.c2, ev: d.events, lastT: S.live && S.live.lastT, drop: d.dropTime, clk: d.clk, noAutoTp: d.noAutoTp, tab: d.tab, ro: !!S.ro } : null; });
async function startRoast(page, srv, name = 'x') {
  await page.click('[data-action="new-roast"]');
  await page.fill('#suBeanName', name); await page.fill('#suGreen', '200');
  await waitFor(() => page.evaluate(() => !!window.__roastlog.Sources.active.info), 'hello');
  await page.click('[data-action="to-roast"]'); await page.waitForSelector('[data-view="roast"]:not([hidden])');
  await sleep(1500); await srv.api('/api/sim/charge');
  await waitFor(async () => (await D(page)).sa != null, '投入', 30000);
}
const firstNN = a => a.findIndex(x => x != null);
// 最初の値が来た秒から end まで、gaps の外にある null の秒（本当の欠損）を数える
const holes = (d, key, end) => { const a = d[key], f = firstNN(a), out = []; for (let i = f; i < (end == null ? a.length : end); i++) { const t = d.start + i; if (a[i] == null && !(d.gaps || []).some(g => t >= g.from && t <= g.to)) out.push(t); } return out; };

test('重-1: 切断中に排出 → 機器から残りを受け取り、タップした時点まで埋まる（捨てない）', { timeout: 120000 }, async () => {
  const srv = await sim(BASE);
  const { ctx, page, errors } = await open(srv.url);
  await startRoast(page, srv, '切断中の排出');
  await waitFor(async () => (await D(page)).lastT > 200, 't>200', 40000);
  const before = (await D(page)).lastT;
  await srv.api('/api/sim/disconnect?sec=60');
  await waitFor(async () => (await page.textContent('#connRow')).includes('再接続'), '切断を検知');
  await sleep(900); // 仮想で約 18 秒、切れたまま
  const tr = await srv.api('/api/sim/truth'); const devT = tr.seq - tr.chargeT;
  assert.ok(devT > before + 10, `切断中に機器の時刻は進んでいる ${devT} / ${before}`);
  await page.click('[data-ev="drop"]'); await page.click('.overlay [data-r="1"]');
  const tr2 = await srv.api('/api/sim/truth'); const devT2 = tr2.seq - tr2.chargeT;
  await page.waitForSelector('#flowBanner [data-fb="dropwait"]', { timeout: 5000 });
  assert.match(await page.textContent('#flowBanner'), /機器から残りを受け取っています/);
  assert.equal((await D(page)).status, 'roasting', '待っている間は終わらせない');
  await page.screenshot({ path: path.join(shots, 'drop-wait-banner.png') });
  await page.waitForSelector('[data-view="finish"]:not([hidden])', { timeout: 25000 });
  const d = await D(page);
  assert.ok(d.drop >= devT - 2 && d.drop <= devT2 + 3, `排出の時刻はタップした時点 ${d.drop}（機器 ${devT}〜${devT2}）。最後に受け取った ${before} ではない`);
  assert.equal(d.n, d.drop - d.start + 1, 'series は dropTime まで');
  assert.deepEqual(holes(d, 'c1', d.n), [], '切断中の分もバックフィルで埋まり、欠損なし');
  assert.deepEqual(holes(d, 'c2', d.n), []);
  assert.deepEqual(d.gaps, [], 'gaps なし（全部受け取れた）');
  assert.notEqual(d.c1[d.n - 1], null, '排出の秒の温度が残る');
  await page.screenshot({ path: path.join(shots, 'drop-during-disconnect-finish.png') });
  assert.deepEqual(errors, []); await ctx.close();
});

test('重-1: 15 秒たっても受け取れなかった分は gaps に入る（排出の時刻はタップした時点のまま）', { timeout: 120000 }, async () => {
  const srv = await sim(BASE);
  const { ctx, page, errors } = await open(srv.url);
  await startRoast(page, srv, '長い切断');
  await waitFor(async () => (await D(page)).lastT > 120, 't>120', 40000);
  const last = (await D(page)).lastT;
  await srv.api('/api/sim/disconnect?sec=900');   // 実時間で 45 秒切れたまま
  await waitFor(async () => (await page.textContent('#connRow')).includes('再接続'), '切断を検知');
  await sleep(700);
  await page.click('[data-ev="drop"]'); await page.click('.overlay [data-r="1"]');
  await page.waitForSelector('#flowBanner [data-fb="dropwait"]', { timeout: 5000 });
  const t0 = Date.now();
  await page.waitForSelector('[data-view="finish"]:not([hidden])', { timeout: 25000 });
  const waited = Date.now() - t0; assert.ok(waited >= 12000 && waited <= 20000, `最大 15 秒待つ: ${waited}ms`);
  const d = await D(page);
  assert.ok(d.drop > last + 8, `タップした時点 ${d.drop} > 最後に受け取った ${last}`);
  assert.equal(d.n, d.drop - d.start + 1);
  const g = d.gaps[d.gaps.length - 1]; assert.ok(g && g.from === last + 1 && g.to === d.drop, `末尾の欠測が gaps に入る: ${JSON.stringify(d.gaps)}（最後 ${last}）`);
  assert.deepEqual(holes(d, 'c1', d.n), [], 'gaps の外に欠損なし');
  assert.deepEqual(errors, []); await ctx.close();
});

test('中-1: 取り消した自動の中点は、バックフィルの組み直しでも再読み込みでも戻らない', { timeout: 120000 }, async () => {
  const srv = await sim(BASE);
  const { ctx, page, errors } = await open(srv.url);
  await startRoast(page, srv, '中点の取り消し');
  await waitFor(async () => (await D(page)).ev.some(e => e.type === 'tp'), '自動の中点', 60000);
  await page.click('[data-action="undo"]'); await sleep(300);
  let d = await D(page); assert.ok(!d.ev.some(e => e.type === 'tp') && d.noAutoTp === true, '取り消した');
  // 切断 → バックフィルで穴が埋まる（rebuildLive の経路）
  await srv.api('/api/sim/disconnect?sec=30'); await sleep(500);
  await waitFor(async () => (await page.textContent('#connRow')).includes('再接続'), '切断');
  await waitFor(async () => (await page.textContent('#connRow')).includes('受信中'), '再接続', 30000); await sleep(1500);
  d = await D(page); assert.ok(!d.ev.some(e => e.type === 'tp'), 'バックフィルのあとも戻らない: ' + JSON.stringify(d.ev));
  assert.equal(await page.evaluate(() => window.__roastlog.S.live.T.none), true);
  // 再読み込み → 続ける
  await page.reload(); await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  await page.click('[data-action="resume"]'); await sleep(2000);
  d = await D(page); assert.ok(!d.ev.some(e => e.type === 'tp'), '再読み込みのあとも戻らない: ' + JSON.stringify(d.ev)); assert.equal(d.noAutoTp, true);
  assert.equal(await page.evaluate(() => window.__roastlog.S.live.T.none), true);
  await sleep(1500); d = await D(page); assert.ok(!d.ev.some(e => e.type === 'tp'), '続けても自動の中点は出ない');
  // 手動の中点は押せる
  await page.click('[data-ev="tp"]'); d = await D(page); assert.ok(d.ev.some(e => e.type === 'tp' && !e.auto), '手動の中点');
  assert.deepEqual(errors, []); await ctx.close();
});

test('中-3: setcfg は baseRev つきの差分。ほかの端末が先に変えたら stale で保存せず、読み直す。焙煎中の補正値の変更は警告', { timeout: 120000 }, async () => {
  const srv = await sim(BASE);
  const { ctx, page, errors, frames } = await open(srv.url);
  await page.locator('[data-action="go"][data-to="settings"]:visible').first().click();
  await waitFor(() => page.evaluate(() => { const s = window.__roastlog.Sources.active; return s.id === 'esp32' && !!s.info; }), 'hello');
  // 「ほかの端末」: 別の WebSocket
  const other = new WebSocket(srv.url.replace('http', 'ws') + '/ws'); const om = [];
  other.on('message', r => om.push(JSON.parse(r.toString())));
  await new Promise(r => other.on('open', r)); other.send(JSON.stringify({ type: 'hi', app: 'x', ver: 't' }));
  await waitFor(() => om.find(m => m.type === 'hello'), 'other hello');
  const rev0 = om.find(m => m.type === 'hello').cfg.rev; assert.ok(Number.isInteger(rev0), 'hello.cfg に rev');
  assert.equal(await page.evaluate(() => window.__roastlog.CfgS.rev), rev0);
  // A: 名前だけ書きかけ
  await page.fill('#chName0', 'BT-A');
  // B: 補正値を変える（baseRev つき）
  other.send(JSON.stringify({ type: 'setcfg', id: 'b1', baseRev: rev0, channels: [{ idx: 1, offset: -2.5 }] }));
  await waitFor(() => om.find(m => m.type === 'ack' && m.id === 'b1' && m.ok), 'B の保存');
  await page.waitForSelector('#chConflict:not([hidden])', { timeout: 5000 });   // 書きかけは消さずに警告
  assert.equal(await page.inputValue('#chName0'), 'BT-A', '書きかけの内容は残る');
  await page.screenshot({ path: path.join(shots, 'cfg-conflict.png') });
  // A が保存 → stale
  const n0 = frames.length; await page.click('#chSave');
  await waitFor(() => frames.slice(n0).some(f => f.type === 'setcfg'), 'setcfg');
  const sc = frames.slice(n0).find(f => f.type === 'setcfg');
  assert.equal(sc.baseRev, rev0, 'baseRev はフォームを開いたときの rev');
  assert.deepEqual(sc.channels, [{ idx: 0, name: 'BT-A' }], '変えた項目だけ（差分）');
  await waitFor(async () => /最新の設定を読み直しました/.test(await page.textContent('.toast.err')), 'stale の案内');
  let st = (await srv.api('/api/sim/state')).cfg;
  assert.equal(st.channels[0].name, '豆温度', 'A の変更は保存されない'); assert.equal(st.channels[1].offset, -2.5, 'B の補正値は消えない');
  assert.equal(await page.inputValue('#chName0'), '豆温度', '最新の設定を読み直した'); assert.equal(await page.inputValue('#chOff1'), '-2.5');
  // もう一度（今度は通る）
  await page.fill('#chName0', 'BT-A'); const n1 = frames.length; await page.click('#chSave');
  await waitFor(async () => (await srv.api('/api/sim/state')).cfg.channels[0].name === 'BT-A', '保存できた');
  st = (await srv.api('/api/sim/state')).cfg; assert.equal(st.channels[1].offset, -2.5); assert.equal(st.rev, rev0 + 2);
  assert.equal(frames.slice(n1).find(f => f.type === 'setcfg').baseRev, rev0 + 1);
  // 変更がなければ送らない
  const n2 = frames.length; await page.click('#chSave'); await sleep(400);
  assert.equal(frames.slice(n2).filter(f => f.type === 'setcfg').length, 0, '差分がなければ送らない');
  // 機器の amp も差分 + baseRev
  await page.click('#sMains [data-v="60"]'); const n3 = frames.length; await page.click('[data-action="save-device"]');
  await waitFor(() => frames.slice(n3).some(f => f.type === 'setcfg'), 'setcfg(amp)');
  const sa = frames.slice(n3).find(f => f.type === 'setcfg'); assert.deepEqual(sa.amp, { mains: 60 }); assert.equal(sa.baseRev, rev0 + 2);
  // 焙煎中に、ほかの端末が補正値を変えたら警告
  await page.locator('[data-action="go"][data-to="home"]:visible').first().click();
  await startRoast(page, srv, '補正値の警告');
  const rv = (await srv.api('/api/sim/state')).cfg.rev;
  other.send(JSON.stringify({ type: 'setcfg', id: 'b2', baseRev: rv, channels: [{ idx: 0, offset: 1.5 }] }));
  await page.waitForSelector('#flowBanner [data-fb="cfgchg"]', { timeout: 5000 });
  assert.match(await page.textContent('#flowBanner [data-fb="cfgchg"]'), /焙煎中に補正値が変わりました.*CH1/);
  await page.screenshot({ path: path.join(shots, 'cfg-change-while-roasting.png') });
  other.close(); assert.deepEqual(errors, []); await ctx.close();
});

test('中-7: s が bf より先に届いても欠損なし。bf の外れ値除去は s と別（急に温度が動く区間でも null にしない）', { timeout: 120000 }, async () => {
  const srv = await sim([...BASE, '--bf-delay', '1500']);
  const { ctx, page, errors, recv } = await open(srv.url);
  await startRoast(page, srv, 's が先');
  await waitFor(async () => (await D(page)).lastT >= 6, 't>=6', 30000);
  await srv.api('/api/sim/disconnect?sec=60');   // 投入直後は温度が急に動く（190 → 100℃）。切れている間に 90℃ 動く
  await waitFor(async () => (await page.textContent('#connRow')).includes('再接続'), '切断');
  await waitFor(async () => (await page.textContent('#connRow')).includes('受信中'), '再接続', 30000);
  await waitFor(async () => (await D(page)).gaps.length === 0 && recv.filter(m => m.type === 'bf').length >= 1, 'bf を受け取る', 20000);
  await sleep(1000);
  // 順番: 2 回目の hello のあと、s が bf より先
  const hi = recv.map((m, i) => m.type === 'hello' ? i : -1).filter(i => i >= 0).pop();
  const after = recv.slice(hi + 1), iBf = after.findIndex(m => m.type === 'bf'), iS = after.findIndex(m => m.type === 's');
  assert.ok(iBf >= 0 && iS >= 0 && iS < iBf, `s が bf より先に届く順番になっている s=${iS} bf=${iBf}`);
  const bf = after[iBf], s0 = after[iS]; assert.ok(s0.seq > bf.to - 5, 'bf の範囲より新しい s が先');
  const d = await D(page);
  assert.deepEqual(holes(d, 'c1', d.n - 2), [], 'c1 に欠損なし（bf の値が外れ値として捨てられていない）: ' + JSON.stringify(d.c1.slice(0, 90)));
  assert.deepEqual(holes(d, 'c2', d.n - 2), []); assert.deepEqual(d.gaps, []);
  const from = firstNN(d.c1), diffs = d.c1.slice(from, d.n - 2).map((x, i, a) => i ? Math.abs(x - a[i - 1]) / 10 : 0);
  assert.ok(Math.max(...diffs) < 12, '連続した値（急な飛びなし）');
  assert.deepEqual(errors, []); await ctx.close();
});

test('再起動: 新しい起動の分がバックフィルで埋まる（gaps は止まっていた間だけ）。再読み込みしても時刻はつながる（seq で数える）', { timeout: 150000 }, async () => {
  const srv = await sim([...BASE, '--bf-delay', '600']);
  const { ctx, page, errors } = await open(srv.url);
  await startRoast(page, srv, '再起動と再読み込み');
  await waitFor(async () => (await D(page)).lastT > 60, 't>60', 40000);
  const bid0 = (await srv.api('/api/sim/state')).bootId;
  await srv.api('/api/sim/reboot');
  await waitFor(async () => (await srv.api('/api/sim/state')).bootId !== bid0, '再起動');
  await waitFor(async () => (await D(page)).clk && (await D(page)).clk.length === 2, '新しい起動の時計');
  await waitFor(async () => (await page.textContent('#connRow')).includes('受信中'), '再接続', 30000);
  await waitFor(async () => (await srv.api('/api/sim/state')).seq > 12, '新起動の秒が進む');
  await sleep(2500);
  let d = await D(page);
  const gsum = d.gaps.reduce((a, g) => a + g.to - g.from + 1, 0);
  assert.ok(gsum >= 1 && gsum <= 10, `gaps は止まっていた間だけ: ${JSON.stringify(d.gaps)}`);
  assert.deepEqual(holes(d, 'c1', d.n - 2), [], '新起動の分はバックフィルで埋まる（gaps の外に欠損なし）');
  assert.deepEqual(holes(d, 'c2', d.n - 2), []);
  const k = d.clk[1], seq = (await srv.api('/api/sim/state')).seq;
  assert.ok(Math.abs(d.lastT - (k.t0 + seq - k.seq0)) <= 4, `時刻は seq で数える lastT=${d.lastT} 期待 ${k.t0 + seq - k.seq0}`);
  // 再読み込み
  const lastBefore = d.lastT, gapsBefore = JSON.stringify(d.gaps);
  await page.reload(); await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  await page.click('[data-action="resume"]');
  await waitFor(async () => (await page.textContent('#connRow')).includes('受信中'), '再開', 30000); await sleep(2500);
  d = await D(page);
  assert.ok(d.lastT > lastBefore + 2, `続きから進む ${lastBefore} → ${d.lastT}`); assert.equal(d.clk.length, 2, '起動の基準は 2 つのまま');
  assert.equal(JSON.stringify(d.gaps), gapsBefore, '再読み込みで gaps は増えない');
  assert.deepEqual(holes(d, 'c1', d.n - 2), [], '再読み込みのあとも欠損なし');
  // もう一度、再起動（再読み込みのあと）
  const bid1 = (await srv.api('/api/sim/state')).bootId; await srv.api('/api/sim/reboot');
  await waitFor(async () => (await srv.api('/api/sim/state')).bootId !== bid1, '2 回目の再起動');
  await waitFor(async () => (await D(page)).clk.length === 3, '3 つめの起動の時計', 20000);
  await waitFor(async () => (await page.textContent('#connRow')).includes('受信中'), '再接続', 30000); await sleep(2500);
  d = await D(page); assert.deepEqual(holes(d, 'c1', d.n - 2), []); assert.ok(d.lastT > lastBefore + 8);
  await page.screenshot({ path: path.join(shots, 'reboot-reload.png') });
  assert.deepEqual(errors, []); await ctx.close();
});

test('中-2: 複数タブ。書き手は 1 タブだけ。ほかのタブは「続ける」を受け付けず、保存済みの下書きを作り直さない', { timeout: 120000 }, async () => {
  const srv = await sim(BASE);
  const { ctx, page, errors, more } = await open(srv.url);
  await startRoast(page, srv, '2 タブ');
  await waitFor(async () => (await D(page)).lastT > 20, 't>20');
  const tab1 = (await D(page)).tab; assert.ok(tab1, '下書きに書き手のタブ id');
  const p2 = await more();
  assert.ok(await p2.isVisible('#busyNote'), '別のタブが書き手と案内');
  await p2.click('[data-action="resume"]'); await sleep(400);
  assert.equal(await p2.isVisible('[data-view="roast"]'), false, '続けられない'); assert.match(await p2.textContent('.toast.err'), /別のタブで焙煎を続けています/);
  assert.equal((await D(p2)).tab, tab1, '書き手は変わらない');
  await p2.screenshot({ path: path.join(shots, 'two-tabs-busy.png') });
  // 書き手のタブが保存 → 別のタブは何も作り直さない
  await page.click('[data-ev="drop"]'); await page.click('.overlay [data-r="1"]');
  await page.waitForSelector('[data-view="finish"]:not([hidden])'); await page.fill('#fRoasted', '170'); await page.click('[data-action="save-finish"]');
  await page.waitForSelector('[data-view="detail"]:not([hidden])'); await sleep(500);
  await sleep(6500);
  assert.equal(await page.evaluate(() => localStorage.getItem('roastlog.draft')), null, '6 秒あとも下書きは戻らない');
  assert.equal(await p2.evaluate(() => window.__roastlog.S.draft), null, '別のタブも下書きを手放した');
  assert.equal(await p2.isVisible('[data-action="resume"]'), false);
  const p3 = await more(); assert.equal(await p3.isVisible('[data-action="resume"]'), false, '新しいタブに続きは出ない');
  assert.equal(await p3.evaluate(() => window.__roastlog.S.roasts.length), 1, '保存した記録は 1 件');
  assert.equal(await p2.evaluate(() => window.__roastlog.S.roasts.length), 1, '別のタブにも保存した記録が届く（上書きで消さない）');
  assert.deepEqual(errors, []); await ctx.close();
});

test('中-2: 別のタブに書き手を取られたら、このタブは読み取り専用になり、下書きを書かない。貸し出しが切れていれば「続ける」で引き継げる', { timeout: 120000 }, async () => {
  const srv = await sim(BASE);
  const { ctx, page, errors, more } = await open(srv.url);
  await startRoast(page, srv, '読み取り専用');
  await waitFor(async () => (await D(page)).lastT > 20, 't>20');
  const p2 = await more();
  // 別のタブが書き手を取った（storage イベント）
  await p2.evaluate(() => { const d = JSON.parse(localStorage.getItem('roastlog.draft')); d.tab = 'tOTHER'; localStorage.setItem('roastlog.draft', JSON.stringify(d)); localStorage.setItem('roastlog.lease', JSON.stringify({ tab: 'tOTHER', ts: Date.now() })); });
  await waitFor(async () => (await D(page)).ro, '読み取り専用になる', 5000);
  assert.match(await page.textContent('#flowBanner [data-fb="ro"]'), /読み取り専用/);
  assert.equal(await page.isDisabled('[data-ev="fc1"]'), true, '操作は無効');
  await page.screenshot({ path: path.join(shots, 'read-only-tab.png') });
  await page.evaluate(() => window.__roastlog.S.draft.memo = 'x'); await sleep(6500);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('roastlog.draft')).tab), 'tOTHER', 'このタブは下書きを書き換えない');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('roastlog.draft')).memo === 'x'), false);
  // 貸し出しが切れた（書き手のタブが消えた）あと、ホームの「続ける」で引き継げる
  await p2.evaluate(() => localStorage.setItem('roastlog.lease', JSON.stringify({ tab: 'tOTHER', ts: Date.now() - 60000 })));
  await page.evaluate(() => window.__roastlog.show ? 0 : 0);
  await page.locator('#flowBanner [data-fb-act="ro"]').click();   // ホームへ
  await page.waitForSelector('[data-view="home"]:not([hidden])');
  await page.click('[data-action="resume"]'); await page.waitForSelector('[data-view="roast"]:not([hidden])');
  await sleep(2500);
  const d = await D(page); assert.equal(d.ro, false); assert.notEqual(d.tab, 'tOTHER'); assert.ok(d.lastT > 20);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('roastlog.draft')).tab === window.__roastlog.S.draft.tab), true, '引き継いだタブが書き手');
  assert.deepEqual(errors, []); await ctx.close();
});

test('中-4: RoR ゲージ。ドラムは中点まで「—」、手網は窓が埋まるまで「—」。矢印でなく「上昇中／下降中」。温度は小数 1 桁で幅が固定', { timeout: 150000 }, async () => {
  const srv = await sim(BASE);
  const { ctx, page, errors } = await open(srv.url);
  await startRoast(page, srv, 'ドラムの RoR');
  await sleep(1000);
  assert.equal(await page.textContent('#gRor'), '—'); assert.match(await page.textContent('#gRorNote'), /中点のあと表示/);
  await page.screenshot({ path: path.join(shots, 'ror-drum-before-tp.png') });
  const temps = new Set();
  for (let i = 0; i < 25; i++) { const t = await page.textContent('#gTemp'); assert.match(t, /^\d+\.\d℃$/, '温度は小数 1 桁: ' + t); temps.add(t.replace(/\d/g, '9').length); await sleep(120); }
  assert.equal(temps.size, 1, '桁数が変わらない（幅が揺れない）' + [...temps]);
  await waitFor(async () => (await D(page)).ev.some(e => e.type === 'tp'), '中点', 60000);
  await waitFor(async () => /^-?\d+\.\d$/.test(await page.textContent('#gRor')), 'RoR の数字');
  const note = await page.textContent('#gRorNote'); assert.match(note, /RoR (上昇中|下降中|横ばい)|急上昇|急降下/);
  assert.ok(!/[↑↓→]/.test(await page.textContent('#gRorBox')), '矢印は使わない');
  await page.screenshot({ path: path.join(shots, 'ror-drum-after-tp.png') });
  // 段階の帯: 狭い段でも文字が切れない
  await page.click('[data-ev="dry"]'); await sleep(900); await page.click('[data-ev="fc1"]'); await sleep(1500);
  const clip = await page.evaluate(() => [...document.querySelectorAll('#stageBand .band i')].map(i => { const sp = i.querySelector('span').getBoundingClientRect(), r = i.getBoundingClientRect(); return { t: i.textContent, ok: sp.left >= r.left - 1 && sp.right <= r.right + 1 && sp.top >= r.top - 1 && sp.bottom <= r.bottom + 1 }; }));
  assert.ok(clip.length >= 2 && clip.every(c => c.ok), '段階の文字が切れない: ' + JSON.stringify(clip));
  await page.screenshot({ path: path.join(shots, 'stage-band.png') });
  assert.deepEqual(errors, []); await ctx.close();
  // 手網
  const srv2 = await sim([...BASE, '--profile', 'tenami']);
  const b = await open(srv2.url);
  await b.page.locator('[data-action="go"][data-to="settings"]:visible').first().click();
  await b.page.click('#sType [data-v="tenami"]'); await b.page.locator('[data-action="save-settings"]').click();
  await b.page.locator('[data-action="go"][data-to="home"]:visible').first().click();
  await startRoast(b.page, srv2, '手網の RoR');
  await sleep(600);
  assert.equal(await b.page.textContent('#gRor'), '—'); assert.match(await b.page.textContent('#gRorNote'), /窓が埋まるまで あと \d+ 秒/);
  await b.page.screenshot({ path: path.join(shots, 'ror-tenami-window.png') });
  await waitFor(async () => (await D(b.page)).lastT > 62, '窓が埋まる', 40000);
  await waitFor(async () => /^-?\d+\.\d$/.test(await b.page.textContent('#gRor')), 'RoR の数字（手網）');
  assert.match(await b.page.textContent('#gRorNote'), /RoR (上昇中|下降中|横ばい)|急上昇|急降下/);
  assert.deepEqual(b.errors, []); await b.ctx.close();
});

test('中-5・取り消し: 操作つきのお知らせはゲージの直上のバナー。「やり直す」は再読み込みのあとでも使える。そのほかのトーストは上端', { timeout: 120000 }, async () => {
  const srv = await sim(BASE);
  const { ctx, page, errors } = await open(srv.url);
  await startRoast(page, srv, 'バナー');
  await page.waitForSelector('#flowBanner [data-toast-action]');
  const bb = await page.locator('#flowBanner .fb').first().boundingBox(), gb = await page.locator('#gauges').boundingBox();
  assert.ok(bb.y + bb.height <= gb.y + 1, `バナーはゲージの直上 ${bb.y + bb.height} <= ${gb.y}`);
  assert.ok((await page.locator('#flowBanner [data-toast-action]').boundingBox()).height >= 44);
  await page.screenshot({ path: path.join(shots, 'banner-charge.png') });
  await waitFor(async () => (await D(page)).lastT > 40, 't>40');
  await page.click('[data-ev="fc1"]'); const tb = await page.locator('.toast').first().boundingBox(); assert.ok(tb.y < 100, 'トーストは上端: y=' + tb.y);
  // 投入を取り消す → 再読み込み → やり直す
  await page.click('[data-action="undo"]'); await page.click('.overlay [data-r="1"]');   // 1ハゼ（event）の取り消し
  await page.click('[data-action="undo"]'); await page.click('.overlay [data-r="1"]');   // 投入の取り消し
  await waitFor(async () => (await D(page)).status === 'ready', '投入前に戻る');
  await page.waitForSelector('#flowBanner [data-fb-act="redo"]');
  const n = await page.evaluate(() => window.__roastlog.S.draft.undone.series.data.c1.length); assert.ok(n > 40);
  await page.reload(); await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  await page.click('[data-action="resume"]');
  await page.waitForSelector('#flowBanner [data-fb-act="redo"]', { timeout: 5000 });   // 再読み込みのあとも残る
  await page.screenshot({ path: path.join(shots, 'banner-redo-after-reload.png') });
  await page.click('#flowBanner [data-fb-act="redo"]'); await sleep(800);
  const d = await D(page); assert.equal(d.status, 'roasting'); assert.ok(d.n >= n, `記録も戻る ${d.n} / ${n}`); assert.ok(d.sa);
  assert.equal(await page.evaluate(() => window.__roastlog.S.draft.undone), null);
  assert.deepEqual(errors, []); await ctx.close();
});

test('手網の排出案内は既定オフ。オンにするとシートではなくバナーで出る', { timeout: 150000 }, async () => {
  const srv = await sim([...BASE, '--profile', 'tenami']);
  const { ctx, page, errors } = await open(srv.url);
  await page.locator('[data-action="go"][data-to="settings"]:visible').first().click();
  assert.equal(await page.isChecked('#sDropHint'), true, 'ドラムは初期オン');
  await page.click('#sType [data-v="tenami"]'); assert.equal(await page.isChecked('#sDropHint'), false, '手網は初期オフ');
  await page.locator('[data-action="save-settings"]').click(); await sleep(300);
  assert.equal(await page.evaluate(() => window.__roastlog.S.settings.autoDropHint), null, '触っていなければ既定のまま');
  await page.locator('[data-action="go"][data-to="home"]:visible').first().click();
  await startRoast(page, srv, '手網の排出案内（オフ）');
  await waitFor(async () => (await D(page)).lastT > 20, 't>20'); await page.click('[data-ev="fc1"]'); await sleep(500);
  await srv.api('/api/sim/rebatch'); await sleep(4000);
  assert.equal(await page.locator('[data-fb="drophint"]').count(), 0, 'オフなら出ない'); assert.equal(await page.locator('#dropHintSheet').count(), 0);
  // オンにする
  await page.evaluate(() => { window.__roastlog.S.settings.autoDropHint = true; });
  await srv.api('/api/sim/rebatch'); await sleep(500);
  await page.waitForSelector('#flowBanner [data-fb="drophint"]', { timeout: 40000 });
  assert.equal(await page.locator('#dropHintSheet').count(), 0, 'シートは出さない');
  assert.match(await page.textContent('#flowBanner [data-fb="drophint"]'), /排出しましたか/);
  await page.screenshot({ path: path.join(shots, 'tenami-drop-hint-banner.png') });
  await page.click('#flowBanner [data-fb="drophint"] [data-fb-act]');
  await page.waitForSelector('[data-view="finish"]:not([hidden])', { timeout: 20000 });
  assert.deepEqual(errors, []); await ctx.close();
});

test('中-6: 診断（室温のまま）。線の色の案内、極性逆の誤判定なし、お湯の方法、断線中は傾向なし、前回の結果は消える、無効チャンネルの案内', { timeout: 150000 }, async () => {
  const srv = await sim([...BASE, '--room-temp', '22', '--noise', '0.05']);
  const { ctx, page, errors } = await open(srv.url);
  await page.locator('[data-action="go"][data-to="diag"]:visible').first().click();
  await waitFor(() => page.evaluate(() => { const L = window.__roastlog.LV, s = window.__roastlog.Sources.active; return s.id === 'esp32' && !!s.info && !!(L && L.cur && L.pre.length > 25); }), '受信');
  await waitFor(async () => /\d+\.\d/.test(await page.textContent('#dgVal0')), '値');
  const v0 = parseFloat(await page.textContent('#dgVal0')), v1 = parseFloat(await page.textContent('#dgVal1'));
  assert.ok(Math.abs(v0 - 22) < 1 && Math.abs(v1 - 22) < 1, `室温のまま ${v0} ${v1}`); assert.ok(Math.abs(parseFloat(await page.textContent('#dgCjVal')) - 24.3) < 1, '基板は室温より少し高い');
  const txt = await page.textContent('[data-view="diag"]');
  for (const w of ['ANSI', 'JIS', 'IEC', '磁石', '40℃くらいのお湯', '15秒', '25秒']) assert.ok(txt.includes(w), '案内に「' + w + '」');
  const finds = await page.textContent('#dgFinds'); assert.ok(!/極性|逆の可能性|大きく違います/.test(finds), '室温のとき「極性逆」と言わない: ' + finds);
  assert.equal(await page.locator('#dgFinds li.bad').count(), 0, '室温では問題なし（bad なし）');
  assert.match(finds, /CH1: まだ確かめていません/);
  await page.screenshot({ path: path.join(shots, 'diag-room-temp.png'), fullPage: true });
  // お湯: CH1
  await page.click('[data-action="dg-water"][data-i="0"]'); assert.match(await page.textContent('#dgWait0'), /40℃くらいのお湯.*25 秒/);
  await sleep(1200); await srv.api('/api/sim/pinch?ch=c1&delta=15&sec=40');
  await waitFor(async () => (await page.locator('#dgRes0').count()) > 0 && /上がりました/.test(await page.textContent('#dgRes0')), 'お湯で確認できた', 30000);
  await page.screenshot({ path: path.join(shots, 'diag-water-ok.png'), fullPage: true });
  // 断線: 傾向表示を消す・前回の結果を消す
  await srv.api('/api/sim/fault?ch=c1&kind=open&sec=30');
  await waitFor(async () => (await page.textContent('#dgVal0')).includes('断線'), '断線');
  assert.equal(await page.locator('#dgRes0').count(), 0, '前回の結果は消える');
  const c0 = await page.textContent('#dgCard0'); assert.ok(!/温度が上がっています|温度が下がっています/.test(c0), '断線中は傾向を出さない: ' + c0);
  assert.equal(await page.locator('#dgCard0 svg path').count(), 0, '断線中は線グラフも出さない');
  assert.match(await page.textContent('#dgFinds'), /CH1: 断線.*磁石|CH1: 断線/);
  // つまんで確認 → 反応なし → 無効チャンネルの案内と、秒数が案内と同じ
  await page.click('[data-action="dg-test"][data-i="1"]'); assert.match(await page.textContent('#dgWait1'), /指でつまんで.*15 秒/);
  const t0 = Date.now(); await waitFor(async () => (await page.locator('#dgRes1').count()) > 0, '反応なしの判定', 25000);
  const waited = Date.now() - t0; assert.ok(waited >= 13000 && waited <= 19000, `判定は案内の 15 秒: ${waited}ms`);
  const res = await page.textContent('#dgRes1'); assert.match(res, /反応しませんでした/); assert.match(res, /CH3 は「使わない」設定/); assert.match(res, /お湯に入れる方法/);
  assert.match(await page.textContent('#dgCard2'), /挿さっていませんか/);
  await page.screenshot({ path: path.join(shots, 'diag-no-response.png'), fullPage: true });
  // 新しく確認を始めると、そのチャンネルの前回の結果は消える
  await page.click('[data-action="dg-test"][data-i="1"]'); assert.equal(await page.locator('#dgRes1').count(), 0);
  assert.deepEqual(errors, []); await ctx.close();
});

test('軽: 校正の外れ値除去（calClean）。1〜2 個のはずれ値は除いて判定、ばらつく測定は除いても不安定', async () => {
  const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
  const src = html.slice(html.indexOf('// @core-begin'), html.indexOf('// @core-end'));
  const ctx = { window: {}, globalThis: null }; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
  const C = ctx.window.RoastCore;
  const clean = [21.0, 21.05, 20.98, 21.02, 21.01, 20.99, 21.03, 21.0, 21.04, 20.97];
  assert.ok(C.calStats(clean).sd < 0.3);
  const withOut = clean.slice(); withOut[3] = 61.0; withOut[7] = 20.2;   // 外れ値 2 個
  assert.ok(C.calStats(withOut).sd > 1, '除かなければ不安定と判定されてしまう');
  const k = C.calClean(withOut); assert.equal(k.length, 8); assert.ok(C.calStats(k).sd < 0.3, '除けば安定');
  const ramp = [21, 24, 27, 30, 33, 33.1, 33, 33.05, 33, 33.02];
  const kr = C.calClean(ramp); assert.ok(kr.length < 8, '温度が動いている測定は、除いても 8 個残らない（不安定）');
  assert.deepEqual(C.calClean([21, null, 21.1]), [21, 21.1]);
});

test('軽: https・file:// では ESP32 を選べず、診断・校正・チャンネル欄は「機器から配信されたページでのみ使えます」。保存ボタンは 1 つ。「シミュレーター」は折り返さない', async () => {
  const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
  const check = async (page, label) => {
    await page.locator('[data-action="go"][data-to="settings"]:visible').first().click();
    assert.equal(await page.evaluate(() => window.__roastlog.Sources.resolve('esp32')), 'manual', label + ': esp32 は選べない');
    assert.equal(await page.evaluate(() => window.__roastlog.Sources.resolve('auto')), 'manual');
    assert.equal(await page.isVisible('#sConnEsp'), false, label + ': ESP32 の選択肢は隠れる');
    for (const id of ['#pCh', '#pCal']) { assert.match(await page.locator(id + ' .devnote').textContent(), /機器から配信されたページでのみ使えます/); assert.equal(await page.locator(id + ' .devnote').isVisible(), true); assert.equal(await page.locator(id + ' #chForm, ' + id + ' #calStart').first().isVisible().catch(() => false), false, label + ': ' + id + ' の中身は隠れる'); }
    await page.screenshot({ path: path.join(shots, `settings-${label}.png`), fullPage: true });
    await page.locator('[data-view="settings"] [data-action="go"][data-to="home"]').click();
    await page.evaluate(() => { document.querySelector('[data-action="go"][data-to="diag"]').click(); });
    await page.waitForSelector('[data-view="diag"]:not([hidden])');
    assert.equal(await page.locator('#dgDevNote').isVisible(), true); assert.equal(await page.locator('#dgCards').isVisible(), false);
    await page.screenshot({ path: path.join(shots, `diag-${label}.png`) });
  };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } }); const page = await ctx.newPage();
  await page.route('https://roastlog.test/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto('https://roastlog.test/'); await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  await check(page, 'https');
  const p2 = await ctx.newPage(); await p2.goto('file://' + path.join(root, 'app/index.html')); await p2.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  assert.equal(await p2.evaluate(() => location.protocol), 'file:'); await check(p2, 'file');
  // 保存ボタンは 1 つ・「シミュレーター」は 1 行
  await p2.locator('[data-action="go"][data-to="home"]:visible').first().click().catch(() => {});
  await p2.evaluate(() => document.querySelector('[data-action="go"][data-to="settings"]').click());
  assert.equal(await p2.locator('[data-action="save-settings"]').count(), 1, '設定を保存は 1 つ');
  assert.match(await p2.locator('#pSave').textContent(), /まとめて保存/);
  const lines = await p2.evaluate(() => { const b = [...document.querySelectorAll('#sConn button')].find(x => x.textContent.includes('シミュレーター')); const r = document.createRange(); r.selectNodeContents(b); return r.getClientRects().length; });
  assert.equal(lines, 1, '「シミュレーター」は折り返さない');
  await ctx.close();
});

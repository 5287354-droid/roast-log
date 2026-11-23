// A2 に合わせた監察第1回の指摘への対応の確認（decimate・gaps・pong・truth・投入時の空気温度）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createModel } from '../../sim/roast-model.mjs';
import { startServer } from '../../sim/server.mjs';
import { validateRoast } from '../lib/schemas.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(src.slice(src.indexOf('// @core-begin'), src.indexOf('// @core-end')), ctx);
const C = ctx.window.RoastCore;
const J = x => JSON.parse(JSON.stringify(x));

function series(start, n, f = i => 1000 + i) { const d = []; for (let i = 0; i < n; i++) d.push(f(i)); return { dt: 1, start, scale: 10, data: { c1: d, c2: d.map(x => x + 5) } }; }

test('decimate: 奇数 start・奇数 dropTime・奇数長でも、組は t=0 基準で start は倍数、dropTime の値は生の値', () => {
  for (const start of [-30, -29, -31, 0, -1]) for (const n of [100, 101, 160]) {
    const s = series(start, n), drop = start + n - 1;
    const d = C.decimate(s, 2, drop);
    assert.equal(d.dt, 2); assert.equal(Math.abs(d.start % 2), 0, `start=${start}`); assert.ok(d.start <= start && d.start > start - 2);
    // 各スロットは [t, t+2) の平均。先頭時刻にずれない（t=偶数の組）
    const m = C.normalizeRecord({ schema: 2, id: 'x', startedAt: 1, dropTime: drop, events: [], series: d, channels: [{ key: 'c1', role: 'bt', name: 'b', color: '#000' }, { key: 'c2', role: 'et', name: 'e', color: '#000' }], primary: 'c1', points: [] });
    assert.equal(C.valueAt(m, 'c1', drop), s.data.c1[n - 1] / 10, `drop の値が残る start=${start} n=${n}`);
    // 途中のスロット: 平均
    const k = 10, tt = d.start + 2 * k; const i0 = tt - start; if (i0 >= 0 && i0 + 1 < n && tt + 1 < drop) assert.equal(d.data.c1[k], Math.round((s.data.c1[i0] + s.data.c1[i0 + 1]) / 2));
    assert.equal(d.data.c1.length, d.data.c2.length);
    // toV1Points の最後は dropTime
    assert.equal(C.toV1Points(m).at(-1).t, drop);
    assert.deepEqual(C.validate({ schema: 2, id: 'x', series: d, channels: [{ key: 'c1' }], primary: 'c1' }).ok, true);
  }
  // 元データ（奇数 start）で t が 1 ずれない
  const d = C.decimate(series(-29, 10, i => i * 10), 2);
  assert.equal(d.start, -30); assert.deepEqual(J(d.data.c1.slice(0, 3)), [0, 15, 35]); // [-30] は -29 だけ、次は (10+20)/2 …
});
test('valueAt: floor と範囲制限', () => {
  const m = C.normalizeRecord({ schema: 2, id: 'x', startedAt: 1, dropTime: 9, events: [], series: { dt: 2, start: 0, scale: 10, data: { c1: [100, 110, 120, 130, 140] } }, channels: [{ key: 'c1', role: 'bt', name: 'b', color: '#000' }], primary: 'c1' });
  assert.equal(C.valueAt(m, 'c1', 3), 11); assert.equal(C.valueAt(m, 'c1', 3.9), 11); assert.equal(C.valueAt(m, 'c1', 9), 14);
  assert.equal(C.valueAt(m, 'c1', -1), null); assert.equal(C.valueAt(m, 'c1', 10), null);
});
test('gaps: [{from,to}] も旧 [[a,b]] も読める。schema と validate が両方通す', () => {
  const base = { schema: 2, id: 'g', startedAt: 1, dropTime: 20, events: [], changes: [], points: [{ t: 0, temp: 1 }], source: 'sim', channels: [{ key: 'c1', role: 'bt', name: 'b', color: '#000' }], primary: 'c1', series: series(-5, 30) };
  for (const gaps of [[{ from: 3, to: 5 }], [[3, 5]]]) {
    const r = { ...base, gaps }; assert.ok(C.validate(r).ok); assert.deepEqual(J(C.normalizeRecord(r).gaps), [[3, 5]]);
    assert.deepEqual(validateRoast({ ...r, series: { ...r.series, data: { c1: r.series.data.c1 } } }), []);
  }
  assert.equal(C.validate({ ...base, gaps: [{ from: 'a', to: 2 }] }).ok, false);
});
test('pickPrimary: channels が空でも落ちない（primary は null）', () => {
  const m = C.normalizeRecord({ schema: 2, id: 'e', startedAt: 1, series: { dt: 1, start: 0, scale: 10, data: {} }, points: [] });
  assert.equal(m.primary, null); assert.doesNotThrow(() => C.stats({ schema: 2, id: 'e', startedAt: 1, series: { dt: 1, start: 0, scale: 10, data: {} }, points: [] }));
});

test('sim: ドラムは投入で空気（ET）温度も少し下がる。手網は下がらない', () => {
  const run = (profile) => { const m = createModel({ profile, seed: 1, noise: 0, outlierP: 0, chargeAt: 100 }); const o = []; for (let i = 0; i < 160; i++) o.push(m.step()); return o; };
  const d = run('drum'), et99 = d[99].v[1], etMin = Math.min(...d.slice(100, 140).map(s => s.v[1]));
  assert.ok(et99 - etMin >= 8, `ET ${et99} → ${etMin}`);
  const t = run('tenami'); assert.ok(t[99].v[1] - Math.min(...t.slice(100, 140).map(s => s.v[1])) < 20); // 手網の ET は振りの揺れだけ
});

async function startS(o) { return startServer({ port: 0, host: '127.0.0.1', quiet: true, ...o }); }
test('sim サーバ: pong.t は ping の t をそのまま返す', async () => {
  const srv = await startS({ speed: 100 });
  try {
    const ws = new WebSocket(srv.wsUrl); const log = []; ws.on('message', d => log.push(JSON.parse(d.toString())));
    await new Promise(r => ws.on('open', r)); ws.send(JSON.stringify({ type: 'hi', app: 't', ver: '0', bootId: null, lastSeq: null }));
    ws.send(JSON.stringify({ type: 'ping', id: 'p9', t: 1763870000100 }));
    const t0 = Date.now(); while (!log.find(m => m.type === 'pong') && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 10));
    assert.equal(log.find(m => m.type === 'pong').t, 1763870000100); ws.close();
  } finally { await srv.close(); }
});
test('sim サーバ: truth の時刻は seq と同じ数え方（最初のサンプルが 1）', async () => {
  const srv = await startS({ speed: 200, chargeAt: 20 });
  try {
    const t0 = Date.now(); let tr;
    while (Date.now() - t0 < 5000) { tr = await fetch(srv.url + '/api/sim/truth').then(r => r.json()); if (tr.chargeT != null && tr.seq > 30) break; await new Promise(r => setTimeout(r, 20)); }
    assert.equal(tr.chargeT, 21); assert.equal(tr.modelTruth.chargeT, 20);
  } finally { await srv.close(); }
});

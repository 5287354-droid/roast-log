// A1: RoastCore の v2 データ基盤（normalize / toV1Points / decimate / validate / v1 互換の rorInterp・stats）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const appSrc = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const legacySrc = fs.readFileSync(path.join(root, 'legacy/roastlog-artifact-v1.html'), 'utf8');

// app の @core 区間を vm で評価して RoastCore を得る
function loadCore() {
  const a = appSrc.indexOf('// @core-begin'), b = appSrc.indexOf('// @core-end');
  assert.ok(a > 0 && b > a, '@core マーカーがある');
  const ctx = { window: {} }; vm.createContext(ctx);
  vm.runInContext(appSrc.slice(a, b), ctx);
  return ctx.window.RoastCore;
}
const Core = loadCore();
// vm 内で作った配列は prototype が別なので、JSON を通して厳密比較する
const J = x => JSON.parse(JSON.stringify(x));
const deq = (a, b, m) => assert.deepStrictEqual(J(a), J(b), m);

// legacy の withRor / stats を抜き出して評価する（settings() は差し替え可能）
function loadLegacy(cfg) {
  const a = legacySrc.indexOf('/* ---------- RoR + stats ---------- */'), b = legacySrc.indexOf('/* ---------- storage');
  const body = legacySrc.slice(a, b);
  const fn = new Function('settings', 'r1', body + '\nreturn { withRor, stats, evTime };');
  return fn(() => cfg, n => Math.round(n * 10) / 10);
}

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function makeV1(seed, step, n = 24) {
  const R = rng(seed); const points = []; let temp = 180 + R() * 20;
  for (let i = 0; i <= n; i++) {
    const t = i * step + (i && R() < .3 ? Math.round(R() * 6) - 3 : 0); // 入力タイミングのばらつき
    temp += i < 4 ? -8 + R() * 3 : 3 + R() * 6 - (i > 18 ? 4 : 0);
    points.push({ t: Math.max(i ? 1 : 0, t), temp: Math.round(temp * 10) / 10 });
  }
  points.reverse(); // 並び順がばらばらでも同じ結果になること
  const last = Math.max(...points.map(p => p.t));
  return { id: 'r' + seed, beanName: 'テスト豆' + seed, startedAt: 1763870000000 + seed, dropTime: last, points,
    events: [{ type: 'fc1', t: Math.round(last * .7) }, { type: 'drop', t: last }, ...(seed % 2 ? [{ type: 'dry', t: Math.round(last * .4) }] : [])],
    changes: [], greenWeight: 200, roastedWeight: 170, degree: '中煎り', savedAt: 1 };
}

test('v1 記録: withRor/rorInterp と stats が legacy と完全一致（窓・しきい値を変えても）', () => {
  const recs = []; for (let s = 1; s <= 12; s++) recs.push(makeV1(s, s % 2 ? 30 : 60, 14 + s));
  const fx = path.join(root, 'tools/fixtures');
  if (fs.existsSync(fx)) for (const f of fs.readdirSync(fx).filter(x => /^v1-backup.*\.json$/.test(x))) recs.push(...JSON.parse(fs.readFileSync(path.join(fx, f), 'utf8')).roasts);
  assert.ok(recs.length >= 12);
  for (const cfg of [{ rorWindow: 60, flick: 3, crash: 4 }, { rorWindow: 30, flick: 2, crash: 2.5 }]) {
    const L = loadLegacy(cfg);
    for (const r of recs) {
      deq(Core.withRor(r.points, cfg), L.withRor(r.points), 'withRor ' + r.id);
      deq(Core.rorInterp(r.points, cfg), L.withRor(r.points));
      const a = Core.stats(r, cfg), b = L.stats(r);
      for (const k of ['pts', 'total', 'fc', 'dev', 'dtr', 'loss', 'tp', 'tpTemp', 'tpAuto', 'charge', 'dropTemp']) deq(a[k], b[k], `stats.${k} ${r.id}`);
    }
  }
});

test('v1 の空・1点の記録でも落ちない', () => {
  deq(Core.withRor([], {}), []);
  const s = Core.stats({ id: 'x', points: [{ t: 0, temp: 100 }], events: [] }, {});
  assert.equal(s.charge, 100); assert.equal(s.dropTemp, 100); assert.equal(s.tp, null);
});

function makeV2(chKeys, { n = 300, start = -30, withGap = false } = {}) {
  const R = rng(7); const data = {}; const roles = { c1: 'bt', c2: 'et', c3: 'amb' }; const base = { c1: 1900, c2: 2200, c3: 230 };
  chKeys.forEach(k => { data[k] = []; for (let i = 0; i < n; i++) { const t = start + i; data[k].push(t < 0 ? base[k] : Math.round(base[k] - (k === 'c3' ? 0 : 400 * Math.exp(-t / 40) - t * 3) + R() * 4)); } });
  if (withGap) chKeys.forEach(k => { for (let i = 100; i < 110; i++) data[k][i] = null; });
  const drop = start + n - 1;
  return { schema: 2, id: 'v2' + chKeys.length, beanName: '多ch', startedAt: 1763870000000, dropTime: drop, source: 'esp32', foo: { bar: 1 },
    events: [{ type: 'tp', t: 60, auto: true }, { type: 'dry', t: 120 }, { type: 'fc1', t: 220 }, { type: 'drop', t: drop }], changes: [],
    channels: chKeys.map(k => ({ key: k, role: roles[k], name: { c1: '豆温度', c2: '排気', c3: '外気温' }[k], color: '#112233', offset: 0.5 })),
    primary: 'c1', series: { dt: 1, start, scale: 10, data }, gaps: withGap ? [[70, 79]] : [], rorConfig: { method: 'lsq', window: 30, smooth: 5 },
    points: [], savedAt: 5 };
}

test('normalizeRecord: v1 は sparse・c1(排気温度)・manual。未知フィールドを保持', () => {
  const r = { ...makeV1(3, 30), hoge: [1, 2] };
  const m = Core.normalizeRecord(r);
  assert.equal(m.sparse, true); assert.equal(m.source, 'manual'); assert.equal(m.primary, 'c1');
  deq(m.channels, [{ key: 'c1', role: 'et', name: '排気温度', color: '(--temp)' }]);
  assert.equal(m.t.length, r.points.length);
  assert.ok(m.t.every((x, i) => i === 0 || m.t[i - 1] <= x), '時刻順');
  deq(m.hoge, [1, 2]); deq(m.extra, { hoge: [1, 2] });
});

for (const keys of [['c1', 'c2'], ['c1', 'c2', 'c3']]) {
  test(`normalizeRecord: v2 ${keys.length}ch の series を展開（t / ÷scale / null）`, () => {
    const r = makeV2(keys, { withGap: true });
    const m = Core.normalizeRecord(r);
    assert.equal(m.sparse, false); assert.equal(m.channels.length, keys.length); assert.equal(m.primary, 'c1');
    assert.equal(m.t.length, 300); assert.equal(m.t[0], -30); assert.equal(m.t[299], 269);
    assert.equal(m.v.c1[0], r.series.data.c1[0] / 10);
    assert.equal(m.v.c1[100], null);
    deq(m.gaps, [[70, 79]]); deq(m.extra, { foo: { bar: 1 } }); assert.equal(m.foo.bar, 1);
    assert.equal(Core.valueAt(m, 'c1', 0), r.series.data.c1[30] / 10);
    // 元の記録は書き換えない
    assert.equal(r.series.data.c1.length, 300);
    assert.ok(Core.validate(r).ok, Core.validate(r).errors.join());
  });
}

test('normalizeRecord: schema:2 で series なし（手入力 v2）は sparse', () => {
  const r = { schema: 2, id: 'm', source: 'manual', channels: [{ key: 'c1', role: 'et', name: '排気温度', color: '#C2410C', offset: 0 }], primary: 'c1', points: [{ t: 0, temp: 190 }, { t: 30, temp: 150.5 }], events: [] };
  const m = Core.normalizeRecord(r);
  assert.equal(m.sparse, true); deq(m.v.c1, [190, 150.5]); assert.equal(m.channels[0].role, 'et');
});

test('toV1Points: 自動測定は 0≤t≤dropTime の 5 秒ごと・小数1桁。往復で値が保たれる', () => {
  const r = makeV2(['c1', 'c2'], { n: 300 });
  const m = Core.normalizeRecord(r);
  const pts = Core.toV1Points(m);
  assert.equal(pts[0].t, 0); assert.equal(pts.at(-1).t, 269); // drop = 269（dropTime の点は必ず入る）
  assert.ok(pts.slice(0, -1).every(p => p.t % 5 === 0 && p.t >= 0 && p.t <= 269));
  assert.equal(pts.length, 55);
  pts.forEach(p => { assert.equal(p.temp, Math.round(p.temp * 10) / 10); assert.equal(p.temp, r.series.data.c1[p.t + 30] / 10); });
  // 往復: points だけの記録にしても 5 秒点の値が同じ
  const m2 = Core.normalizeRecord({ id: 'x', points: pts, events: [] });
  deq(Core.toV1Points(m2), pts);
  // null は飛ばす
  const g = Core.toV1Points(Core.normalizeRecord(makeV2(['c1'], { withGap: true })));
  assert.ok(!g.some(p => p.t >= 70 && p.t < 80));
  // 手入力（sparse）は全点
  const v1 = makeV1(2, 30); assert.equal(Core.toV1Points(Core.normalizeRecord(v1)).length, v1.points.length);
});

test('decimate: 2 秒平均、片方 null ならもう片方、両方 null は null。dt が倍になり decimated=2', () => {
  const s = { dt: 1, start: -30, scale: 10, data: { c1: [100, 110, null, 120, null, null, 131, 140, 150], c2: [1, 2, 3, 4, 5, 6, 7, 8, 9] } };
  const d = Core.decimate(s, 2);
  deq(d.data.c1, [105, 120, null, 136, 150]);
  deq(d.data.c2, [2, 4, 6, 8, 9]); // (1+2)/2=1.5→2 …
  assert.equal(d.dt, 2); assert.equal(d.start, -30); assert.equal(d.decimated, 2);
  assert.equal(s.data.c1.length, 9, '元は変えない');
  // 間引いた記録も展開できる
  const r = makeV2(['c1', 'c2']); r.series = Core.decimate(r.series, 2);
  const m = Core.normalizeRecord(r); assert.equal(m.t[1] - m.t[0], 2); assert.equal(m.t.length, 150);
  assert.ok(Core.validate(r).ok);
});

test('validate: 壊れた記録を検出', () => {
  assert.equal(Core.validate(null).ok, false);
  assert.equal(Core.validate({}).ok, false);
  assert.equal(Core.validate({ id: 'a', points: [{ t: 0, temp: 'x' }] }).ok, false);
  assert.equal(Core.validate({ id: 'a', points: [{ t: 0, temp: 1 }], events: [{ type: 'drop' }] }).ok, false);
  const bad = makeV2(['c1', 'c2']); bad.series.data.c2.pop();
  assert.equal(Core.validate(bad).ok, false);
  const bad2 = makeV2(['c1']); bad2.series.scale = 0; assert.equal(Core.validate(bad2).ok, false);
  assert.equal(Core.validate({ id: 'ok', points: [], events: [] }).ok, true);
});

test('stats: 自動測定の追加値（投入温度=t0、排出温度=dropTime、中点温度・最大RoR・1ハゼ時温度・乾燥/メイラード）', () => {
  const r = makeV2(['c1', 'c2']);
  const s = Core.stats(r, { rorWindowAuto: 30 });
  assert.equal(s.charge, r.series.data.c1[30] / 10);
  assert.equal(s.dropTemp, r.series.data.c1[299] / 10);
  assert.equal(s.tp, 60); assert.equal(s.tpValue, r.series.data.c1[90] / 10);
  assert.equal(s.fcTemp, r.series.data.c1[250] / 10);
  assert.equal(s.dry, 120); assert.equal(s.maillard, 100);
  assert.ok(typeof s.maxRor === 'number');
  assert.ok(s.pts.every(p => p.t >= 0 && p.t <= 269));
});

test('性能: 900 点の自動測定で stats が速い', () => {
  const r = makeV2(['c1', 'c2'], { n: 930 });
  const t0 = performance.now(); for (let i = 0; i < 20; i++) Core.stats(r, {}); const ms = (performance.now() - t0) / 20;
  assert.ok(ms < 20, `1回 ${ms.toFixed(2)}ms`);
});

test('@core 区間は DOM・状態に依存しない（document/localStorage/settings/S を触らない）', () => {
  const a = appSrc.indexOf('// @core-begin'), b = appSrc.indexOf('// @core-end');
  const body = appSrc.slice(a, b);
  for (const w of ['document.', 'localStorage', 'settings()', 'S.', 'getComputedStyle', 'navigator']) assert.ok(!body.includes(w), w);
});

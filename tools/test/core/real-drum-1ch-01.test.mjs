// 実機の本物の焙煎データ（ドラム・MAX31855・1ch）での回帰テスト。真値: 投入 t=0 / 最低温度 t=103 / 1ハゼ 641 / 排出 720
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const appSrc = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const rec = JSON.parse(fs.readFileSync(path.join(root, 'tools/fixtures/real/drum-1ch-01.json'), 'utf8'));
function loadCore() {
  const a = appSrc.indexOf('// @core-begin'), b = appSrc.indexOf('// @core-end');
  const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(appSrc.slice(a, b), ctx);
  return ctx.window.RoastCore;
}
const C = loadCore();
const S = rec.series, raw = S.data.c1.map(x => x == null ? null : x / S.scale);
const tOf = i => S.start + i * S.dt;
const i0 = -S.start / S.dt; // t=0 の添字

test('実データの前提（時刻・真値）', () => {
  assert.equal(S.dt, 1); assert.equal(raw[i0 + 103] <= Math.min(...raw.slice(i0, i0 + 400)), true);
  assert.ok(raw[i0 - 1] > 150);
});

test('1. detectCharge: 投入時刻が真値 0 の ±3 秒。投入前だけなら誤検知なし', () => {
  const run = n => { const prev5 = [], st = { pend: [] }, pre = []; let hit = null;
    for (let k = 0; k < n; k++) {
      const x = C.despike(prev5, raw[k], st); pre.push({ t: tOf(k), v: x });
      if (pre.length > 180) pre.shift();
      const d = C.detectCharge(pre, 'drum'); if (d && !hit) hit = d;
    } return hit; };
  assert.equal(run(i0), null, '投入前 30 秒では検知しない');
  const hit = run(raw.length);
  assert.ok(hit, '検知する');
  console.log('  charge detected t =', hit.t, 'at', tOf(0) + hit.at - 0);
  assert.ok(Math.abs(hit.t - 0) <= 3, `t=${hit.t}`);
});

function liveFrom0(cfg) {
  const R = C.rorCreate(cfg), T = C.tpCreate(raw[i0 - 1]); let tp = null; const prev5 = [], st = { pend: [] };
  for (let k = 0; k < i0; k++) C.despike(prev5, raw[k], st);
  for (let k = i0; k < raw.length; k++) {
    const t = tOf(k), x = C.despike(prev5, raw[k], st);
    C.rorPush(R, t, x);
    const r = C.tpPush(T, R, t); if (r && !tp) { tp = r; C.rorArm(R, r.t); }
  }
  return { R, tp };
}

test('2. 中点が 103 の ±3 秒', () => {
  const { tp } = liveFrom0({ roasterType: 'drum' });
  console.log('  tp =', JSON.stringify(tp));
  assert.ok(tp && Math.abs(tp.t - 103) <= 3, JSON.stringify(tp));
});

test('3. despike が急降下と 700 秒前後の小さな下がりを消さない', () => {
  const prev5 = [], st = { pend: [] }, out = raw.map(x => C.despike(prev5, x, st));
  const sub = (a, b) => out.slice(i0 + a, i0 + b);
  let maxDrop = 0; for (let k = i0; k < i0 + 20; k++) maxDrop = Math.max(maxDrop, raw[k - 1] - raw[k]);
  assert.ok(maxDrop > 6, `最大 1 秒降下 ${maxDrop}`);
  const rate = a => a.filter(x => x != null).length / a.length;
  console.log('  非 null 率 全体', rate(out.slice(i0)).toFixed(4), '投入後20秒', rate(sub(0, 21)), '690-715', rate(sub(690, 716)));
  assert.ok(rate(out.slice(i0)) >= 0.99);
  assert.equal(rate(sub(0, 21)), 1);
  assert.equal(rate(sub(690, 716)), 1);
  // 値そのものも保たれる
  for (let k = i0; k < i0 + 21; k++) assert.equal(out[k], raw[k]);
});

test('4. RoR の範囲と、ライブ＝保存後再計算の一致', () => {
  const cfg = { roasterType: 'drum', rorWindowAuto: 30, rorSmooth: 5 };
  const { R } = liveFrom0(cfg);
  for (let t = 300; t <= 480; t++) assert.ok(R.ror[t] >= 10 && R.ror[t] <= 20, `t=${t} ror=${R.ror[t]}`);
  assert.ok(R.ror[60] < 0, `t=60 ror=${R.ror[60]}`);
  const m = C.normalizeRecord(rec);
  const st = C.stats(rec, cfg, m);
  const live = [...R.ror.keys()].filter(t => t <= 720);
  assert.equal(st.pts.length, live.filter(t => R.v[t] != null).length);
  for (const p of st.pts) {
    const q = R.ror[p.t];
    assert.equal(p.ror, q == null ? null : C.r1(q), `t=${p.t}`);
  }
  // 保存側の rorSeries（TP あり）とライブも一致
  const S2 = C.rorSeries(m.t, m.v[m.primary], cfg, 104);
  for (let t = 0; t <= 720; t++) assert.ok(Math.abs((S2.ror[t] ?? 0) - (R.ror[t] ?? 0)) < 1e-9, `t=${t}`);
});

test('5. normalizeRecord → validate、toV1Points が dropTime の点を含む', () => {
  const m = C.normalizeRecord(rec);
  const v = C.validate(rec); assert.deepEqual(JSON.parse(JSON.stringify(v)), { ok: true, errors: [] });
  assert.equal(m.dropTime, 720);
  const pts = C.toV1Points(m);
  assert.ok(pts.some(p => p.t === 720), 'dropTime の点');
  assert.ok(pts.every(p => p.t <= 720));
});

test('6. 急変判定（1ハゼ直後 641〜670 秒）を記録する', () => {
  const cfg = { roasterType: 'drum' };
  const { R } = liveFrom0(cfg); // TP 自動確定後
  const win = []; for (let t = 641; t <= 670; t++) if (R.flag[t]) win.push([t, R.flag[t]]);
  const all = new Set(R.flag.filter(Boolean));
  const m = C.normalizeRecord(rec), st = C.stats(rec, cfg, m);
  const stWin = st.pts.filter(p => p.t >= 641 && p.t <= 670 && p.flag);
  console.log('  [記録] live flag 641-670:', JSON.stringify(win.slice(0, 3)), 'n=', win.length,
    '/ 全期間の種類:', [...all].join(',') || 'なし', '/ firstFlag:', R.firstFlag,
    '/ stats 側 641-670 flag 点数:', stBad(stWin), '/ flick設定:', R.flick, 'crash設定:', R.crash);
  const d = []; for (let t = 600; t <= 720; t += 10) d.push(`${t}:${R.ror[t] == null ? '-' : R.ror[t].toFixed(1)}`);
  console.log('  RoR 600-720:', d.join(' '));
  const runs = []; R.flag.forEach((f, t) => { if (f) { const l = runs[runs.length - 1]; if (l && l[0] === f && l[2] === t - 1) l[2] = t; else runs.push([f, t, t]); } });
  console.log('  [記録] flag 区間(種類,開始,終了):', JSON.stringify(runs));
  assert.ok(true);
});
function stBad(a) { return a.length; }

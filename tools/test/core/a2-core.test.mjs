// A2: 自動測定の信号処理（SPEC 7.3）。app の @core 区間を vm で評価し、roast-model（sim と同一コード）の出力に通す
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModel, mulberry32 } from '../../sim/roast-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const appSrc = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
function loadCore() {
  const a = appSrc.indexOf('// @core-begin'), b = appSrc.indexOf('// @core-end');
  const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(appSrc.slice(a, b), ctx);
  return ctx.window.RoastCore;
}
const C = loadCore();
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const gauss = r => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());

// sim を回して、despike → プレバッファ → detectCharge → rorPush → tpPush までをアプリと同じ手順で流す
function pipeline(profile, seed, chargeAt, n = 900, opts = {}, extraCfg = {}) {
  const m = createModel({ profile, seed, chargeAt, ...opts });
  const prev5 = [], st = { pend: [] }, pre = [];
  let det = null, cT = null, R = null, T = null, tp = null, falsePos = null;
  const cfg = { rorWindowAuto: profile === 'tenami' ? 60 : 30, roasterType: profile, ...extraCfg };
  for (let k = 0; k < n; k++) {
    const s = m.step(); const x = C.despike(prev5, s.v[0], st);
    if (!det) {
      pre.push({ t: k, v: x }); if (pre.length > 180) pre.shift();
      const d = C.detectCharge(pre, profile);
      if (d) {
        if (chargeAt == null) { falsePos = d; break; }
        det = d; cT = d.t; R = C.rorCreate(cfg); T = C.tpCreate();
        for (const p of pre) if (p.t >= cT) C.rorPush(R, p.t - cT, p.v);
      }
    } else {
      const t = k - cT; C.rorPush(R, t, x);
      const r = C.tpPush(T, R, t); if (r && !tp) { tp = { ...r, abs: r.t + cT }; C.rorArm(R, r.t); }
    }
  }
  return { m, det, cT, R, T, tp, falsePos, truth: m.truth() };
}

test('rorLsq: 傾き 10℃/分の直線 + σ0.3 のノイズで窓 30 秒の誤差 < 0.5℃/分', () => {
  for (const seed of SEEDS) {
    const r = mulberry32(seed); const v = [];
    for (let i = 0; i < 200; i++) v.push(100 + i * 10 / 60 + 0.3 * gauss(r));
    let se = 0, n = 0; for (let i = 40; i < 200; i += 3) { const x = C.rorLsq(null, v, i, 30); se += (x - 10) ** 2; n++; assert.ok(Math.abs(x - 10) < 1.5, `seed ${seed} i=${i} ror=${x}`); }
    assert.ok(Math.sqrt(se / n) < 0.5, `seed ${seed} 二乗平均の誤差 ${Math.sqrt(se / n)}`); // 理論値 σ√(12/(W³))×60 ≒ 0.38
  }
});
test('rorLsq: 遅れ ≤ 窓/2 + 1 秒（傾きが 0→10 に切り替わったとき、窓の半分の値に達する時刻）', () => {
  const v = []; for (let i = 0; i < 200; i++) v.push(i < 100 ? 100 : 100 + (i - 100) * 10 / 60);
  let reach = null; for (let i = 100; i < 200; i++) if (C.rorLsq(null, v, i, 30) >= 5) { reach = i - 100; break; }
  assert.ok(reach != null && reach <= 30 / 2 + 1, `reach=${reach}`);
  // 点が窓の半分に満たなければ null、null を含む窓でも計算できる
  assert.equal(C.rorLsq(null, [1, 2, 3], 2, 30), null);
  const w = v.slice(); for (let i = 120; i < 130; i++) w[i] = null; assert.ok(Math.abs(C.rorLsq(null, w, 150, 30) - 10) < 0.5);
  // t 配列つき（間隔が不規則）でも同じ傾き
  const t = [0, 1, 3, 4, 6, 7, 9, 10, 12, 13, 15, 16, 18, 19, 21, 22, 24, 25, 27, 28, 30], y = t.map(x => 5 + x / 6);
  assert.ok(Math.abs(C.rorLsq(t, y, 20, 30) - 10) < 1e-6);
});

test('rorPush: EMA(τ=5) で平滑化、差分計算が全点計算と同じ、τ=0 は平滑化なし', () => {
  const r = mulberry32(3), v = []; for (let i = 0; i < 300; i++) v.push(150 + i * 0.12 + 0.3 * gauss(r));
  const R = C.rorCreate({ rorWindowAuto: 30, rorSmooth: 5 }); v.forEach((x, i) => C.rorPush(R, i, x));
  assert.equal(R.ror[10], null); assert.ok(R.ror[15] != null);
  const R0 = C.rorCreate({ rorWindowAuto: 30, rorSmooth: 0 }); v.forEach((x, i) => C.rorPush(R0, i, x));
  assert.equal(R0.ror[100], R0.raw[100]);
  const sd = a => { const m = a.reduce((x, y) => x + y) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
  assert.ok(sd(R.ror.slice(60)) < sd(R0.ror.slice(60)));
  const S = C.rorSeries(v.map((_, i) => i), v, { rorWindowAuto: 30, rorSmooth: 5 }, null);
  assert.deepEqual(S.ror, R.ror);
});

test('despike: 単発の +40℃ は除去（null）、その次は通常に戻る', () => {
  const prev5 = [], st = { pend: [] }, out = [];
  for (let i = 0; i < 20; i++) out.push(C.despike(prev5, i === 10 ? 190 : 150 + i * 0.1, st));
  assert.equal(out[10], null);
  out.forEach((x, i) => { if (i !== 10) assert.ok(x != null && Math.abs(x - (150 + i * 0.1)) < 1e-9); });
});
test('despike: 実際に 100℃ 下がる（階段）場合は 3 点目で追従、600℃超・負は null', () => {
  const prev5 = [], st = { pend: [] }; for (let i = 0; i < 10; i++) C.despike(prev5, 200, st);
  assert.equal(C.despike(prev5, 100, st), null); assert.equal(C.despike(prev5, 99.5, st), null);
  assert.equal(C.despike(prev5, 99, st), 99);                 // 3 秒以内に追従
  assert.equal(C.despike(prev5, 98.5, st), 98.5);             // 以後は通常に採用
  assert.equal(C.despike(prev5, 601, st), null); assert.equal(C.despike(prev5, -1, st), null); assert.equal(C.despike(prev5, null, st), null);
});
test('despike: 投入直後の急降下（約 5℃/秒）は保留せずそのまま通す', () => {
  const prev5 = [], st = { pend: [] }; for (let i = 0; i < 10; i++) C.despike(prev5, 230, st);
  let x = 230; for (let i = 0; i < 20; i++) { x -= 5.4 * Math.exp(-i / 25); assert.equal(C.despike(prev5, x, st), x); }
});
test('despike: 10 シードの sim（外れ値 1/300）で +40 の外れ値が series に残らない', () => {
  for (const seed of SEEDS) {
    const m = createModel({ profile: 'drum', seed, chargeAt: 40, outlierP: 1 / 100 });
    const clean = createModel({ profile: 'drum', seed, chargeAt: 40, outlierP: 0 });
    const prev5 = [], st = { pend: [] }; let seen = 0;
    for (let k = 0; k < 600; k++) {
      const s = m.step(), c = clean.step(); const x = C.despike(prev5, s.v[0], st);
      if (s.v[0] - c.v[0] > 20) { seen++; assert.equal(x, null, `seed ${seed} k=${k}`); }
      else if (x != null) assert.ok(Math.abs(x - c.v[0]) < 2, `seed ${seed} k=${k} x=${x} clean=${c.v[0]}`);
    }
    assert.ok(seen > 0);
  }
});

for (const profile of ['drum', 'tenami']) {
  test(`detectCharge(${profile}): 10 シードで真値 ±3 秒、待機中に誤検知 0`, () => {
    for (const seed of SEEDS) {
      const r = pipeline(profile, seed, 30 + seed * 7, 400);
      assert.ok(r.det, `seed ${seed}: 検知できない`);
      assert.ok(Math.abs(r.cT - r.truth.chargeT) <= 3, `seed ${seed}: 検知 ${r.cT} 真値 ${r.truth.chargeT}`);
      assert.ok(r.det.at - r.truth.chargeT <= 15, `seed ${seed}: 検知が遅い ${r.det.at - r.truth.chargeT} 秒`);
      const w = pipeline(profile, seed, null, 1200, { outlierP: 1 / 100 });
      assert.equal(w.falsePos, null, `seed ${seed}: 待機中の誤検知`);
    }
  });
}
test('detectCharge(tenami): 手網を激しく振っても（振幅 ±12℃）誤検知しない。drum は予熱前（120℃未満）では動かない', () => {
  const r = mulberry32(9), buf = [];
  for (let k = 0; k < 600; k++) { buf.push({ t: k, v: 22 + 12 * Math.sin(2 * Math.PI * 0.8 * k) + 0.3 * gauss(r) }); assert.equal(C.detectCharge(buf.slice(-180), 'tenami'), null, `k=${k}`); }
  const d = []; for (let k = 0; k < 100; k++) { d.push({ t: k, v: 100 - k * 0.3 }); }
  for (let k = 100; k < 110; k++) d.push({ t: k, v: 70 - (k - 100) * 5 }); assert.equal(C.detectCharge(d, 'drum'), null);
});

for (const profile of ['drum', 'tenami']) {
  test(`detectTP(${profile})`, () => {
    for (const seed of SEEDS) {
      const r = pipeline(profile, seed, 40 + seed * 3, 700);
      if (profile === 'tenami') { assert.equal(r.tp, null, `seed ${seed}: 手網に TP は無い`); assert.equal(r.T.none, true); continue; }
      assert.ok(r.tp, `seed ${seed}: TP が出ない`);
      assert.ok(Math.abs(r.tp.abs - r.truth.tpT) <= 3, `seed ${seed}: ${r.tp.abs} / 真値 ${r.truth.tpT}`);
      assert.ok(Math.abs(r.tp.temp - r.truth.tpTemp) < 3, `温度 ${r.tp.temp} / ${r.truth.tpTemp}`);
    }
  });
}

test('detectTP: 30 シードでも ±3 秒（余裕の確認）', () => {
  let worst = 0;
  for (let seed = 11; seed <= 40; seed++) { const r = pipeline('drum', seed, 50, 400); assert.ok(r.tp, `seed ${seed}`); worst = Math.max(worst, Math.abs(r.tp.abs - r.truth.tpT)); }
  assert.ok(worst <= 3, `worst=${worst}`);
});

test('急変判定: 1ハゼ直後の急降下で crash、1ハゼ終了より前は判定ゼロ', () => {
  for (const seed of SEEDS) {
    const r = pipeline('drum', seed, 40, 900, {}, { crash: 3 }), fc1e = r.truth.fc1eT - r.truth.chargeT; // sim の急降下は小さめ（Δ≒-3.7〜-6）なので閾値 3 で確かめる
    const flagged = r.R.flag.map((f, i) => f ? [i, f] : null).filter(Boolean);
    assert.ok(flagged.length > 0, `seed ${seed}: 判定が出ない`);
    assert.ok(flagged.every(([, f]) => f === 'crash'), `seed ${seed}: crash 以外 ${JSON.stringify(flagged.filter(x => x[1] !== 'crash').slice(0, 3))}`);
    assert.ok(flagged[0][0] >= fc1e - 5, `seed ${seed}: 早すぎる ${flagged[0][0]} < fc1e ${fc1e}`);
    assert.ok(flagged[0][0] <= fc1e + 60, `seed ${seed}: 遅すぎる`);
    assert.equal(r.R.firstFlag, flagged[0][0]);
  }
});
test('急変判定: 既定の閾値（4）でも 10 シード中 8 以上で crash が出る', () => {
  let hit = 0; for (const seed of SEEDS) { const r = pipeline('drum', seed, 40, 900); if (r.R.flag.some(f => f === 'crash')) hit++; assert.ok(!r.R.flag.some(f => f === 'flick')); }
  assert.ok(hit >= 8, `hit=${hit}`);
});
test('急変判定: 手網も 1ハゼ直後の急降下で crash。投入直後の大きな変化では出ない', () => {
  for (const seed of SEEDS) {
    const r = pipeline('tenami', seed, 40, 900, {}, { crash: 3 }), fc1e = r.truth.fc1eT - r.truth.chargeT;
    const flagged = r.R.flag.map((f, i) => f ? i : null).filter(x => x != null);
    assert.ok(flagged.length > 0 && flagged[0] >= fc1e - 5, `seed ${seed}: ${flagged[0]} fc1e ${fc1e}`);
  }
});
test('急変判定: 定常的な下降（RoR が 1.5℃/分ずつなだらかに落ちる）では判定ゼロ。ヒステリシス（3 秒続いて点灯、5 秒外れて解除）', () => {
  const R = C.rorCreate({ rorWindowAuto: 30, rorSmooth: 5, flick: 3, crash: 4 }); C.rorArm(R, 60);
  let T = 100; for (let t = 0; t < 600; t++) { T += Math.max(2, 14 - t / 40) / 60; C.rorPush(R, t, T); }
  assert.equal(R.flag.filter(Boolean).length, 0);
  // 人工的な RoR: 平坦 → 急降下 → 平坦。点灯は条件成立から 3 秒後、解除は条件が外れて 5 秒後
  const Q = C.rorCreate({ rorWindowAuto: 30, rorSmooth: 0, flick: 3, crash: 4 }); C.rorArm(Q, 0);
  Q.peak = 20; Q.past = true; // ピークを過ぎた状態
  let y = 100; const slope = t => (t < 100 ? 10 : t < 130 ? 10 - (t - 100) * 0.5 : 0) / 60; // 130 秒までに 10→-5℃/分 ではなく 10→0 に落ちる（Δ=-10/30s）
  for (let t = 0; t < 400; t++) { y += slope(t); C.rorPush(Q, t, y); }
  const on = Q.flag.findIndex(f => f === 'crash'); assert.ok(on >= 100, `on=${on}`);
  const off = Q.flag.findIndex((f, i) => i > on && !f); assert.ok(off > on);
  let cnt = 0; for (let i = on; i < off; i++) cnt++; assert.ok(cnt >= 5, `点灯 ${cnt} 秒`);
});

test('autoPts（stats）: ライブと同じ RoR。flag は crash だけ。tenami は TP フォールバックなし', () => {
  const r = pipeline('drum', 3, 40, 900); const cT = r.cT;
  const t = [], v = []; r.R.v.forEach((x, i) => { t.push(i); v.push(x); });
  const rec = { schema: 2, id: 'x', startedAt: 1, dropTime: 800, events: [{ type: 'tp', t: r.tp.t, auto: true }, { type: 'fc1', t: 560 }, { type: 'drop', t: 800 }],
    channels: [{ key: 'c1', role: 'bt', name: 'BT', color: '#C2410C' }], primary: 'c1', source: 'sim',
    series: { dt: 1, start: 0, scale: 10, data: { c1: v.map(x => x == null ? null : Math.round(x * 10)) } }, points: [] };
  const s = C.stats(rec, { rorWindowAuto: 30, rorSmooth: 5 });
  assert.ok(s.tpAuto, '自動の中点は推定表示');
  const live = r.R.ror[300]; const p = s.pts.find(q => q.t === 300);
  assert.ok(Math.abs(p.ror - live) < 0.3, `${p.ror} vs ${live}`);
  assert.ok(s.maxRor != null);
  // maxRor は TP+30 秒以降
  assert.ok(s.pts.filter(q => q.t >= s.tp + 30).some(q => q.ror === s.maxRor));
  assert.ok(cT > 0);
  assert.ok(s.pts.every(q => q.flag === null || q.flag === 'crash' || q.flag === 'flick'), 'flag の値');
  const rt = pipeline('tenami', 3, 40, 900), tv = rt.R.v.map(x => x == null ? null : Math.round(x * 10));
  const tn = C.stats({ ...rec, roasterType: 'tenami', events: [{ type: 'fc1', t: 560 }, { type: 'drop', t: 800 }], series: { dt: 1, start: 0, scale: 10, data: { c1: tv } } }, { rorSmooth: 5, roasterType: 'tenami' });
  assert.ok(tn.tp === null && !tn.tpAuto, `手網の記録に自動の中点が出ない: tp=${tn.tp}`);
  assert.ok(tn.maxRor != null && tn.reach != null, '手網: 最大RoR（2分以降）と150℃到達');
});

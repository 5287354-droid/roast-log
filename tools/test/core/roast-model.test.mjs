import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModel, mulberry32 } from '../../sim/roast-model.mjs';

const run = (opts, n, ctl) => { const m = createModel(opts); const out = []; for (let i = 0; i < n; i++) out.push(m.step(typeof ctl === 'function' ? ctl(i) : ctl)); return { m, out }; };
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test('mulberry32: 同じ seed は同じ列、違う seed は違う列、値は [0,1)', () => {
  const a = mulberry32(7), b = mulberry32(7), c = mulberry32(8);
  const xa = [...Array(50)].map(a), xb = [...Array(50)].map(b), xc = [...Array(50)].map(c);
  assert.deepEqual(xa, xb);
  assert.notDeepEqual(xa, xc);
  assert.ok(xa.every(x => x >= 0 && x < 1));
});

test('createModel: 同じ seed・同じ操作なら完全に同じ出力（決定的）', () => {
  const a = run({ seed: 5 }, 300).out, b = run({ seed: 5 }, 300).out, c = run({ seed: 6 }, 300).out;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('step: 1 秒ずつ進み、v は 0.1℃ 単位・3 チャンネル', () => {
  const { out } = run({ seed: 1 }, 100);
  out.forEach((s, i) => {
    assert.equal(s.k, i);
    assert.equal(s.v.length, 3); assert.equal(s.f.length, 3);
    for (const v of s.v) assert.equal(Math.round(v * 10) / 10, v);
  });
});

for (const seed of SEEDS) {
  test(`ドラム seed=${seed}: 投入後に BT が下がり TP が 60〜120 秒、1ハゼが 7〜11 分`, () => {
    const { m, out } = run({ profile: 'drum', seed, chargeAt: 40, outlierP: 0 }, 1000);
    const tr = m.truth();
    assert.equal(tr.chargeT, 40);
    // 投入前は予熱 200℃ 前後
    assert.ok(out[39].v[0] > 190 && out[39].v[0] < 250, `投入前 BT=${out[39].v[0]}`);
    // 投入で BT が大きく下がる
    const min = Math.min(...out.slice(40, 300).map(s => s.v[0]));
    assert.ok(out[39].v[0] - min > 60, `下がり幅 ${out[39].v[0] - min}`);
    const tp = tr.tpT - tr.chargeT;
    assert.ok(tp >= 60 && tp <= 120, `TP=${tp}s`);
    // TP の真値は BT の最小付近（±5 秒以内の最小の 2℃ 以内）
    const around = out.slice(tr.tpT - 5, tr.tpT + 6).map(s => s.v[0]);
    assert.ok(Math.min(...around) - min < 2.5);
    const fc = (tr.fc1T - tr.chargeT) / 60;
    assert.ok(fc >= 7 && fc <= 11, `1ハゼ=${fc.toFixed(2)}分`);
    assert.ok(tr.fc1eT > tr.fc1T);
    // 1ハゼ時の豆温度は約 195℃（BT は少し遅れる）
    assert.ok(out[tr.fc1T].v[0] > 175 && out[tr.fc1T].v[0] < 205, `1ハゼ時 BT=${out[tr.fc1T].v[0]}`);
  });

  test(`手網 seed=${seed}: 投入で BT が上昇し TP なし、1ハゼが 7〜11 分、待機中は室温`, () => {
    const { m, out } = run({ profile: 'tenami', seed, chargeAt: 40, outlierP: 0 }, 1000);
    const tr = m.truth();
    assert.equal(tr.tpT, null, '手網に TP は無い');
    const pre = out.slice(0, 40).map(s => s.v[0]);
    assert.ok(Math.max(...pre) < 40, `待機中の BT 最大 ${Math.max(...pre)}`);   // 室温 20℃ + 振り ±5 + ノイズ
    assert.ok(Math.min(...pre) > 5);
    // 投入後は（振りの揺れを均して）単調に上昇する
    const avg = (a, b) => out.slice(a, b).reduce((x, s) => x + s.v[0], 0) / (b - a);
    for (let t = 60; t < 560; t += 60) assert.ok(avg(t + 60, t + 120) > avg(t, t + 60), `t=${t} から上昇していない`);
    assert.ok(avg(100, 130) - avg(0, 30) > 15, '投入後に BT が上がる');
    const fc = (tr.fc1T - tr.chargeT) / 60;
    assert.ok(fc >= 7 && fc <= 11, `1ハゼ=${fc.toFixed(2)}分`);
    // 振りの揺れ: 投入後の 1 秒差の標準偏差がドラムより明らかに大きい
    const sd = a => { const d = a.slice(1).map((x, i) => x - a[i]); const mu = d.reduce((x, y) => x + y) / d.length; return Math.sqrt(d.reduce((x, y) => x + (y - mu) ** 2, 0) / d.length); };
    const drum = run({ profile: 'drum', seed, chargeAt: 40, outlierP: 0 }, 400).out.slice(200, 400).map(s => s.v[0]);
    assert.ok(sd(out.slice(200, 400).map(s => s.v[0])) > 2 * sd(drum));
  });
}

test('chargeAt:null は手動投入まで投入しない。controls.charge で投入できる', () => {
  const { m, out } = run({ profile: 'drum', seed: 1, chargeAt: null }, 100);
  assert.equal(m.truth().chargeT, null);
  assert.equal(out[99].charged, false);
  assert.equal(out[99].t, null);
  const s = m.step({ charge: true });
  assert.equal(m.truth().chargeT, 100);
  assert.equal(s.t, 0);
  assert.equal(m.step().t, 1);
});

test('操作: 火力・ダンパーが空気（ET）温度に効く', () => {
  const hi = run({ seed: 1, outlierP: 0, noise: 0 }, 400, { fire: 2, damper: 0 }).out[399].v[1];
  const lo = run({ seed: 1, outlierP: 0, noise: 0 }, 400, { fire: 0, damper: 0 }).out[399].v[1];
  const dp = run({ seed: 1, outlierP: 0, noise: 0 }, 400, { fire: 2, damper: 4 }).out[399].v[1];
  assert.ok(hi - lo > 80 && hi - lo < 100, `fire 差 ${hi - lo}`);       // 45*2 = 90
  assert.ok(hi - dp > 10 && hi - dp < 20, `damper 差 ${hi - dp}`);      // 15
});

test('ノイズ: σ=0.3 のガウス、noise:0 なら無ノイズ、外れ値は確率 1/300 で +40℃', () => {
  const clean = run({ seed: 3, noise: 0, outlierP: 0 }, 3000).out;
  const noisy = run({ seed: 3, noise: 0.3, outlierP: 0 }, 3000).out;
  const d = noisy.map((s, i) => s.v[0] - clean[i].v[0]);
  const mu = d.reduce((a, b) => a + b) / d.length;
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - mu) ** 2, 0) / d.length);
  assert.ok(Math.abs(mu) < 0.05, `平均 ${mu}`);
  assert.ok(sd > 0.27 && sd < 0.35, `σ=${sd}`);
  // 外れ値（既定確率）: 3000 点 × 3ch で約 30 個。+40 付近のみ
  const withO = run({ seed: 3, noise: 0 }, 3000).out;
  let n = 0;
  withO.forEach((s, i) => s.v.forEach((v, c) => { const e = v - clean[i].v[c]; if (Math.abs(e) > 20) { n++; assert.ok(Math.abs(e - 40) < 0.2, `外れ値の大きさ ${e}`); } }));
  assert.ok(n >= 10 && n <= 60, `外れ値 ${n} 個`);
  const all = run({ seed: 3, noise: 0, outlierP: 1 }, 20).out;
  assert.ok(all.every((s, i) => s.v.every((v, c) => Math.abs(v - run({ seed: 3, noise: 0, outlierP: 0 }, 20).out[i].v[c] - 40) < 0.2)));
});

test('故障注入: 指定区間・指定チャンネルだけ v=null, f=コード。ほかのノイズ列は変わらない', () => {
  const base = run({ seed: 2 }, 100).out;
  const { out } = run({ seed: 2, faults: [{ ch: 'c2', kind: 'open', from: 30, to: 40 }, { ch: 0, kind: 'ovuv', from: 50, to: 50 }] }, 100);
  out.forEach((s, i) => {
    const inOpen = i >= 30 && i <= 40, inOv = i === 50;
    assert.equal(s.v[1], inOpen ? null : base[i].v[1]);
    assert.equal(s.f[1], inOpen ? 1 : 0);
    assert.equal(s.v[0], inOv ? null : base[i].v[0]);
    assert.equal(s.f[0], inOv ? 4 : 0);
    assert.equal(s.v[2], base[i].v[2]);
  });
});

test('addFault: 実行中に故障を足せる', () => {
  const m = createModel({ seed: 1 });
  for (let i = 0; i < 10; i++) m.step();
  m.addFault('c1', 'short_gnd' in {} ? 'gnd' : 'gnd', 12, 13);
  const r = [m.step(), m.step(), m.step(), m.step()];   // k=10..13
  assert.deepEqual(r.map(s => s.f[0]), [0, 0, 2, 2]);
});

test('truth: 投入前は null、投入後に chargeT。1ハゼ後に fc1T/fc1eT', () => {
  const m = createModel({ seed: 1, chargeAt: 50 });
  for (let i = 0; i < 49; i++) m.step();
  assert.equal(m.truth().chargeT, null);
  m.step(); m.step();
  assert.equal(m.truth().chargeT, 50);
  assert.equal(m.truth().fc1T, null);
});

test('1ハゼ直後 30 秒は温度上昇が鈍る（RoR 急降下の再現）', () => {
  const { m, out } = run({ profile: 'drum', seed: 1, outlierP: 0, noise: 0 }, 900);
  const tr = m.truth();
  const ror = (k, w = 30) => (out[k].v[0] - out[k - w].v[0]) / w * 60;
  // 1ハゼ終了直前の RoR（発熱で高い）と、その 30 秒後の RoR で明確に下がる
  const before = ror(tr.fc1eT), after = ror(tr.fc1eT + 30);
  assert.ok(before - after > 3.5, `RoR ${before.toFixed(1)} -> ${after.toFixed(1)}`);
});

test('ブラウザ互換: @sim 区間は Node 専用 API を使わず、単体で評価できる', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'sim', 'roast-model.mjs'), 'utf8');
  const a = src.indexOf('// @sim-begin'), b = src.indexOf('// @sim-end');
  assert.ok(a > 0 && b > a);
  const body = src.slice(a, b);
  assert.doesNotMatch(body, /\b(require|process|Buffer|import|export|__dirname|setTimeout|fs\.)\b/);
  // 空のグローバルだけの sandbox で評価できる
  const ctx = vm.createContext({});
  const api = vm.runInContext(body + '\n({ createModel, mulberry32 })', ctx);
  const m = api.createModel({ seed: 1 });
  assert.equal(m.step().v.length, 3);
});

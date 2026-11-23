#!/usr/bin/env node
// 試験用データの生成（決定的。何度実行しても同じ内容になる）。
//   v1 バックアップ 3 本: legacy の toRecord / 書き出し形式どおり（ror は legacy の withRor で計算）
//   v2 記録 3 本: roast-model で series を作る（1ch 手入力 / 2ch ドラム esp32 / 3ch 手網 esp32）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModel } from '../sim/roast-model.mjs';
import { loadLegacy } from '../test/core/legacy-extract.mjs';

const OUT = path.dirname(fileURLToPath(import.meta.url));
const L = loadLegacy();
const write = (name, obj) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 1) + '\n');
const r1 = x => Math.round(x * 10) / 10;

// モデルを回して、投入からの秒 t ごとのサンプルを返す
function run(opts, dropT) {
  const m = createModel({ outlierP: 0, ...opts });
  const pre = []; const post = [];
  const end = (opts.chargeAt ?? 40) + dropT;
  while (m.k <= end) { const s = m.step(); (s.charged ? post : pre).push(s); }
  return { pre, post, truth: m.truth() };
}

// ---------------- v1 ----------------
function manualRoast({ id, seed, profile = 'drum', interval, times, dropT, events, changes, meta, tasting }) {
  const { post } = run({ profile, seed, chargeAt: 40 }, dropT + 5);
  const at = t => post[Math.min(t, post.length - 1)].v[0];
  // 手入力らしく、間隔どおり（times があればその秒）に 1 点ずつ
  const ts = times || [...Array(Math.floor(dropT / interval) + 1).keys()].map(i => i * interval);
  const points = ts.map(t => ({ t, temp: r1(at(t)) }));
  const draft = {
    id, beanId: meta.beanId, beanName: meta.beanName, origin: meta.origin, process: meta.process,
    greenWeight: meta.greenWeight, roastedWeight: meta.roastedWeight ?? null, degree: meta.degree,
    roomTemp: meta.roomTemp, weather: meta.weather, interval, initial: meta.initial,
    startedAt: meta.startedAt, dropTime: dropT, points, events, changes, memo: meta.memo || '', tasting: tasting || null,
  };
  const rec = L.toRecord(draft);
  rec.savedAt = meta.startedAt + (dropT + 90) * 1000;
  return JSON.parse(JSON.stringify(rec));
}
const sc = (a, b, c, d, e, memo, pairing, at) => ({ done: true, memo, pairing, at, acidity: a, bitterness: b, sweetness: c, aroma: d, body: e });
const S0 = { ...L.settings };
const backup = (roasts, beans, exportedAt) => ({ app: 'roastlog', version: 1, exportedAt, roasts, beans, settings: S0 });

const beanA = { id: 'bmq1a0001', name: 'エチオピア イルガチェフェ G1', origin: 'エチオピア', process: 'ウォッシュト', shop: '〇〇珈琲豆店', memo: '浅めがおいしい', createdAt: 1763000000000 };
const beanB = { id: 'bmq1b0002', name: 'ブラジル セラード', origin: 'ブラジル', process: 'ナチュラル', shop: '', memo: '', createdAt: 1763100000000 };
const beanC = { id: 'bmq1c0003', name: 'コロンビア "Huila" <特別>', origin: 'コロンビア', process: 'ウォッシュト', shop: '&friends', memo: '改行\nあり', createdAt: 1763200000000 };

// A: 30 秒間隔・フルセット（tp/dry/fc1/drop、changes、評価済み）
const ra = manualRoast({
  id: 'rmq1aaaa01', seed: 11, interval: 30, dropT: 630,
  events: [{ type: 'tp', t: 60 }, { type: 'dry', t: 300 }, { type: 'fc1', t: 540 }, { type: 'drop', t: 630 }],
  changes: [{ t: 150, kind: 'fire', value: '強' }, { t: 420, kind: 'damper', value: '1/2' }, { t: 520, kind: 'fire', value: '中' }],
  meta: { beanId: beanA.id, beanName: beanA.name, origin: beanA.origin, process: beanA.process, greenWeight: 200, roastedWeight: 171, degree: '中浅煎り', roomTemp: 18.4, weather: '晴れ', initial: { fire: '中', damper: '閉', rpm: '7' }, startedAt: 1763870000000, memo: '初回。1ハゼがきれいに聞こえた' },
  tasting: sc(4, 2, 3, 4, 2, '花のような香り。後味すっきり', 'レモンケーキ', 1763956000000),
});
// B: 60 秒間隔・最小構成（drop のみ、豆なし、評価なし）+ もう 1 件
const rb1 = manualRoast({
  id: 'rmq1bbbb01', seed: 12, interval: 60, dropT: 720,
  events: [{ type: 'drop', t: 720 }], changes: [],
  meta: { beanId: null, beanName: '', origin: '', process: '', greenWeight: null, roastedWeight: null, degree: '中煎り', roomTemp: null, weather: null, initial: { fire: '中', damper: '閉', rpm: '7' }, startedAt: 1763780000000 },
});
const rb2 = manualRoast({
  id: 'rmq1bbbb02', seed: 13, interval: 45, dropT: 585,
  events: [{ type: 'dry', t: 270 }, { type: 'fc1', t: 495 }, { type: 'drop', t: 585 }],
  changes: [{ t: 200, kind: 'knob', value: '3' }],
  meta: { beanId: beanB.id, beanName: beanB.name, origin: beanB.origin, process: beanB.process, greenWeight: 150, roastedWeight: 128.5, degree: '中深煎り', roomTemp: 22, weather: '曇り', initial: { fire: '強', damper: '1/4', rpm: '8' }, startedAt: 1763790000000, memo: '' },
});
// C: 不規則な間隔（40〜60 秒、取りこぼしあり）、1ハゼ終了・2ハゼあり、特殊文字、評価済み
const timesC = [0, 40, 85, 130, 190, 240, 300, 345, 400, 460, 520, 575, 630, 690, 735];
const rc = manualRoast({
  id: 'rmq1cccc01', seed: 14, interval: 45, times: timesC, dropT: 735,
  events: [{ type: 'tp', t: 70 }, { type: 'dry', t: 330 }, { type: 'fc1', t: 560 }, { type: 'fc1e', t: 640 }, { type: 'fc2', t: 705 }, { type: 'drop', t: 735 }],
  changes: [{ t: 100, kind: 'fire', value: '弱' }, { t: 100, kind: 'rpm', value: '6' }, { t: 600, kind: 'damper', value: '全開' }],
  meta: { beanId: beanC.id, beanName: beanC.name, origin: beanC.origin, process: beanC.process, greenWeight: 250, roastedWeight: null, degree: '深煎り', roomTemp: 15.5, weather: '雨 ☔', initial: { fire: '弱', damper: '3/4', rpm: '5' }, startedAt: 1763960000000, memo: '"深め" を狙って <script>alert(1)</script> / 改行\nテスト' },
  tasting: { ...sc(1, 5, 2, 3, 5, 'ビター。ミルク向き', 'ミルクチョコ', 1764050000000) },
});
write('v1-backup-a.json', backup([ra], [beanA], '2026-11-23T01:00:00.000Z'));
write('v1-backup-b.json', backup([rb1, rb2], [beanB], '2026-11-23T02:00:00.000Z'));
write('v1-backup-c.json', backup([rc], [beanA, beanB, beanC], '2026-11-23T03:00:00.000Z'));

// ---------------- v2 ----------------
const toV1Points = (t, v, drop) => {
  const pts = [];
  for (let i = 0; i < t.length; i++) if (t[i] >= 0 && t[i] <= drop && t[i] % 5 === 0 && v[i] != null) pts.push({ t: t[i], temp: r1(v[i] / 10) });
  return pts;
};
function autoRoast({ id, profile, seed, afterFc1, channels, offsets, gap, extra }) {
  const probe = run({ profile, seed, chargeAt: 40 }, 1500);
  const cT = probe.truth.chargeT;
  const fc1 = probe.truth.fc1T - cT;
  const dropT = fc1 + afterFc1;
  const m = createModel({ profile, seed, chargeAt: 40, outlierP: 0, noise: 0.3 });
  const data = Object.fromEntries(channels.map(c => [c.key, []]));
  const start = -30;
  const idx = { c1: 0, c2: 1, c3: 2 };
  let t0 = cT + start;
  while (m.k < t0) m.step();
  for (let t = start; t <= dropT; t++) {
    const s = m.step();
    const inGap = gap && t >= gap[0] && t <= gap[1];
    for (const c of channels) data[c.key].push(inGap ? null : Math.round((s.v[idx[c.key]] + (offsets[c.key] || 0)) * 10));
  }
  const bt = data.c1;
  const tt = i => start + i;
  const tpRel = probe.truth.tpT != null ? probe.truth.tpT - cT : 0;
  const dryI = bt.findIndex((v, i) => tt(i) > tpRel && v != null && v >= 1500);
  const ev = [];
  if (probe.truth.tpT != null) ev.push({ type: 'tp', t: probe.truth.tpT - cT, auto: true });
  ev.push({ type: 'dry', t: tt(dryI) }, { type: 'fc1', t: fc1 }, { type: 'drop', t: dropT });
  const tarr = bt.map((_, i) => tt(i));
  return {
    schema: 2, id, ...extra.meta, startedAt: extra.startedAt, dropTime: dropT,
    events: ev, changes: extra.changes, memo: extra.memo || '', tasting: extra.tasting || null,
    savedAt: extra.startedAt + (dropT + 120) * 1000,
    source: 'esp32',
    device: { model: 'RL-C3-2', fw: '0.3.0', amp: 'max31856', id: 'a4cf12' },
    channels: channels.map(c => ({ ...c, offset: offsets[c.key] || 0 })),
    primary: 'c1',
    series: { dt: 1, start, scale: 10, data },
    gaps: gap ? [{ from: gap[0], to: gap[1] }] : [],
    rorConfig: { method: 'lsq', window: profile === 'tenami' ? 60 : 30, smooth: 5 },
    points: toV1Points(tarr, bt, dropT),
  };
}

// v2-1: 手入力（series なし）
{
  const r = manualRoast({
    id: 'rmq2manual1', seed: 15, interval: 30, dropT: 600,
    events: [{ type: 'dry', t: 290 }, { type: 'fc1', t: 510 }, { type: 'drop', t: 600 }],
    changes: [{ t: 120, kind: 'fire', value: '強' }],
    meta: { beanId: beanA.id, beanName: beanA.name, origin: beanA.origin, process: beanA.process, greenWeight: 200, roastedWeight: 172, degree: '中煎り', roomTemp: 19, weather: '晴れ', initial: { fire: '中', damper: '閉', rpm: '7' }, startedAt: 1764100000000 },
  });
  delete r.points.ror;
  r.points = r.points.map(p => ({ t: p.t, temp: p.temp }));
  Object.assign(r, { schema: 2, source: 'manual', channels: [{ key: 'c1', role: 'et', name: '排気温度', color: '#C2410C', offset: 0 }], primary: 'c1' });
  write('v2-manual-1ch.json', r);
}
// v2-2: ドラム 2ch（gap あり、TP 自動）
write('v2-esp32-drum-2ch.json', autoRoast({
  id: 'rmq2drum002', profile: 'drum', seed: 21, afterFc1: 110,
  channels: [{ key: 'c1', role: 'bt', name: '豆温度', color: '#C2410C' }, { key: 'c2', role: 'et', name: '排気', color: '#7A5AA6' }],
  offsets: { c1: -0.8, c2: 0 }, gap: [301, 318],
  extra: {
    startedAt: 1764200000000,
    meta: { beanId: beanA.id, beanName: beanA.name, origin: beanA.origin, process: beanA.process, greenWeight: 200, roastedWeight: 170, degree: '中煎り', roomTemp: 18.4, weather: null, interval: 30, initial: { fire: '強', damper: '1', rpm: '7' } },
    changes: [{ t: 120, kind: 'fire', value: '強' }],
    tasting: { done: true, memo: '甘みが出た', pairing: '', at: 1764290000000, acidity: 3, bitterness: 2, sweetness: 4, aroma: 3, body: 3 },
  },
}));
// v2-3: 手網 3ch（TP なし、RoR 窓 60 秒）
write('v2-esp32-tenami-3ch.json', autoRoast({
  id: 'rmq2tenami3', profile: 'tenami', seed: 31, afterFc1: 120,
  channels: [{ key: 'c1', role: 'bt', name: '豆温度', color: '#C2410C' }, { key: 'c2', role: 'et', name: '排気', color: '#7A5AA6' }, { key: 'c3', role: 'amb', name: '外気温', color: '#6B7280' }],
  offsets: { c1: 0, c2: 0, c3: 0.4 }, gap: null,
  extra: {
    startedAt: 1764300000000,
    meta: { beanId: beanB.id, beanName: beanB.name, origin: beanB.origin, process: beanB.process, greenWeight: 100, roastedWeight: 84, degree: '中深煎り', roomTemp: 20, weather: '曇り', interval: 30, initial: { fire: '中', height: '低', shake: '普通' } },
    changes: [{ t: 180, kind: 'fire', value: '強' }, { t: 420, kind: 'height', value: '高' }],
  },
}));
console.log('fixtures を書き出しました:', fs.readdirSync(OUT).filter(f => f.endsWith('.json')).join(', '));

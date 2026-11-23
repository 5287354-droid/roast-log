import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../lib/mini-schema.mjs';
import { validateRoast, validateWs, roastSchema } from '../lib/schemas.mjs';
import { loadLegacy, extractFunction, legacySource } from './legacy-extract.mjs';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');
const load = n => JSON.parse(fs.readFileSync(path.join(FIX, n), 'utf8'));
const V1 = ['v1-backup-a.json', 'v1-backup-b.json', 'v1-backup-c.json'];
const V2 = ['v2-manual-1ch.json', 'v2-esp32-drum-2ch.json', 'v2-esp32-tenami-3ch.json'];
const J = x => JSON.parse(JSON.stringify(x));   // vm 由来の配列を通常の Array にする

test('mini-schema: 型・必須・enum・pattern・oneOf・$ref を検出する', () => {
  const s = { $defs: { n: { type: 'integer', minimum: 0 } }, type: 'object', required: ['a'], properties: { a: { $ref: '#/$defs/n' }, b: { enum: ['x', 'y'] }, c: { type: ['string', 'null'], pattern: '^z' } } };
  assert.deepEqual(validate(s, { a: 1, b: 'x', c: null }), []);
  assert.equal(validate(s, {}).length, 1);
  assert.equal(validate(s, { a: -1 }).length, 1);
  assert.equal(validate(s, { a: 1.5 }).length, 1);
  assert.equal(validate(s, { a: 1, b: 'q' }).length, 1);
  assert.equal(validate(s, { a: 1, c: 'abc' }).length, 1);
  assert.equal(validate({ oneOf: [{ type: 'string' }, { type: 'integer' }] }, true).length, 1);
});

test('ws-messages schema: 正しいメッセージを通し、壊れたものを落とす', () => {
  assert.deepEqual(validateWs({ type: 's', seq: 913, ms: 913002, v: [1983, 2107, null], f: [0, 0, 0], cj: 254 }), []);
  assert.ok(validateWs({ type: 's', seq: 913, ms: 913002, v: [198.3, 2107, null], f: [0, 0, 0], cj: 254 }).length > 0, '小数は不可');
  assert.ok(validateWs({ type: 's', seq: 1, ms: 1, v: [1, 2], f: [0, 0, 0], cj: 1 }).length > 0, '2ch は不可');
  assert.ok(validateWs({ type: 's', seq: 1, ms: 1, v: [1, 2, 3], f: [0, 9, 0], cj: 1 }).length > 0, '故障コード 9 は不可');
  assert.deepEqual(validateWs({ type: 'ack', id: 'c18', ok: false, err: 'bad_channel' }), []);
  assert.deepEqual(validateWs({ type: 'pong', id: 'p5', t: 1763870000123, ms: 913500 }), []);
  assert.deepEqual(validateWs({ type: 'hi', app: 'roastlog', ver: '2.0.0', bootId: '9f31c2aa', lastSeq: 699 }), []);
  assert.deepEqual(validateWs({ type: 'bf', from: 700, to: 702, lost: false, ms0: 700001, dt: 1000, v: [[1, 2, 3], [4, 5, 6], [null, null, null]], f: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] }), []);
  assert.deepEqual(validateWs({ type: 'setcfg', id: 'c17', channels: [{ idx: 0, offset: -0.8 }], amp: { mains: 60, avg: 4 } }), []);
  assert.ok(validateWs({ type: 'zzz' }).length > 0);
});

for (const f of V1) {
  test(`${f}: v1 バックアップの形（legacy の書き出し形式）`, () => {
    const b = load(f);
    assert.equal(b.app, 'roastlog'); assert.equal(b.version, 1);
    assert.ok(Array.isArray(b.roasts) && b.roasts.length >= 1);
    assert.ok(Array.isArray(b.beans));
    assert.equal(typeof b.settings.rorWindow, 'number');
    for (const r of b.roasts) {
      assert.equal(r.schema, undefined, 'v1 に schema は無い');
      for (const k of ['id', 'beanId', 'beanName', 'origin', 'process', 'greenWeight', 'roastedWeight', 'degree', 'roomTemp', 'weather', 'interval', 'initial', 'startedAt', 'dropTime', 'points', 'events', 'changes', 'memo', 'tasting', 'savedAt']) assert.ok(k in r, `${k} が無い`);
      assert.equal(r.points[0].t, 0, '0:00 の投入温度がある');
      const gaps = r.points.slice(1).map((p, i) => p.t - r.points[i].t);
      assert.ok(gaps.every(g => g >= 30 && g <= 60), `手入力らしい 30〜60 秒間隔: ${gaps}`);
      assert.ok(r.points.every(p => 'ror' in p));
      assert.ok(r.events.some(e => e.type === 'drop' && e.t === r.dropTime));
      assert.ok(r.points.at(-1).t <= r.dropTime);
    }
  });
  test(`${f}: 保存された ror は legacy の withRor の再計算と一致する（RoR 方式の互換基準）`, () => {
    const b = load(f); const L = loadLegacy(b.settings);
    for (const r of b.roasts) {
      const again = J(L.withRor(r.points.map(p => ({ t: p.t, temp: p.temp }))));
      assert.deepEqual(again.map(p => p.ror), r.points.map(p => p.ror));
    }
  });
}

test('v1 バックアップ: 3 本で内容に変化がある（間隔・イベント・評価・特殊文字）', () => {
  const rs = V1.flatMap(f => load(f).roasts);
  assert.ok(rs.length >= 4);
  assert.ok(new Set(rs.map(r => r.interval)).size >= 3);
  assert.ok(rs.some(r => r.tasting?.done) && rs.some(r => !r.tasting));
  assert.ok(rs.some(r => r.changes.length >= 3) && rs.some(r => r.changes.length === 0));
  assert.ok(rs.some(r => r.events.some(e => e.type === 'fc2')));
  assert.ok(rs.some(r => r.events.length === 1));
  assert.ok(rs.some(r => /<script>/.test(r.memo)), 'HTML エスケープ試験用の文字');
  assert.ok(rs.some(r => r.roastedWeight == null));
});

test('legacy の stats が v1 fixtures で動く（TP 推定・DTR・減量率）', () => {
  const L = loadLegacy();
  const r = load('v1-backup-a.json').roasts[0];
  const s = J(L.stats(r));
  assert.equal(s.total, 630); assert.equal(s.fc, 540); assert.equal(s.dev, 90);
  assert.equal(s.dtr, 14.3); assert.equal(s.loss, 14.5);
  assert.equal(s.tp, 60); assert.equal(s.tpAuto, false);
  assert.equal(s.charge, r.points[0].temp);
});

for (const f of V2) {
  test(`${f}: v2 記録が schema に適合し、内部が整合している`, () => {
    const r = load(f);
    assert.deepEqual(validateRoast(r), []);
    assert.equal(r.schema, 2);
    assert.ok(r.channels.some(c => c.key === r.primary));
    assert.ok(r.points.every(p => p.t >= 0 && p.t <= r.dropTime));
    if (r.series) {
      const { dt, start, data } = r.series;
      const n = Math.floor((r.dropTime - start) / dt) + 1;
      for (const c of r.channels) assert.equal(data[c.key].length, n, `${c.key} の長さ`);
      assert.deepEqual(Object.keys(data).sort(), r.channels.map(c => c.key).sort());
      // points は主チャンネルの 5 秒間隔
      const bt = data[r.primary];
      const exp = [];
      for (let t = 0; t <= r.dropTime; t += 5) { const v = bt[(t - start) / dt]; if (v != null) exp.push({ t, temp: Math.round(v) / 10 }); }
      assert.deepEqual(r.points, exp);
      assert.ok(r.series.start === -30);
    }
  });
}

test('v2 fixtures: 1ch 手入力 / 2ch ドラム / 3ch 手網', () => {
  const m = load('v2-manual-1ch.json'), d = load('v2-esp32-drum-2ch.json'), t = load('v2-esp32-tenami-3ch.json');
  assert.equal(m.source, 'manual'); assert.equal(m.series, undefined); assert.equal(m.channels.length, 1); assert.equal(m.channels[0].role, 'et');
  assert.equal(d.source, 'esp32'); assert.equal(d.channels.length, 2);
  assert.deepEqual(d.gaps, [{ from: 301, to: 318 }]);
  const gi = 301 - d.series.start;
  assert.ok(d.series.data.c1[gi] === null && d.series.data.c1[gi - 1] !== null && d.series.data.c1[318 - d.series.start + 1] !== null);
  const tp = d.events.find(e => e.type === 'tp'); assert.ok(tp.auto && tp.t >= 60 && tp.t <= 120);
  assert.equal(t.source, 'esp32'); assert.equal(t.channels.length, 3);
  assert.equal(t.events.some(e => e.type === 'tp'), false, '手網は TP なし');
  assert.equal(t.rorConfig.window, 60);
  assert.deepEqual(t.channels.map(c => c.role), ['bt', 'et', 'amb']);
  // 3ch・20 分でも 35KB 以下（7.3 の容量）
  assert.ok(JSON.stringify(t).length < 35000, `3ch ${JSON.stringify(t).length}B`);
  assert.ok(JSON.stringify(d).length < 25000);
});

test('fixtures は決定的（make-fixtures を再実行しても同じ）', async () => {
  const before = Object.fromEntries([...V1, ...V2].map(f => [f, fs.readFileSync(path.join(FIX, f), 'utf8')]));
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [path.join(FIX, 'make-fixtures.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  for (const f of [...V1, ...V2]) assert.equal(fs.readFileSync(path.join(FIX, f), 'utf8'), before[f], f);
});

test('legacy-extract: withRor / evTime / toRecord を legacy から抜き出して評価できる', () => {
  const src = legacySource();
  assert.match(extractFunction(src, 'withRor'), /^function withRor\(points\) \{[\s\S]*\}$/);
  const L = loadLegacy({ rorWindow: 30 });
  const out = J(L.withRor([{ t: 0, temp: 100 }, { t: 30, temp: 130 }, { t: 60, temp: 150 }]));
  assert.deepEqual(out.map(p => p.ror), [null, 60, 40]);      // 窓 30 秒: 30℃/30秒 = 60℃/分
  assert.equal(L.evTime({ events: [{ type: 'fc1', t: 500 }] }, 'fc1'), 500);
  assert.equal(L.fmt(125), '2:05');
  assert.throws(() => extractFunction(src, 'noSuchFunction'));
  assert.ok(roastSchema.properties.schema);
});

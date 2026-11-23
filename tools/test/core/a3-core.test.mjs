// A3: 校正・診断・欠測の純粋関数（RoastCore）と、手網の既定値（S3）、despike の下限（-30℃）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(src.slice(src.indexOf('// @core-begin'), src.indexOf('// @core-end')), ctx);
const C = ctx.window.RoastCore;

test('boilPoint: 標高で 0.0033℃/m 下がる', () => {
  assert.equal(C.boilPoint(0), 100);
  assert.equal(C.boilPoint(500), 98.35);
  assert.equal(C.boilPoint(1000), 96.7);
  assert.equal(C.boilPoint('x'), 100);
});
test('calStats: 平均と標準偏差（n-1）。null は除く', () => {
  const q = C.calStats([1, 2, 3, 4, null]);
  assert.equal(q.n, 4); assert.equal(q.mean, 2.5); assert.ok(Math.abs(q.sd - 1.2909944) < 1e-6);
  assert.equal(C.calStats([]).mean, null);
  assert.ok(C.calStats([20.0, 20.05, 19.95, 20.0, 20.02, 19.98, 20.0, 20.01, 19.99, 20.0]).sd < 0.2, '安定');
  assert.ok(C.calStats([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]).sd > 0.2, '上昇中はばらつき大');
});
test('trend: つまんで上がった/下がった/変わらない', () => {
  const flat = Array(20).fill(22), up = [...Array(12).fill(22), 22.5, 23, 24, 25, 25.5, 26, 26.5, 27], dn = [...Array(12).fill(22), 21.5, 21, 20.5, 20, 20, 20, 20, 20];
  assert.ok(Math.abs(C.trend(flat)) < 0.01); assert.ok(C.trend(up) >= 3); assert.ok(C.trend(dn) <= -1.5);
  assert.equal(C.trend([22, 22, 22]), null);
});
test('removeGap: 受け取れた秒を欠測から外す（端・まん中・単独）', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(C.removeGap([[10, 20]], 10))), [[11, 20]]);
  assert.deepEqual(JSON.parse(JSON.stringify(C.removeGap([[10, 20]], 20))), [[10, 19]]);
  assert.deepEqual(JSON.parse(JSON.stringify(C.removeGap([[10, 20]], 15))), [[10, 14], [16, 20]]);
  assert.deepEqual(JSON.parse(JSON.stringify(C.removeGap([[10, 10], [30, 40]], 10))), [[30, 40]]);
  assert.deepEqual(JSON.parse(JSON.stringify(C.removeGap([[10, 20]], 5))), [[10, 20]]);
});
test('S3: RoR の窓は手網 60 秒・ドラム 30 秒（設定が空のとき）。設定の値があればそちら', () => {
  assert.equal(C.rorCreate({ roasterType: 'tenami' }).W, 60);
  assert.equal(C.rorCreate({ roasterType: 'drum' }).W, 30);
  assert.equal(C.rorCreate({ roasterType: 'tenami', rorWindowAuto: null }).W, 60);
  assert.equal(C.rorCreate({ roasterType: 'tenami', rorWindowAuto: 15 }).W, 15);
});
test('despike: 0℃未満の外気温（-30℃まで）は捨てない', () => {
  const p = [], st = { pend: [] };
  assert.equal(C.despike(p, -5, st), -5); assert.equal(C.despike(p, -4.5, st), -4.5);
  assert.equal(C.despike([], -40, { pend: [] }), null);
});
test('手網のタイル用: 中点がないとき maxRor は 2 分以降、150℃到達の時刻を出す', () => {
  const v = []; for (let t = 0; t <= 400; t++) v.push(Math.round((20 + t * 0.6) * 10)); // 20℃から 0.6℃/秒で一直線
  const rec = { schema: 2, id: 'x', startedAt: 1, dropTime: 400, events: [{ type: 'drop', t: 400 }], channels: [{ key: 'c1', role: 'bt', name: 'BT', color: '#c00' }], primary: 'c1', source: 'esp32', roasterType: 'tenami',
    series: { dt: 1, start: 0, scale: 10, data: { c1: v } }, points: [] };
  const s = C.stats(rec, { rorSmooth: 0 });
  assert.equal(s.tp, null); assert.ok(s.tenami);
  assert.ok(Math.abs(s.maxRor - 36) < 1, `maxRor ${s.maxRor}`);
  assert.ok(Math.abs(s.reach - 217) <= 1, `150℃ 到達 ${s.reach}`);
  const s2 = C.stats({ ...rec, noAutoTp: true }, {}); assert.equal(s2.tp, null);
});
test('M-h: noAutoTp の記録は、保存後も自動の中点を復活させない', () => {
  const v = []; for (let t = 0; t <= 300; t++) v.push(Math.round((t < 80 ? 200 - t * 1.4 : 88 + (t - 80) * 0.7) * 10));
  const rec = { schema: 2, id: 'x', startedAt: 1, dropTime: 300, events: [{ type: 'drop', t: 300 }], channels: [{ key: 'c1', role: 'bt', name: 'BT', color: '#c00' }], primary: 'c1', source: 'esp32', series: { dt: 1, start: 0, scale: 10, data: { c1: v } }, points: [] };
  assert.ok(C.stats(rec, {}).tp != null, 'ドラムの形なら自動の中点が出る');
  assert.equal(C.stats({ ...rec, noAutoTp: true }, {}).tp, null);
  assert.ok(C.normalizeRecord({ ...rec, noAutoTp: true }).noAutoTp, '未知でなく保持される');
});

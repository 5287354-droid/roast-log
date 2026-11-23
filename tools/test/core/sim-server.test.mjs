import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { startServer, parseArgs } from '../../sim/server.mjs';
import { validateWs } from '../lib/schemas.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SPEED = 100; // 1 サンプル = 10ms

function connect(url, hi) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const c = { ws, log: [], closed: false };
    ws.on('message', d => c.log.push(JSON.parse(d.toString())));
    ws.on('close', () => { c.closed = true; });
    ws.on('error', reject);
    ws.on('open', () => { if (hi) ws.send(JSON.stringify({ type: 'hi', app: 't', ver: '0', bootId: null, lastSeq: null, ...hi })); resolve(c); });
  });
}
async function until(fn, ms = 3000) { const end = Date.now() + ms; while (Date.now() < end) { const r = fn(); if (r) return r; await sleep(5); } throw new Error('timeout'); }
const ss = c => c.log.filter(m => m.type === 's');

test('parseArgs: SPEC 7.2 の CLI', () => {
  const a = parseArgs(['--port', '9000', '--speed', '20', '--profile', 'tenami', '--seed', '3', '--charge-at', '40', '--disconnect', '300:20', '--fault', 'c2:open@400-420', '--reboot-at', '500']);
  assert.equal(a.port, 9000); assert.equal(a.speed, 20); assert.equal(a.profile, 'tenami'); assert.equal(a.seed, 3);
  assert.deepEqual(a.disconnect, [{ at: 300, dur: 20 }]);
  assert.deepEqual(a.fault, [{ ch: 1, kind: 'open', from: 400, to: 420 }]);
  assert.deepEqual(a.rebootAt, [500]);
  assert.throws(() => parseArgs(['--fault', 'x']));
});

test('HTTP: / は HTML、/api/info、/api/sim/truth', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', speed: SPEED, quiet: true });
  try {
    const html = await fetch(srv.url + '/').then(r => r.text());
    assert.match(html, /<html|<!doctype/i);
    const info = await fetch(srv.url + '/api/info').then(r => r.json());
    assert.equal(info.proto, 1); assert.equal(info.sim, true); assert.match(info.bootId, /^[0-9a-f]{8}$/);
    await sleep(100);
    const tr = await fetch(srv.url + '/api/sim/truth').then(r => r.json());
    assert.ok(tr.seq > 0); assert.equal(tr.profile, 'drum');
    assert.equal((await fetch(srv.url + '/nope')).status, 404);
  } finally { await srv.close(); }
});

test('WS: hi → hello（schema 準拠）→ s が連続', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', speed: SPEED, quiet: true });
  try {
    const c = await connect(srv.wsUrl, {});
    const h = await until(() => c.log.find(m => m.type === 'hello'));
    assert.deepEqual(validateWs(h), []);
    await until(() => ss(c).length >= 30);
    ss(c).forEach(m => assert.deepEqual(validateWs(m), []));
    ss(c).forEach((m, i, a) => { if (i) { assert.equal(m.seq, a[i - 1].seq + 1); assert.equal(m.ms, a[i - 1].ms + 1000); } });
    // 無効チャンネル(c3)は null / f=0
    assert.ok(ss(c).every(m => m.v[2] === null && m.f[2] === 0));
    c.ws.close();
  } finally { await srv.close(); }
});

test('WS: hi が無くても hello が来る（1 秒後）', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', speed: SPEED, quiet: true });
  try {
    const c = await connect(srv.wsUrl);
    await sleep(300);
    assert.equal(c.log.some(m => m.type === 'hello'), false);
    await until(() => c.log.find(m => m.type === 'hello'), 1500);
    c.ws.close();
  } finally { await srv.close(); }
});

test('バックフィル: lastSeq 以降が bf で返り、連続する。範囲外は lost:true', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', speed: SPEED, quiet: true });
  try {
    await sleep(500); // ~50 サンプル
    const c = await connect(srv.wsUrl, { bootId: srv.bootId, lastSeq: 5 });
    const h = await until(() => c.log.find(m => m.type === 'hello'));
    const bf = await until(() => c.log.find(m => m.type === 'bf'));
    assert.deepEqual(validateWs(bf), []);
    assert.equal(bf.from, 6); assert.equal(bf.lost, false);
    assert.ok(bf.to >= h.seq);
    assert.equal(bf.v[0].length, bf.to - bf.from + 1);
    assert.equal(bf.ms0, 6000 + (h.ms - h.seq * 1000));
    // bootId が違えば bf は来ない
    const d = await connect(srv.wsUrl, { bootId: 'deadbeef', lastSeq: 5 });
    await until(() => d.log.find(m => m.type === 'hello'));
    await sleep(100);
    assert.equal(d.log.some(m => m.type === 'bf'), false);
    // 300 件超は複数フレームに分割
    await sleep(3500); // 350+ サンプル
    const e = await connect(srv.wsUrl, { bootId: srv.bootId, lastSeq: 0 });
    await until(() => e.log.filter(m => m.type === 'bf').length >= 2);
    const bfs = e.log.filter(m => m.type === 'bf');
    assert.equal(bfs[0].to - bfs[0].from + 1, 300);
    assert.equal(bfs[1].from, bfs[0].to + 1);
    c.ws.close(); d.ws.close(); e.ws.close();
  } finally { await srv.close(); }
});

test('リングバッファ 3600: 古い範囲は lost:true で最古から', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', speed: 1000, quiet: true });
  try {
    await until(() => srv.seq > 3700, 10000);
    const c = await connect(srv.wsUrl, {});
    const h = await until(() => c.log.find(m => m.type === 'hello'));
    assert.ok(h.bufFrom > 1);
    assert.ok(h.seq - h.bufFrom + 1 <= 3600);
    c.ws.send(JSON.stringify({ type: 'bf_req', from: 1, to: 20 }));
    const bf = await until(() => c.log.find(m => m.type === 'bf'));
    assert.equal(bf.lost, true);
    assert.ok(bf.from >= h.bufFrom - 1);
    c.ws.close();
  } finally { await srv.close(); }
});

test('setcfg / cfg / ack / pong / identify / 不正入力', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', speed: SPEED, quiet: true });
  try {
    const a = await connect(srv.wsUrl, {}), b = await connect(srv.wsUrl, {});
    await until(() => a.log.find(m => m.type === 'hello') && b.log.find(m => m.type === 'hello'));
    const send = (c, o) => c.ws.send(JSON.stringify(o));
    send(a, { type: 'setcfg', id: 'x1', channels: [{ idx: 2, enabled: true, role: 'amb', name: '外気温', offset: 0.4 }], amp: { mains: 60 } });
    const ack = await until(() => a.log.find(m => m.type === 'ack' && m.id === 'x1'));
    assert.equal(ack.ok, true);
    const cfgB = await until(() => b.log.find(m => m.type === 'cfg'));   // 他のクライアントにも届く
    assert.deepEqual(validateWs(cfgB), []);
    assert.equal(cfgB.channels[2].enabled, true); assert.equal(cfgB.amp.mains, 60);
    await until(() => ss(a).some(m => m.v[2] !== null));
    // 不正
    send(a, { type: 'setcfg', id: 'x2', channels: [{ idx: 3 }] });
    assert.deepEqual((await until(() => a.log.find(m => m.id === 'x2'))).err, 'bad_channel');
    send(a, { type: 'setcfg', id: 'x3', channels: [{ idx: 0, role: 'zzz' }] });
    assert.equal((await until(() => a.log.find(m => m.id === 'x3'))).ok, false);
    send(a, { type: 'setcfg', id: 'x4', amp: { mains: 55 } });
    assert.equal((await until(() => a.log.find(m => m.id === 'x4'))).ok, false);
    send(a, { type: 'nope', id: 'x5' });
    assert.equal((await until(() => a.log.find(m => m.id === 'x5'))).ok, false);
    a.ws.send('not json');   // 無視（切断しない）
    send(a, { type: 'ping', id: 'p1', t: 1 });
    const pong = await until(() => a.log.find(m => m.type === 'pong'));
    assert.deepEqual(validateWs(pong), []); assert.equal(pong.id, 'p1');
    send(a, { type: 'identify', id: 'i1' });
    assert.equal((await until(() => a.log.find(m => m.id === 'i1'))).ok, true);
    a.ws.close(); b.ws.close();
  } finally { await srv.close(); }
});

test('offset は v に足される', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', speed: SPEED, quiet: true, noise: 0, chargeAt: null });
  try {
    const a = await connect(srv.wsUrl, {});
    await until(() => ss(a).length >= 3);
    const base = ss(a).slice(-1)[0];
    a.ws.send(JSON.stringify({ type: 'setcfg', id: 'o', channels: [{ idx: 1, offset: -5 }] }));
    await until(() => a.log.find(m => m.id === 'o'));
    const k = a.log.length;
    await until(() => a.log.slice(k).filter(m => m.type === 's').length >= 2);
    const after = a.log.slice(k).find(m => m.type === 's');
    // 投入前の ET は緩やかにしか動かない（|Δ| < 1℃/s）ので、-50(=-5.0℃) が見えるはず
    assert.ok(after.v[1] - base.v[1] < -30, `${after.v[1]} - ${base.v[1]}`);
    a.ws.close();
  } finally { await srv.close(); }
});

test('--fault: 指定区間の指定チャンネルだけ f=1, v=null（seq 基準）', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', speed: SPEED, quiet: true, fault: [{ ch: 1, kind: 'open', from: 20, to: 30 }] });
  try {
    const c = await connect(srv.wsUrl, { bootId: srv.bootId, lastSeq: 0 });
    await until(() => srv.seq > 45);
    c.ws.send(JSON.stringify({ type: 'bf_req', from: 1, to: 40 }));
    const bf = await until(() => c.log.filter(m => m.type === 'bf').find(m => m.to >= 40 && m.from === 1));
    for (let s = 1; s <= 40; s++) {
      const bad = s >= 20 && s <= 30;      // seq = 仮想秒 なので seq 20..30
      assert.equal(bf.f[1][s - 1], bad ? 1 : 0, `seq ${s}`);
      assert.equal(bf.v[1][s - 1] === null, bad, `seq ${s} v`);
      assert.equal(bf.f[0][s - 1], 0);
    }
    c.ws.close();
  } finally { await srv.close(); }
});

test('--disconnect: その間は接続を拒否・切断し、終わると再接続できる。切断中もバッファは進む', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', speed: SPEED, quiet: true, disconnect: [{ at: 30, dur: 40 }] });
  try {
    const c = await connect(srv.wsUrl, {});
    await until(() => c.closed, 3000);
    const lastSeq = ss(c).slice(-1)[0].seq;
    assert.ok(lastSeq >= 28 && lastSeq <= 31, `lastSeq=${lastSeq}`);
    await assert.rejects(connect(srv.wsUrl, {}));
    await until(() => srv.seq >= 75, 3000);
    const d = await connect(srv.wsUrl, { bootId: srv.bootId, lastSeq });
    await until(() => d.log.some(m => m.type === 's') && d.log.some(m => m.type === 'bf'));
    const got = new Set();
    d.log.forEach(m => { if (m.type === 'bf') for (let s = m.from; s <= m.to; s++) got.add(s); else if (m.type === 's') got.add(m.seq); });
    const top = Math.max(...got);
    for (let s = lastSeq + 1; s <= top; s++) assert.ok(got.has(s), `欠損 ${s}`);
    assert.ok(top - lastSeq >= 40);
    d.ws.close();
  } finally { await srv.close(); }
});

test('--reboot-at: bootId が変わり seq が 1 から。古い bootId の lastSeq には bf を返さない', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', speed: SPEED, quiet: true, rebootAt: [40] });
  try {
    const c = await connect(srv.wsUrl, {});
    const h1 = await until(() => c.log.find(m => m.type === 'hello'));
    await until(() => c.closed, 3000);
    const last = ss(c).slice(-1)[0].seq;
    assert.ok(last >= 38 && last <= 40);
    let d;
    for (let i = 0; i < 100 && !d; i++) { try { d = await connect(srv.wsUrl, { bootId: h1.bootId, lastSeq: last }); } catch { await sleep(10); } }
    assert.ok(d, '再接続できた');
    const h2 = await until(() => d.log.find(m => m.type === 'hello'));
    assert.notEqual(h2.bootId, h1.bootId);
    assert.ok(h2.seq < 10);
    await until(() => ss(d).length >= 3);
    assert.equal(ss(d)[0].seq <= h2.seq + 2, true);
    assert.equal(d.log.some(m => m.type === 'bf'), false);
    d.ws.close();
  } finally { await srv.close(); }
});

test('conformance.mjs が sim サーバ（--speed 20）に対して通る', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', speed: 20, quiet: true });
  try {
    const p = spawn(process.execPath, [path.join(ROOT, 'tools/test/proto/conformance.mjs'), '--url', srv.wsUrl], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    const code = await new Promise(r => p.on('close', r));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /not ok/);
    assert.match(out, /# \d+\/\d+ passed/);
  } finally { await srv.close(); }
});

test('9.5 送る順番: hi{lastSeq} の接続では hello → bf をすべて → s。--bf-delay（試験用）では s が先になる', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', speed: SPEED, quiet: true });
  try {
    await sleep(4000); // 400 サンプル（bf は 2 フレーム）
    const c = await connect(srv.wsUrl, { bootId: srv.bootId, lastSeq: 3 });
    await until(() => ss(c).length >= 3);
    const ty = c.log.map(m => m.type).filter(t => t !== 'st');
    const ih = ty.indexOf('hello'), lb = ty.lastIndexOf('bf'), fs = ty.indexOf('s');
    assert.ok(ih === 0 && ty.filter(t => t === 'bf').length >= 2 && fs > lb, '順番: ' + ty.slice(0, 6).join(','));
    c.ws.close();
  } finally { await srv.close(); }
  const s2 = await startServer({ port: 0, host: '127.0.0.1', speed: SPEED, quiet: true, bfDelay: 300 });
  try {
    await sleep(500);
    const c = await connect(s2.wsUrl, { bootId: s2.bootId, lastSeq: 3 });
    await until(() => c.log.some(m => m.type === 'bf'));
    const ty = c.log.map(m => m.type); assert.ok(ty.indexOf('s') < ty.indexOf('bf'), '--bf-delay では s が bf より先: ' + ty.slice(0, 6).join(','));
    c.ws.close();
  } finally { await s2.close(); }
});

test('9.5 cfg.rev と setcfg{baseRev}: 変更で +1、古い baseRev は stale（何も変えない）、baseRev なしは従来どおり受け付ける', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', speed: SPEED, quiet: true });
  try {
    const a = await connect(srv.wsUrl, {});
    const h = await until(() => a.log.find(m => m.type === 'hello')); const r0 = h.cfg.rev;
    assert.ok(Number.isInteger(r0)); assert.deepEqual(validateWs(h), []);
    a.ws.send(JSON.stringify({ type: 'setcfg', id: 'a', baseRev: r0, channels: [{ idx: 1, offset: -1 }] }));
    const ack = await until(() => a.log.find(m => m.type === 'ack' && m.id === 'a')); assert.equal(ack.ok, true); assert.equal(ack.rev, r0 + 1);
    const cfg = await until(() => a.log.find(m => m.type === 'cfg')); assert.equal(cfg.rev, r0 + 1); assert.deepEqual(validateWs(cfg), []);
    a.ws.send(JSON.stringify({ type: 'setcfg', id: 'b', baseRev: r0, channels: [{ idx: 0, name: 'zz' }] }));
    const nak = await until(() => a.log.find(m => m.type === 'ack' && m.id === 'b'));
    assert.deepEqual({ ok: nak.ok, err: nak.err, rev: nak.rev }, { ok: false, err: 'stale', rev: r0 + 1 }); assert.deepEqual(validateWs(nak), []);
    const st = await fetch(srv.url + '/api/sim/state').then(r => r.json()); assert.equal(st.cfg.channels[0].name, '豆温度'); assert.equal(st.cfg.channels[1].offset, -1);
    a.ws.send(JSON.stringify({ type: 'setcfg', id: 'c', channels: [{ idx: 0, name: 'yy' }] }));
    assert.equal((await until(() => a.log.find(m => m.type === 'ack' && m.id === 'c'))).ok, true);
    a.ws.close();
  } finally { await srv.close(); }
});

test('--amp max31855: hello・/api/info の amp。setcfg の amp は unsupported（channels だけなら受け付ける）。--room-temp は室温のまま', async () => {
  assert.throws(() => parseArgs(['--amp', 'max9999']));
  const srv = await startServer({ port: 0, host: '127.0.0.1', speed: SPEED, quiet: true, amp: 'max31855', roomTemp: 22 });
  try {
    const info = await fetch(srv.url + '/api/info').then(r => r.json()); assert.equal(info.amp, 'max31855');
    const a = await connect(srv.wsUrl, {});
    const h = await until(() => a.log.find(m => m.type === 'hello')); assert.equal(h.amp, 'max31855'); assert.equal(h.cfg.amp.type, 'max31855');
    a.ws.send(JSON.stringify({ type: 'setcfg', id: 'u', amp: { mains: 60 } }));
    const nak = await until(() => a.log.find(m => m.type === 'ack' && m.id === 'u')); assert.equal(nak.ok, false); assert.equal(nak.err, 'unsupported');
    a.ws.send(JSON.stringify({ type: 'setcfg', id: 'v', channels: [{ idx: 0, offset: 0.5 }], amp: { avg: 8 } }));
    assert.equal((await until(() => a.log.find(m => m.type === 'ack' && m.id === 'v'))).err, 'unsupported', 'amp を含むと全体を受け付けない');
    a.ws.send(JSON.stringify({ type: 'setcfg', id: 'w', channels: [{ idx: 0, offset: 0.5 }] }));
    assert.equal((await until(() => a.log.find(m => m.type === 'ack' && m.id === 'w'))).ok, true);
    await until(() => ss(a).length > 5);
    for (const s of ss(a).slice(-4)) { assert.ok(Math.abs(s.v[0] / 10 - 22.5) < 0.3 && Math.abs(s.v[1] / 10 - 22) < 0.3, '室温のまま ' + s.v); assert.ok(Math.abs(s.cj / 10 - 24.3) < 0.2); }
    a.ws.close();
  } finally { await srv.close(); }
});

test('conformance.mjs が sim サーバ（--amp max31855）にも通る', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', speed: 20, quiet: true, amp: 'max31855' });
  try {
    const p = spawn(process.execPath, [path.join(ROOT, 'tools/test/proto/conformance.mjs'), '--url', srv.wsUrl, '--skip-reboot'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    const code = await new Promise(r => p.on('close', r));
    assert.equal(code, 0, out); assert.match(out, /ok \d+ - MAX31855: setcfg の amp は ack\{ok:false, err:"unsupported"\}/);
  } finally { await srv.close(); }
});

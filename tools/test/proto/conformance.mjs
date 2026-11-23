#!/usr/bin/env node
// プロトコル適合試験（SPEC 2章）。sim サーバにも実機にも同じ試験を通す。
//   node tools/test/proto/conformance.mjs --url ws://localhost:8787/ws [--skip-reboot] [--http http://localhost:8787]
// sim サーバ（/api/sim/reboot がある）なら reboot 試験も行う。実機では自動でスキップする。
import WebSocket from 'ws';
import { validateWs } from '../lib/schemas.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const URL_WS = opt('--url', 'ws://localhost:8787/ws');
const SKIP_REBOOT = args.includes('--skip-reboot');
const HTTP = opt('--http', URL_WS.replace(/^ws/, 'http').replace(/\/ws$/, ''));

const sleep = ms => new Promise(r => setTimeout(r, ms));

class Conn {
  constructor(url) { this.url = url; this.log = []; this.closed = false; this.waiters = []; }
  open(timeout = 5000) {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(this.url));
      const to = setTimeout(() => { ws.terminate(); reject(new Error('接続タイムアウト')); }, timeout);
      ws.on('open', () => { clearTimeout(to); resolve(this); });
      ws.on('error', e => { clearTimeout(to); reject(e); });
      ws.on('close', () => { this.closed = true; this._wake(); });
      ws.on('message', d => {
        let m; try { m = JSON.parse(d.toString()); } catch { m = { type: '__invalid_json__', raw: d.toString() }; }
        this.log.push(m); this._wake();
      });
    });
  }
  _wake() { for (const w of this.waiters.splice(0)) w(); }
  send(o) { this.ws.send(JSON.stringify(o)); }
  // pred を満たすメッセージ（from 番目以降）を待つ。見つからなければ throw
  async waitFor(pred, ms, from = 0, what = 'メッセージ') {
    const end = Date.now() + ms;
    for (;;) {
      for (let i = from; i < this.log.length; i++) if (pred(this.log[i])) return { m: this.log[i], i };
      const left = end - Date.now();
      if (left <= 0) throw new Error(`${what} を ${ms}ms 待ったが来なかった`);
      await new Promise(r => { this.waiters.push(r); setTimeout(r, Math.min(left, 100)); });
    }
  }
  close() { try { this.ws.close(); } catch {} }
}

let n = 0, failed = 0;
async function test(name, fn) {
  n++;
  try { await fn(); console.log(`ok ${n} - ${name}`); }
  catch (e) { failed++; console.log(`not ok ${n} - ${name}\n    ${e.message.split('\n').join('\n    ')}`); }
}
function skip(name, why) { n++; console.log(`ok ${n} - ${name} # SKIP ${why}`); }
const assert = (c, msg) => { if (!c) throw new Error(msg); };
const mustValid = m => { const e = validateWs(m); assert(e.length === 0, `schema 違反 ${JSON.stringify(m).slice(0, 160)}\n${e.join('\n')}`); };

(async () => {
  console.log(`# conformance: ${URL_WS}`);
  let hello0, speed = 1, tickMs = 1000;
  const sec = k => Math.ceil(k * tickMs); // k 秒（デバイス時間）を待つ実時間 ms

  // ---------- 1. hello ----------
  const A = await new Conn(URL_WS).open().catch(e => { console.log('Bail out! 接続できません: ' + e.message); process.exit(2); });
  A.send({ type: 'hi', app: 'roastlog', ver: 'conformance', bootId: null, lastSeq: null });
  await test('hi に hello が返る（schema 準拠、proto=1）', async () => {
    const { m } = await A.waitFor(x => x.type === 'hello', 3000, 0, 'hello');
    mustValid(m);
    hello0 = m; speed = m.speed || 1; tickMs = 1000 / speed;
    assert(m.chMax <= 3 && m.cfg.channels.length === 3, 'channels は 3 要素');
    assert(m.bufFrom <= m.seq + 1, 'bufFrom <= seq+1');
    assert(Number.isInteger(m.cfg.rev) && m.cfg.rev >= 0, 'hello.cfg.rev（設定の版番号, 9.5）が無い');
  });
  if (!hello0) { console.log('Bail out! hello が無いので続行できません'); process.exit(1); }
  console.log(`# bootId=${hello0.bootId} seq=${hello0.seq} speed=${speed} amp=${hello0.amp}`);

  await test('hi が無くても hello が来る', async () => {
    const B = await new Conn(URL_WS).open();
    try { await B.waitFor(x => x.type === 'hello', 2500, 0, 'hello'); } finally { B.close(); }
  });

  // ---------- 2. s ----------
  const seen = new Map(); // seq -> s
  await test('s が 1 秒ごとに届く（seq 連続・ms 約 1000 刻み・schema 準拠）', async () => {
    const want = 8;
    await A.waitFor(() => A.log.filter(x => x.type === 's').length >= want, sec(want + 4) + 2000, 0, `s ${want} 個`);
    const ss = A.log.filter(x => x.type === 's');
    ss.forEach(mustValid);
    for (let i = 1; i < ss.length; i++) {
      assert(ss[i].seq === ss[i - 1].seq + 1, `seq が連続していない ${ss[i - 1].seq} -> ${ss[i].seq}`);
      const d = ss[i].ms - ss[i - 1].ms;
      assert(d >= 800 && d <= 1200, `ms の間隔が 1000±200 ではない: ${d}`);
    }
    for (const s of ss) {
      seen.set(s.seq, s);
      for (let c = 0; c < 3; c++) assert(s.v[c] === null || (s.v[c] > -500 && s.v[c] < 12000), `v 範囲外 ${s.v[c]}`);
      for (let c = 0; c < 3; c++) if (s.f[c] !== 0) assert(s.v[c] === null, '故障なのに v が null ではない');
    }
  });

  await test('ping に同じ id の pong が返る', async () => {
    const id = 'p' + Date.now();
    A.send({ type: 'ping', id, t: Date.now() });
    const { m } = await A.waitFor(x => x.type === 'pong' && x.id === id, 2000, 0, 'pong');
    mustValid(m);
  });

  await test('st が定期的に届く', async () => {
    const { m } = await A.waitFor(x => x.type === 'st', sec(12) + 2000, 0, 'st');
    mustValid(m);
  });

  // ---------- 3. bf_req ----------
  await test('bf_req で過去の範囲が返り、s と値が一致する', async () => {
    const ss = [...seen.keys()].sort((a, b) => a - b);
    const from = ss[1], to = ss[ss.length - 2];
    const k0 = A.log.length;
    A.send({ type: 'bf_req', from, to });
    const { m } = await A.waitFor(x => x.type === 'bf' && x.from === from, 3000, k0, 'bf');
    mustValid(m);
    assert(m.lost === false, 'lost が true');
    assert(m.to === to, `to が違う ${m.to} != ${to}`);
    assert(m.v.length === 3 && m.f.length === 3, 'v/f は 3 行');
    const len = to - from + 1;
    for (let c = 0; c < 3; c++) assert(m.v[c].length === len && m.f[c].length === len, `列の長さ ${m.v[c].length} != ${len}`);
    for (let s = from; s <= to; s++) {
      const o = seen.get(s);
      for (let c = 0; c < 3; c++) {
        assert(m.v[c][s - from] === o.v[c], `seq ${s} ch${c} の値が s と違う ${m.v[c][s - from]} != ${o.v[c]}`);
        assert(m.f[c][s - from] === o.f[c], `seq ${s} ch${c} の f が s と違う`);
      }
    }
    assert(Math.abs(m.ms0 - seen.get(from).ms) <= 1, 'ms0 が s の ms と違う');
  });

  if (hello0.bufFrom > 1) {
    await test('bf_req がバッファ外なら lost:true で最古から返る', async () => {
      const k0 = A.log.length;
      A.send({ type: 'bf_req', from: 0, to: hello0.bufFrom + 3 });
      const { m } = await A.waitFor(x => x.type === 'bf', 3000, k0, 'bf');
      assert(m.lost === true, 'lost が false');
      assert(m.from >= hello0.bufFrom, '最古から送られていない');
    });
  } else skip('bf_req がバッファ外なら lost:true', 'バッファがまだ溢れていない（bufFrom=1）');

  // ---------- 4. 設定 ----------
  let origCh0;
  await test('setcfg: 不正なチャンネルは ack ok:false、有効な変更は ack ok:true と cfg が返る', async () => {
    origCh0 = hello0.cfg.channels[0];
    let k0 = A.log.length;
    A.send({ type: 'setcfg', id: 'c-bad', channels: [{ idx: 7, offset: 1 }] });
    let r = (await A.waitFor(x => x.type === 'ack' && x.id === 'c-bad', 2000, k0, 'ack')).m;
    mustValid(r);
    assert(r.ok === false && typeof r.err === 'string', 'ack ok:false + err が必要');

    k0 = A.log.length;
    A.send({ type: 'setcfg', id: 'c-ok', channels: [{ idx: 0, offset: 1.5 }] });
    r = (await A.waitFor(x => x.type === 'ack' && x.id === 'c-ok', 2000, k0, 'ack')).m;
    assert(r.ok === true, 'ack ok:true');
    const c = (await A.waitFor(x => x.type === 'cfg', 2000, k0, 'cfg')).m;
    mustValid(c);
    assert(c.channels[0].offset === 1.5, 'cfg に offset 1.5 が反映されていない');
    assert(c.channels[1].role === hello0.cfg.channels[1].role, '部分更新で他チャンネルが変わった');
    // 戻す
    k0 = A.log.length;
    A.send({ type: 'setcfg', id: 'c-rst', channels: [{ idx: 0, offset: origCh0.offset }] });
    await A.waitFor(x => x.type === 'ack' && x.id === 'c-rst' && x.ok, 2000, k0, 'ack');
  });

  await test('setcfg: 補正値は以後の v に足されて届く（v - offset = 生値）', async () => {
    // offset を +10.0 にして、前後の s の差が約 100（0.1℃ 単位）になることを見る
    const before = A.log.filter(x => x.type === 's').slice(-1)[0];
    let k0 = A.log.length;
    A.send({ type: 'setcfg', id: 'c-off', channels: [{ idx: 0, offset: origCh0.offset + 10 }] });
    await A.waitFor(x => x.type === 'ack' && x.id === 'c-off' && x.ok, 2000, k0, 'ack');
    k0 = A.log.length;
    const after = (await A.waitFor(x => x.type === 's' && x.seq > before.seq + 1, sec(4) + 1500, k0, 's')).m;
    const d = after.v[0] - before.v[0];
    const dt = after.seq - before.seq;
    // 焙煎曲線そのものの変化（最大 ±4℃/秒 程度）を許容
    assert(d >= 100 - 40 * dt - 50 && d <= 100 + 40 * dt + 50, `offset +10℃ が v に反映されていない d=${d}`);
    k0 = A.log.length;
    A.send({ type: 'setcfg', id: 'c-off2', channels: [{ idx: 0, offset: origCh0.offset }] });
    await A.waitFor(x => x.type === 'ack' && x.id === 'c-off2' && x.ok, 2000, k0, 'ack');
  });

  await test('cfg.rev: 設定を変えるたびに +1。setcfg{baseRev} が古ければ ack{ok:false, err:"stale", rev} で、何も変えない（9.5）', async () => {
    const R = await new Conn(URL_WS).open(); R.send({ type: 'hi', app: 'roastlog', ver: 'conformance-rev', bootId: null, lastSeq: null }); // 今の rev を新しい接続の hello で読む
    const h = (await R.waitFor(x => x.type === 'hello', 3000, 0, 'hello')).m; R.close(); const r0 = h.cfg.rev, name0 = h.cfg.channels[0].name;
    let k0 = A.log.length;
    A.send({ type: 'setcfg', id: 'r1', baseRev: r0, channels: [{ idx: 0, name: 'rev-test' }] });
    const a1 = (await A.waitFor(x => x.type === 'ack' && x.id === 'r1', 2000, k0, 'ack')).m; mustValid(a1);
    assert(a1.ok === true, 'baseRev が今の rev なら受け付ける');
    const c1 = (await A.waitFor(x => x.type === 'cfg', 2000, k0, 'cfg')).m; mustValid(c1);
    assert(c1.rev === r0 + 1, `rev が +1 されていない ${c1.rev} != ${r0 + 1}`);
    k0 = A.log.length;
    A.send({ type: 'setcfg', id: 'r2', baseRev: r0, channels: [{ idx: 0, name: 'stale-test' }] });
    const a2 = (await A.waitFor(x => x.type === 'ack' && x.id === 'r2', 2000, k0, 'ack')).m; mustValid(a2);
    assert(a2.ok === false && a2.err === 'stale' && a2.rev === r0 + 1, `古い baseRev は stale + 今の rev: ${JSON.stringify(a2)}`);
    await sleep(300);
    assert(!A.log.slice(k0).some(x => x.type === 'cfg'), 'stale なのに cfg が送られた（変更された）');
    k0 = A.log.length;
    A.send({ type: 'setcfg', id: 'r3', baseRev: r0 + 1, channels: [{ idx: 0, name: name0 }] }); // 戻す
    await A.waitFor(x => x.type === 'ack' && x.id === 'r3' && x.ok, 2000, k0, 'ack');
  });

  if (hello0.amp === 'max31855') await test('MAX31855: setcfg の amp は ack{ok:false, err:"unsupported"}', async () => {
    const k0 = A.log.length;
    A.send({ type: 'setcfg', id: 'u1', amp: { mains: 60 } });
    const a = (await A.waitFor(x => x.type === 'ack' && x.id === 'u1', 2000, k0, 'ack')).m; mustValid(a);
    assert(a.ok === false && a.err === 'unsupported', JSON.stringify(a));
  });
  else skip('MAX31855: setcfg の amp は unsupported', `amp=${hello0.amp}`);

  await test('identify に ack が返る', async () => {
    const k0 = A.log.length;
    A.send({ type: 'identify', id: 'i1' });
    const { m } = await A.waitFor(x => x.type === 'ack' && x.id === 'i1', 2000, k0, 'ack');
    mustValid(m); assert(m.ok === true, 'ok:true');
  });

  // ---------- 5. 切断・再接続・バックフィル ----------
  await test('切断→再接続→hi{lastSeq} で欠損ゼロ（bf + s が連続）', async () => {
    const lastSeq = A.log.filter(x => x.type === 's').slice(-1)[0].seq;
    A.close();
    await sleep(sec(8)); // 8 秒分（デバイス時間）切れていたことにする
    const B = await new Conn(URL_WS).open();
    try {
      B.send({ type: 'hi', app: 'roastlog', ver: 'conformance', bootId: hello0.bootId, lastSeq });
      const h = (await B.waitFor(x => x.type === 'hello', 3000, 0, 'hello')).m;
      mustValid(h);
      assert(h.bootId === hello0.bootId, 'bootId が変わっている（再起動した？）');
      assert(h.seq >= lastSeq + 6, `切断中に seq が進んでいない ${h.seq}`);
      await B.waitFor(x => x.type === 's' && x.seq >= h.seq + 2, sec(6) + 2000, 0, 's');
      const got = new Map();
      for (const m of B.log) {
        if (m.type === 'bf') { mustValid(m); assert(!m.lost, 'bf.lost が true'); for (let i = 0; i <= m.to - m.from; i++) got.set(m.from + i, m.v.map(r => r[i])); }
        else if (m.type === 's') got.set(m.seq, m.v);
      }
      const hi = Math.max(...got.keys());
      const missing = [];
      for (let s = lastSeq + 1; s <= hi; s++) if (!got.has(s)) missing.push(s);
      assert(missing.length === 0, `欠損あり: ${missing.slice(0, 10).join(',')}（${missing.length} 件）`);
      for (const m of B.log) if (m.type === 'bf') assert(m.from === lastSeq + 1 || B.log.some(x => x.type === 'bf' && x.to + 1 === m.from), `bf の from が lastSeq+1（または前の bf の続き）ではない (${m.from})`);
      // 9.5: 送る順番は hello → bf をすべて → s
      const ih = B.log.findIndex(x => x.type === 'hello'), lastBf = B.log.map(x => x.type).lastIndexOf('bf'), firstS = B.log.findIndex(x => x.type === 's');
      assert(ih >= 0 && lastBf > ih && firstS > lastBf, `順番が hello → bf → s ではない（hello ${ih}, 最後の bf ${lastBf}, 最初の s ${firstS}）`);
      console.log(`# 補完 ${lastSeq + 1}..${hi}（${hi - lastSeq} 件）欠損 0`);
    } finally { B.close(); }
  });

  // ---------- 6. reboot（sim のみ） ----------
  const hasSim = !SKIP_REBOOT && await fetch(HTTP + '/api/info').then(r => r.json()).then(j => j.sim === true).catch(() => false);
  if (!hasSim) skip('reboot で bootId が変わり、古い lastSeq では bf が来ない', SKIP_REBOOT ? '--skip-reboot' : '実機（/api/sim が無い）');
  else await test('reboot で bootId が変わり seq が巻き戻り、古い lastSeq では bf が来ない', async () => {
    const C = await new Conn(URL_WS).open();
    C.send({ type: 'hi', app: 'roastlog', ver: 'conformance', bootId: null, lastSeq: null });
    const h1 = (await C.waitFor(x => x.type === 'hello', 3000, 0, 'hello')).m;
    await C.waitFor(x => x.type === 's' && x.seq >= h1.seq + 2, sec(5) + 2000, 0, 's');
    const lastSeq = C.log.filter(x => x.type === 's').slice(-1)[0].seq;
    const r = await fetch(HTTP + '/api/sim/reboot').then(r => r.json());
    assert(r.ok, 'reboot 要求が失敗');
    await C.waitFor(() => C.closed, 3000, 0, '切断');
    // 起動し直すまで再接続を試す
    let D = null;
    for (let i = 0; i < 40 && !D; i++) { try { D = await new Conn(URL_WS).open(1500); } catch { await sleep(250); } }
    assert(D, '再起動後に再接続できない');
    try {
      D.send({ type: 'hi', app: 'roastlog', ver: 'conformance', bootId: h1.bootId, lastSeq });
      const h2 = (await D.waitFor(x => x.type === 'hello', 3000, 0, 'hello')).m;
      mustValid(h2);
      assert(h2.bootId !== h1.bootId, `bootId が変わっていない ${h2.bootId}`);
      assert(h2.seq < lastSeq || h2.seq <= 5, `seq が巻き戻っていない ${h2.seq} (旧 ${lastSeq})`);
      await D.waitFor(x => x.type === 's', sec(4) + 1500, 0, 's');
      assert(!D.log.some(x => x.type === 'bf'), '古い bootId の lastSeq に対して bf を送ってはいけない');
      // 新しい bootId でも ms が 0 付近から始まる（再起動）
      assert(h2.ms < h1.ms + 3600e3, 'ms が不正');
    } finally { D.close(); }
  });

  console.log(`\n# ${n - failed}/${n} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('Bail out!', e); process.exit(2); });

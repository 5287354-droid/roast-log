#!/usr/bin/env node
// ESP32 互換サーバ（SPEC 2章 / 7.2）。静的配信 + /api/info + /api/sim/* + WS /ws
//   node tools/sim/server.mjs --port 8787 --speed 20 --profile drum --seed 1 --charge-at 40 \
//        --disconnect 300:20 --fault c2:open@400-420 --reboot-at 500
// 時刻の単位: seq / --charge-at / --disconnect / --fault / --reboot-at はすべて「サーバ起動からの
// 仮想秒」（= サンプル番号）。--speed 20 なら実時間 1/20 で進む。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createModel } from './roast-model.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const RING = 3600;
const BF_MAX = 300;
const FW = '0.0.0-sim';

export function parseArgs(argv) {
  const a = {
    port: 8787, host: '0.0.0.0', speed: 1, profile: 'drum', seed: 1, chargeAt: 40, noise: 0.3,
    disconnect: [], fault: [], rebootAt: [], quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => argv[++i];
    if (k === '--port') a.port = +val();
    else if (k === '--host') a.host = val();
    else if (k === '--speed') a.speed = +val();
    else if (k === '--profile') a.profile = val();
    else if (k === '--seed') a.seed = +val();
    else if (k === '--charge-at') { const v = val(); a.chargeAt = v === 'none' ? null : +v; }
    else if (k === '--noise') a.noise = +val();
    else if (k === '--disconnect') { const [s, d] = val().split(':').map(Number); a.disconnect.push({ at: s, dur: d }); }
    else if (k === '--fault') {
      const m = /^c([1-3]):([a-z]+)@(\d+)-(\d+)$/.exec(val());
      if (!m) throw new Error('--fault は c2:open@400-420 の形式です');
      a.fault.push({ ch: +m[1] - 1, kind: m[2], from: +m[3], to: +m[4] });
    }
    else if (k === '--reboot-at') a.rebootAt.push(+val());
    else if (k === '--quiet') a.quiet = true;
    else if (k === '--help' || k === '-h') { a.help = true; }
    else throw new Error('不明な引数: ' + k);
  }
  return a;
}

const hex8 = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
const DEFAULT_CFG = () => ({
  channels: [
    { idx: 0, enabled: true, role: 'bt', name: '豆温度', color: '#C2410C', offset: 0 },
    { idx: 1, enabled: true, role: 'et', name: '排気', color: '#7A5AA6', offset: 0 },
    { idx: 2, enabled: false, role: 'off', name: '', color: '#6B7280', offset: 0 },
  ],
  amp: { type: 'sim', mains: 50, avg: 4 },
  rateHz: 1,
});
const ROLES = ['bt', 'et', 'amb', 'inlet', 'off'];

export function startServer(opts = {}) {
  const o = { ...parseArgs([]), ...opts };
  const log = (...m) => { if (!o.quiet) console.log('[sim]', ...m); };
  const speed = o.speed > 0 ? o.speed : 1;
  const tickMs = 1000 / speed;

  let model = createModel({ profile: o.profile, seed: o.seed, chargeAt: o.chargeAt, noise: o.noise, faults: [] });
  // 故障は seq（起動からの仮想秒）で指定するので、モデル秒とは別に管理する
  const faults = o.fault.map(f => ({ ...f }));
  const deviceId = 'a4cf' + (Math.floor(Math.random() * 256)).toString(16).padStart(2, '0');
  let cfg = DEFAULT_CFG();
  let bootId = hex8();
  let seq = 0;                        // 最新サンプルの seq（最初のサンプルが 1）
  let msBase = 100000 + Math.floor(Math.random() * 800000);
  const ring = new Array(RING).fill(null);
  let virtualSec = 0;                 // 起動からの仮想秒（reboot でも戻らない）
  let refuseUntil = -1;               // この仮想秒まで接続を拒否
  const pendingDisconnects = o.disconnect.map(d => ({ ...d, done: false }));
  const pendingReboots = o.rebootAt.map(at => ({ at, done: false }));
  let identifiedAt = null;
  const clients = new Set();

  const bufFrom = () => (seq === 0 ? 1 : Math.max(1, seq - RING + 1));
  const msOf = s => msBase + s * 1000;

  function sample(ctrl) {
    const s = model.step(ctrl);
    virtualSec++;
    const vv = [null, null, null], ff = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const c = cfg.channels[i];
      let v = s.v[i], f = s.f[i];
      for (const ft of faults) {
        if (ft.ch === i && virtualSec >= ft.from && virtualSec <= ft.to) { v = null; f = { open: 1, gnd: 2, vcc: 3, ovuv: 4, range: 5, cj: 6, nodev: 7, stale: 8 }[ft.kind] || 1; }
      }
      if (!c.enabled) { vv[i] = null; ff[i] = 0; continue; }
      vv[i] = v == null ? null : Math.round((v + c.offset) * 10);
      ff[i] = f;
    }
    seq++;
    const e = { seq, ms: msOf(seq), v: vv, f: ff, cj: Math.round(s.cj * 10) };
    ring[seq % RING] = e;
    return e;
  }
  const get = s => { const e = ring[s % RING]; return e && e.seq === s ? e : null; };

  function sendTo(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  function broadcast(obj) { for (const c of clients) if (c.ready) sendTo(c.ws, obj); }

  function helloMsg() {
    return {
      type: 'hello', proto: 1, fw: FW, model: 'RL-SIM', amp: 'sim', id: deviceId, bootId,
      ms: msOf(seq), seq, bufFrom: bufFrom(), rateHz: 1, chMax: 3, speed,
      cfg: structuredClone(cfg),
    };
  }
  function sMsg(e) { return { type: 's', seq: e.seq, ms: e.ms, v: e.v, f: e.f, cj: e.cj }; }
  function bfMsgs(from, to) {
    // 範囲外なら lost:true で、残っている最古から送る
    const out = [];
    let lost = false;
    const bf0 = bufFrom();
    if (from < bf0) { from = bf0; lost = true; }
    if (to > seq) to = seq;
    if (from > to) return [{ type: 'bf', from, to: from - 1, lost, ms0: msOf(from), dt: 1000, v: [[], [], []], f: [[], [], []] }];
    for (let a = from; a <= to; a += BF_MAX) {
      const b = Math.min(to, a + BF_MAX - 1);
      const v = [[], [], []], f = [[], [], []];
      for (let s = a; s <= b; s++) { const e = get(s); for (let i = 0; i < 3; i++) { v[i].push(e ? e.v[i] : null); f[i].push(e ? e.f[i] : 0); } }
      out.push({ type: 'bf', from: a, to: b, lost: a === from ? lost : false, ms0: msOf(a), dt: 1000, v, f });
    }
    return out;
  }
  function stMsg() {
    return { type: 'st', rssi: -55, mode: 'sta', ip: '127.0.0.1', heap: 182344, uptime: virtualSec, clients: clients.size };
  }

  function applyCfg(m) {
    // 部分更新可。不正なら ok:false（何も変更しない）
    const next = structuredClone(cfg);
    if (m.channels !== undefined) {
      if (!Array.isArray(m.channels)) return 'bad_value';
      for (const ch of m.channels) {
        if (!ch || !Number.isInteger(ch.idx) || ch.idx < 0 || ch.idx > 2) return 'bad_channel';
        const t = next.channels[ch.idx];
        if (ch.enabled !== undefined) { if (typeof ch.enabled !== 'boolean') return 'bad_value'; t.enabled = ch.enabled; }
        if (ch.role !== undefined) { if (!ROLES.includes(ch.role)) return 'bad_value'; t.role = ch.role; }
        if (ch.name !== undefined) { if (typeof ch.name !== 'string' || ch.name.length > 24) return 'bad_value'; t.name = ch.name; }
        if (ch.color !== undefined) { if (!/^#[0-9a-fA-F]{6}$/.test(ch.color)) return 'bad_value'; t.color = ch.color; }
        if (ch.offset !== undefined) { if (typeof ch.offset !== 'number' || !(Math.abs(ch.offset) <= 50)) return 'bad_value'; t.offset = Math.round(ch.offset * 10) / 10; }
      }
    }
    if (m.amp !== undefined) {
      const a = m.amp;
      if (!a || typeof a !== 'object') return 'bad_value';
      if (a.mains !== undefined) { if (a.mains !== 50 && a.mains !== 60) return 'bad_value'; next.amp.mains = a.mains; }
      if (a.avg !== undefined) { if (![1, 2, 4, 8, 16].includes(a.avg)) return 'bad_value'; next.amp.avg = a.avg; }
    }
    cfg = next;
    return null;
  }

  function onMessage(c, raw) {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m.type !== 'string') return;
    const ack = (ok, err) => { if (m.id !== undefined) sendTo(c.ws, ok ? { type: 'ack', id: m.id, ok: true } : { type: 'ack', id: m.id, ok: false, err }); };
    switch (m.type) {
      case 'hi': {
        clearTimeout(c.helloTimer);
        sendTo(c.ws, helloMsg());
        c.ready = true;
        // 同じ bootId で lastSeq があれば自動バックフィル
        if (m.bootId === bootId && Number.isInteger(m.lastSeq) && m.lastSeq >= 0 && m.lastSeq < seq) {
          for (const f of bfMsgs(m.lastSeq + 1, seq)) sendTo(c.ws, f);
        }
        break;
      }
      case 'bf_req': {
        if (!Number.isInteger(m.from) || !Number.isInteger(m.to)) { ack(false, 'bad_range'); break; }
        for (const f of bfMsgs(m.from, m.to)) sendTo(c.ws, f);
        break;
      }
      case 'ping': sendTo(c.ws, { type: 'pong', id: m.id, t: Date.now(), ms: msOf(seq) }); break;
      case 'setcfg': {
        const err = applyCfg(m);
        ack(!err, err);
        if (!err) broadcast(cfgMsg());
        break;
      }
      case 'identify': identifiedAt = Date.now(); log('identify'); ack(true); break;
      default: ack(false, 'unknown_type');
    }
  }
  const cfgMsg = () => ({ type: 'cfg', ...structuredClone(cfg) });

  // ---------- HTTP ----------
  const appFile = () => {
    const a = path.join(ROOT, 'app', 'index.html');
    return fs.existsSync(a) ? a : path.join(ROOT, 'legacy', 'roastlog-artifact-v1.html');
  };
  const json = (res, code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(obj));
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      fs.readFile(appFile(), (err, buf) => {
        if (err) { res.writeHead(500); res.end('no app'); return; }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
        res.end(buf);
      });
    } else if (url.pathname === '/api/info') {
      json(res, 200, { proto: 1, fw: FW, model: 'RL-SIM', amp: 'sim', id: deviceId, bootId, mode: 'sta', ip: '127.0.0.1', host: req.headers.host || 'localhost', sim: true });
    } else if (url.pathname === '/api/sim/truth') {
      json(res, 200, { ...model.truth(), seq, bootId, virtualSec, speed });
    } else if (url.pathname === '/api/sim/reboot') {
      reboot(); json(res, 200, { ok: true, bootId });
    } else if (url.pathname === '/api/sim/disconnect') {
      const d = +url.searchParams.get('sec') || 10; dropAll(d); json(res, 200, { ok: true, sec: d });
    } else if (url.pathname === '/api/sim/charge') {
      pendingCharge = true; json(res, 200, { ok: true });
    } else if (url.pathname === '/api/sim/fault') {
      // /api/sim/fault?ch=c2&kind=open&sec=20 : 今から sec 仮想秒
      const ch = (url.searchParams.get('ch') || 'c2');
      const kind = url.searchParams.get('kind') || 'open';
      const sec = +url.searchParams.get('sec') || 10;
      faults.push({ ch: +ch.replace(/^c/i, '') - 1, kind, from: virtualSec + 1, to: virtualSec + sec });
      json(res, 200, { ok: true });
    } else if (url.pathname === '/api/sim/control') {
      const fire = url.searchParams.get('fire'), damper = url.searchParams.get('damper');
      pendingCtrl = {};
      if (fire != null) pendingCtrl.fire = +fire;
      if (damper != null) pendingCtrl.damper = +damper;
      json(res, 200, { ok: true });
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
    }
  });
  let pendingCharge = false, pendingCtrl = null;

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const p = new URL(req.url, 'http://x').pathname;
    if (p !== '/ws' || virtualSec < refuseUntil || clients.size >= 4) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', ws => {
    const c = { ws, ready: false, helloTimer: null };
    clients.add(c);
    // hi が無くても 1 秒（実時間）後に hello を送る
    c.helloTimer = setTimeout(() => { if (!c.ready) { sendTo(ws, helloMsg()); c.ready = true; } }, 1000);
    ws.on('message', raw => onMessage(c, raw));
    ws.on('close', () => { clearTimeout(c.helloTimer); clients.delete(c); });
    ws.on('error', () => {});
  });

  function dropAll(durVirtualSec) {
    refuseUntil = virtualSec + durVirtualSec;
    for (const c of clients) c.ws.terminate();
    clients.clear();
    log(`切断 ${durVirtualSec} 秒（virtual ${virtualSec}）`);
  }
  let rebootDown = 0;
  function reboot() {
    bootId = hex8();
    seq = 0; ring.fill(null);
    msBase = 1000 + Math.floor(Math.random() * 5000);
    rebootDown = 3;   // 3 仮想秒は起動中（サンプルなし・接続拒否）
    refuseUntil = virtualSec + rebootDown;
    for (const c of clients) c.ws.terminate();
    clients.clear();
    log(`reboot bootId=${bootId}（virtual ${virtualSec}）`);
  }

  // ---------- tick ----------
  let timer = null;
  function tick() {
    if (rebootDown > 0) {
      rebootDown--; virtualSec++; model.step(null);
      return;
    }
    for (const d of pendingDisconnects) if (!d.done && virtualSec + 1 >= d.at) { d.done = true; dropAll(d.dur); }
    for (const r of pendingReboots) if (!r.done && virtualSec + 1 >= r.at) { r.done = true; reboot(); return; }
    const ctrl = {};
    if (pendingCharge) { ctrl.charge = true; pendingCharge = false; }
    if (pendingCtrl) { Object.assign(ctrl, pendingCtrl); pendingCtrl = null; }
    const e = sample(ctrl);
    const msg = sMsg(e);
    broadcast(msg);
    if (e.seq % 10 === 0) broadcast(stMsg());
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, o.host, () => {
      timer = setInterval(tick, tickMs);
      const port = server.address().port;
      log(`http://localhost:${port}/  ws://localhost:${port}/ws  speed=${speed} profile=${o.profile} seed=${o.seed} bootId=${bootId}`);
      resolve({
        port, url: `http://localhost:${port}`, wsUrl: `ws://localhost:${port}/ws`,
        get seq() { return seq; }, get bootId() { return bootId; }, model: () => model,
        dropAll, reboot,
        close() {
          clearInterval(timer);
          for (const c of clients) c.ws.terminate();
          wss.close();
          return new Promise(r => { server.close(() => r()); server.closeAllConnections?.(); });
        },
      });
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (args.help) {
    console.log('使い方: node tools/sim/server.mjs [--port 8787] [--speed 1] [--profile drum|tenami] [--seed 1] [--charge-at 40|none]\n  [--noise 0.3] [--disconnect 300:20] [--fault c2:open@400-420] [--reboot-at 500] [--quiet]');
    process.exit(0);
  }
  startServer(args).catch(e => { console.error(e.message); process.exit(1); });
}

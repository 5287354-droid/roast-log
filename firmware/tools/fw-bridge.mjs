#!/usr/bin/env node
// ファームの C++（WsProtocol / Sampler / SimTcDriver）をホストで動かし、WebSocket で公開する橋。
// 実機なしで tools/test/proto/conformance.mjs を「ファームのコード」に通すために使う。
//   cd firmware && pio run -e native_bridge
//   node firmware/tools/fw-bridge.mjs --port 8788 --speed 20 [--amp max31855]
//   node tools/test/proto/conformance.mjs --url ws://localhost:8788/ws
// /api/sim/reboot で橋のプロセスを起動し直す（bootId が変わり seq が 1 から。実機の再起動と同じ）。
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { WebSocketServer } from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = +opt('--port', 8788);
const SPEED = Math.max(1, +opt('--speed', 1));
const AMP = opt('--amp', 'sim');   // max31855 にすると setcfg の amp が unsupported になる（アンプ名だけ変わる。値は SimTcDriver）
const BIN = opt('--bin', path.join(HERE, '..', '.pio', 'build', 'native_bridge', 'program'));
const hex8 = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');

let proc = null, bootId = null, down = false, timer = null, nextId = 1;
const clients = new Map(); // id -> ws

function boot() {
  bootId = hex8();
  proc = spawn(BIN, [bootId, String(SPEED), String(1000 + Math.floor(Math.random() * 5000)), AMP], { stdio: ['pipe', 'pipe', 'inherit'] });
  const rl = readline.createInterface({ input: proc.stdout });
  rl.on('line', line => {
    const m = /^(send|close) (\d+)(?: (.*))?$/.exec(line);
    if (!m) return;
    const ws = clients.get(+m[2]);
    if (!ws) return;
    if (m[1] === 'send') { if (ws.readyState === 1) ws.send(m[3]); }
    else { clients.delete(+m[2]); ws.terminate(); }
  });
  proc.on('exit', () => {});
  timer = setInterval(() => { if (proc && !down) proc.stdin.write('tick\n'); }, 250 / SPEED);
}
function write(s) { if (proc && proc.stdin.writable) proc.stdin.write(s + '\n'); }

function reboot() {
  down = true;
  for (const ws of clients.values()) ws.terminate();
  clients.clear();
  clearInterval(timer);
  proc.stdin.end(); proc.kill();
  setTimeout(() => { boot(); down = false; }, 3000 / SPEED);   // 3 秒（デバイス時間）起動中
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = o => { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); };
  if (url.pathname === '/api/info') json({ proto: 1, fw: '0.1.0-native', model: 'RL-HOST', amp: AMP, id: 'b0b0b0', bootId, mode: 'sta', ip: '127.0.0.1', host: req.headers.host || '', sim: true });
  else if (url.pathname === '/api/sim/reboot') { reboot(); json({ ok: true }); }
  else { res.writeHead(404); res.end('not found'); }
});
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws' || down) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => {
    const id = nextId++;
    clients.set(id, ws);
    write(`open ${id}`);
    ws.on('message', d => write(`msg ${id} ${d.toString().replace(/\n/g, ' ')}`));
    ws.on('close', () => { if (clients.delete(id)) write(`close ${id}`); });
    ws.on('error', () => {});
  });
});
boot();
server.listen(PORT, () => console.log(`[fw-bridge] ws://localhost:${PORT}/ws speed=${SPEED} bin=${BIN}`));
process.on('SIGTERM', () => { proc?.kill(); process.exit(0); });

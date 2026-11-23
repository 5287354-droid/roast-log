// 試験用: `node tools/sim/server.mjs ...` を別プロセスで起動する（空きポートを選ぶ）。stop() で必ず止める
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
export async function startSim(args = []) {
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(ROOT, 'tools/sim/server.mjs'), '--port', String(port), '--host', '127.0.0.1', '--quiet', ...args], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; proc.stderr.on('data', d => { err += d; });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(url + '/api/info'); if (r.ok) break; } catch {} if (proc.exitCode != null) throw new Error('sim server が起動しません: ' + err); await new Promise(r => setTimeout(r, 100)); }
  const api = async p => (await fetch(url + p)).json();
  const stop = () => new Promise(res => { if (proc.exitCode != null) return res(); proc.once('exit', res); proc.kill('SIGTERM'); setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 2000); });
  return { url, port, api, stop, proc };
}

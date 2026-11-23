#!/usr/bin/env node
// tools/sim/roast-model.mjs と app/index.html の @sim-begin 〜 @sim-end 区間が一致するか検査する。
// app 側に区間がまだ無ければ「未導入」と表示して成功（exit 0）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = path.join(ROOT, 'tools', 'sim', 'roast-model.mjs');
const APP = process.env.CHECK_SYNC_APP || path.join(ROOT, 'app', 'index.html');

function region(src) {
  const a = src.search(/\/\/\s*@sim-begin[^\n]*\n/);
  if (a < 0) return null;
  const m = /\/\/\s*@sim-begin[^\n]*\n/.exec(src);
  const b = src.search(/\/\/\s*@sim-end/);
  if (b < 0 || b < a) throw new Error('@sim-end が @sim-begin より前、または無い');
  const lines = src.slice(m.index + m[0].length, b).replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/\s+$/, ''));
  // 共通の字下げを外す
  const ind = Math.min(...lines.filter(l => l).map(l => l.match(/^ */)[0].length));
  return lines.map(l => l.slice(ind)).join('\n').trim();
}

const model = region(fs.readFileSync(MODEL, 'utf8'));
if (model == null) { console.error('NG: roast-model.mjs に @sim-begin がありません'); process.exit(1); }
if (!fs.existsSync(APP)) { console.log('check-sync: app/index.html が無いので未導入（成功扱い）'); process.exit(0); }
const app = region(fs.readFileSync(APP, 'utf8'));
if (app == null) { console.log('check-sync: app/index.html に @sim 区間が未導入（成功扱い）'); process.exit(0); }
if (app === model) { console.log(`check-sync: OK（${model.split('\n').length} 行が一致）`); process.exit(0); }
const a = model.split('\n'), b = app.split('\n');
let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
console.error(`check-sync: NG 一致しません（${i + 1} 行目から）\n  model: ${a[i] ?? '(終わり)'}\n  app  : ${b[i] ?? '(終わり)'}`);
process.exit(1);

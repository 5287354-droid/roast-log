#!/usr/bin/env node
// テストの振り分け: Playwright を使うファイル（e2e）と、使わない純粋な単体テスト（unit）。
//   node tools/test/run.mjs unit|e2e|all   （新しいテストファイルを足しても、中身を見て自動で振り分ける）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'core');
const kind = process.argv[2] || 'all';
if (!['unit', 'e2e', 'all'].includes(kind)) { console.error('使い方: run.mjs unit|e2e|all'); process.exit(2); }
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort();
const usesPw = f => /from ['"]playwright['"]|require\(['"]playwright['"]\)|import\(['"]playwright['"]\)/.test(fs.readFileSync(path.join(dir, f), 'utf8'));
const pick = kind === 'all' ? files : files.filter(f => (kind === 'e2e') === usesPw(f));
if (!pick.length) { console.error(kind + ' のテストがありません'); process.exit(2); }
const r = spawnSync(process.execPath, ['--test', ...pick.map(f => path.join(dir, f))], { stdio: 'inherit' });
process.exit(r.status ?? 1);

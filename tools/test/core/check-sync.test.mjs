import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const model = fs.readFileSync(path.join(ROOT, 'tools/sim/roast-model.mjs'), 'utf8');
const region = model.slice(model.indexOf('// @sim-begin'), model.indexOf('// @sim-end') + '// @sim-end'.length);
const check = app => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-')); const f = path.join(d, 'index.html'); fs.writeFileSync(f, app);
  return spawnSync(process.execPath, [path.join(ROOT, 'tools/check-sync.mjs')], { env: { ...process.env, CHECK_SYNC_APP: f }, encoding: 'utf8' });
};

test('check-sync: 区間なし=未導入で成功、一致=OK（字下げ可）、不一致=失敗', () => {
  assert.equal(check('<html></html>').status, 0);
  assert.match(check('<html></html>').stdout, /未導入/);
  const ok = check(`<script>\n${region.split('\n').map(l => '  ' + l).join('\n')}\n</script>`);
  assert.equal(ok.status, 0, ok.stderr); assert.match(ok.stdout, /OK/);
  const ng = check(`<script>\n${region.replace('0.0030', '0.0031')}\n</script>`);
  assert.equal(ng.status, 1); assert.match(ng.stderr, /NG/);
});

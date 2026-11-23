// legacy/roastlog-artifact-v1.html から関数を抜き出して node で評価するヘルパー（v1 互換テスト用）
// legacy は変更しない。ここでは文字列として読み、関数ソースを vm で評価するだけ。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const LEGACY_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'legacy', 'roastlog-artifact-v1.html');
export const legacySource = () => fs.readFileSync(LEGACY_PATH, 'utf8');

// `function name(` から対応する閉じ括弧までを返す（文字列・テンプレート・コメントの括弧は読み飛ばす）
export function extractFunction(src, name) {
  const start = src.search(new RegExp(`^\\s*(async\\s+)?function\\s+${name}\\s*\\(`, 'm'));
  if (start < 0) throw new Error(`legacy に function ${name} が無い`);
  let i = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      for (; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(start, i + 1).trim();
  }
  throw new Error(`function ${name} の終わりが見つからない`);
}

// `const name = ...;`（1 行）を返す
export function extractConst(src, name) {
  const m = src.match(new RegExp(`^const ${name} = .*;[ \\t]*$`, 'm'));
  if (!m) throw new Error(`legacy に const ${name} が無い`);
  return m[0].trim();
}

// 既定の設定（DEFAULTS を legacy から読む）
export function legacyDefaults(src = legacySource()) {
  const m = src.match(/const DEFAULTS = (\{[\s\S]*?\n\});/);
  if (!m) throw new Error('DEFAULTS が見つからない');
  return vm.runInNewContext('(' + m[1] + ')');
}

// 使い方: const L = loadLegacy({ flick: 3, crash: 4, rorWindow: 60 });
//         L.withRor(points) / L.stats(record) / L.evTime / L.fmt / L.parseTime / L.toRecord(draft)
export function loadLegacy(settingsOverride = {}) {
  const src = legacySource();
  const settings = { ...legacyDefaults(src), ...settingsOverride };
  const parts = [
    extractConst(src, 'r1'), extractConst(src, 'num'), extractConst(src, 'fmt'), extractConst(src, 'parseTime'),
    extractConst(src, 'evTime'),
    extractFunction(src, 'withRor'), extractFunction(src, 'stats'), extractFunction(src, 'toRecord'),
  ];
  const code = `${parts.join('\n')}\n({ r1, num, fmt, parseTime, evTime, withRor, stats, toRecord });`;
  const ctx = vm.createContext({ settings: () => settings, Date, Math, Number, String, Array, Object });
  const api = vm.runInContext(code, ctx);
  api.settings = settings;
  return api;
}

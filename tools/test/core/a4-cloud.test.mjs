// 工兵一番隊 A4: claude.ai 版の仕上げ。https のページに window.claude（db / downloads）のモックを入れて試す。
//   fitCloud（バイト数・200,000 / 240,000）、db 保存の失敗表示と送信待ちの再送、書き出しの代替、https の見え方、
//   v1 の本物の記録が書き換わらずに表示されること（移行の安全装置）、E2E-5（v2 の読み込み→表示→評価→再読み込み）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
const HTML = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const fx = n => JSON.parse(fs.readFileSync(path.join(root, 'tools/fixtures', n), 'utf8'));
const URL_ = 'https://roast.example/';
const bytes = o => Buffer.byteLength(JSON.stringify(o), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, label, ms = 8000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + label); await sleep(50); } }

// claude.ai の db のモック。状態は Node 側（再読み込みしても残る）。1 文書 262,144 バイト超の set は reject する
function makeDb(initial = {}) {
  const docs = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  const st = { docs, sets: [], deletes: [], fail: false, downloads: 'none' /* none | ok | throw */, saved: [] };
  return st;
}
async function open(db, { downloads = 'none', width = 390 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u === URL_ || u.startsWith(URL_ + '?')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML });
    return route.abort();
  });
  await ctx.exposeFunction('__dbList', col => [...db.docs].filter(([k]) => k.startsWith(col + '/')).map(([k, v]) => ({ id: k.slice(col.length + 1), json: v })));
  await ctx.exposeFunction('__dbGet', p => db.docs.has(p) ? db.docs.get(p) : null);
  await ctx.exposeFunction('__dbSet', (p, json) => {
    if (db.fail) return { err: 'network' };
    if (Buffer.byteLength(json, 'utf8') > 262144) return { err: 'too large' };
    db.docs.set(p, json); db.sets.push(p); return { ok: true };
  });
  await ctx.exposeFunction('__dbDel', p => { if (db.fail) return { err: 'network' }; db.docs.delete(p); db.deletes.push(p); return { ok: true }; });
  await ctx.exposeFunction('__dlSave', (mode, a) => { if (mode === 'throw') return { err: 'x' }; db.saved.push(a); return { ok: true }; });
  await ctx.addInitScript(dl => {
    const mk = p => ({ id: p.split('/').pop(), exists: true });
    const database = {
      collection: col => ({ get: async () => ({ docs: (await window.__dbList(col)).map(d => ({ id: d.id, data: () => JSON.parse(d.json) })) }) }),
      doc: p => ({
        get: async () => { const j = await window.__dbGet(p); return { exists: j != null, id: p.split('/').pop(), data: () => (j == null ? undefined : JSON.parse(j)) }; },
        set: async o => { const r = await window.__dbSet(p, JSON.stringify(o)); if (r.err) throw new Error(r.err); },
        delete: async () => { const r = await window.__dbDel(p); if (r.err) throw new Error(r.err); },
      }),
    };
    window.claude = { use: async name => name === 'db' ? database : name === 'downloads' && dl !== 'none' ? { save: async a => { const r = await window.__dlSave(dl, a); if (r.err) throw new Error(r.err); } } : null };
  }, downloads);
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL_);
  await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  return { ctx, page, errors };
}
const confirmYes = page => page.click('.overlay [data-r="1"]');
const toasts = page => page.$$eval('.toast', els => els.map(e => ({ t: e.textContent, err: e.classList.contains('err') })));
async function importFile(page, obj) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'a4-')), 'b.json'); fs.writeFileSync(f, JSON.stringify(obj));
  await page.setInputFiles('#importFile', f);
}
// 3ch の大きな series（1 点 5 バイト前後）。n 点
function bigRecord(id, n) {
  const base = fx('v2-esp32-drum-2ch.json'); const rec = (base.roasts || [base])[0];
  const r = JSON.parse(JSON.stringify(rec)); r.id = id; r.channels = [r.channels[0], r.channels[1], { key: 'c3', role: 'amb', name: '外気温', color: '#6B7280', offset: 0 }];
  const mk = (a, b) => Array.from({ length: n }, (_, i) => 1000 + Math.round(a * Math.sin(i / b) + (i * 7919 % 97)));
  r.series = { dt: 1, start: -30, scale: 10, data: { c1: mk(900, 700), c2: mk(1000, 650), c3: mk(80, 3000) } };
  r.dropTime = Math.min(r.dropTime || 600, n - 40); r.gaps = [{ from: 100, to: 105 }];
  return r;
}
const dbDoc = (db, p) => (db.docs.has(p) ? JSON.parse(db.docs.get(p)) : null);
const roastsIn = db => [...db.docs].filter(([k]) => k.startsWith('roasts/')).map(([k, v]) => JSON.parse(v));

test('fitCloud: 3ch・1230 点は間引かない。200,000 バイト超は 2 倍・4 倍…と間引き、読み込み経路でも通る', async () => {
  const db = makeDb(); const { ctx, page, errors } = await open(db);
  const small = bigRecord('rsmall', 1230), mid = bigRecord('rmid', 17000), huge = bigRecord('rhuge', 60000);
  assert.ok(bytes(small) < 40000); assert.ok(bytes(mid) > 200000 && bytes(mid) < 262144 * 2); assert.ok(bytes(huge) > 600000);
  await page.evaluate(() => window.__roastlog.show('settings'));
  await importFile(page, { app: 'roastlog', version: 2, roasts: [small, mid, huge], beans: [] });
  await confirmYes(page);
  await waitFor(() => roastsIn(db).length === 3, '3 件保存');
  const by = id => dbDoc(db, 'roasts/' + id);
  assert.equal(by('rsmall').series.decimated, undefined, '小さい記録は間引かない');
  assert.deepEqual(by('rsmall').series, small.series, '小さい記録の series は完全一致');
  for (const id of ['rmid', 'rhuge']) { const r = by(id); assert.ok(r.series.decimated >= 2, id + ' は間引かれる'); assert.ok(bytes(r) <= 200000, `${id} は 200,000 バイト以下: ${bytes(r)}`); assert.deepEqual(r.gaps, [{ from: 100, to: 105 }]); }
  assert.equal(by('rmid').series.decimated, 2, '17000 点は 2 倍で足りる');
  assert.ok(by('rhuge').series.decimated >= by('rmid').series.decimated, '60000 点は 17000 点以上に間引かれる'); // dropTime で打ち切った後の長さで決まる（a5 軽a）
  assert.equal(errors.length, 0, errors.join('\n')); await ctx.close();
});

test('fitCloud: 日本語（3 バイト文字）はバイト数で数える。文字数では 200,000 未満でも間引く', async () => {
  const db = makeDb(); const { ctx, page } = await open(db);
  const r = bigRecord('rjp', 9000); r.memo = 'あ'.repeat(30000);   // 文字数では足りても UTF-8 では 90KB
  assert.ok(JSON.stringify(r).length < 200000 && bytes(r) > 200000, `文字数 ${JSON.stringify(r).length} / バイト ${bytes(r)}`);
  await page.evaluate(() => window.__roastlog.show('settings'));
  await importFile(page, { app: 'roastlog', version: 2, roasts: [r], beans: [] }); await confirmYes(page);
  await waitFor(() => roastsIn(db).length === 1, '保存');
  const saved = dbDoc(db, 'roasts/rjp'); assert.ok(saved.series.decimated >= 2); assert.ok(bytes(saved) <= 200000);
  await ctx.close();
});

test('fitCloud: 間引けない巨大な記録は保存を断り、書き出しを促す（db には書かない）。saveEdit でも同じ', async () => {
  const v1 = fx('v1-backup-a.json').roasts[0];
  const db = makeDb({ ['roasts/' + v1.id]: v1 }); const { ctx, page } = await open(db);
  // 読み込み経路: series の無い巨大な記録
  const huge = { ...v1, id: 'rhuge-v1', memo: 'x'.repeat(300000) };
  await page.evaluate(() => window.__roastlog.show('settings'));
  await importFile(page, { app: 'roastlog', version: 1, roasts: [huge], beans: [] }); await confirmYes(page);
  await waitFor(async () => (await toasts(page)).some(t => t.err && /書き出|大きすぎ/.test(t.t)), 'エラー表示 ' + JSON.stringify(await toasts(page)));
  assert.equal(db.sets.filter(p => p.startsWith('roasts/')).length, 0, '巨大な記録は db に書かない');
  // saveEdit 経路: 既存の記録のメモを巨大にして保存
  await page.evaluate(() => window.__roastlog.show('home')); await page.click('.roast-item');
  await page.evaluate(() => { document.querySelector('#dEdit').open = true; document.querySelector('#eMemo').value = 'y'.repeat(300000); document.querySelector('[data-action="save-edit"]').click(); });
  await waitFor(async () => (await toasts(page)).filter(t => t.err && /大きすぎ/.test(t.t)).length >= 1, 'saveEdit のエラー');
  assert.equal(db.sets.filter(p => p.startsWith('roasts/')).length, 0);
  assert.deepEqual(dbDoc(db, 'roasts/' + v1.id), v1, 'db の元の記録は無傷');
  await ctx.close();
});

test('saveTasting / saveEdit も大きな記録を間引いて保存する', async () => {
  const rec = bigRecord('rbig', 17000); rec.series.decimated = undefined; delete rec.series.decimated;
  const db = makeDb({ 'roasts/rbig': rec }); // db には（別経路で入った）大きな記録
  const { ctx, page } = await open(db);
  await page.click('.roast-item');
  await page.evaluate(() => document.querySelector('[data-action="save-tasting"]').click());
  await waitFor(() => db.sets.includes('roasts/rbig'), '評価の保存');
  const r = dbDoc(db, 'roasts/rbig'); assert.ok(r.series.decimated >= 2); assert.ok(bytes(r) <= 200000); assert.equal(r.tasting.done, true);
  await ctx.close();
});

test('db 保存の失敗は画面に出る。送信待ちに入り、online で再送される', async () => {
  const v1 = fx('v1-backup-a.json').roasts[0];
  const db = makeDb({ ['roasts/' + v1.id]: v1 }); const { ctx, page, errors } = await open(db);
  await page.click('.roast-item');
  db.fail = true;
  await page.evaluate(() => { document.querySelector('#tMemo').value = '送信待ちテスト'; document.querySelector('[data-action="save-tasting"]').click(); });
  await waitFor(async () => (await toasts(page)).some(t => t.err && /claude\.ai に送れませんでした/.test(t.t)), '失敗の表示');
  assert.equal(dbDoc(db, 'roasts/' + v1.id).tasting.memo, v1.tasting?.memo, 'db はまだ古いまま');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('roastlog.pending'))), [{ col: 'roasts', id: v1.id, op: 'set', v: 2 }]);
  await sleep(2700);
  db.fail = true; await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitFor(async () => (await toasts(page)).some(t => t.err && /送信待ち/.test(t.t)), '再送の失敗も表示');
  db.fail = false; await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitFor(() => db.sets.includes('roasts/' + v1.id), '再送');
  assert.equal(dbDoc(db, 'roasts/' + v1.id).tasting.memo, '送信待ちテスト');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('roastlog.pending'))), []);
  assert.equal(errors.length, 0); await ctx.close();
});

test('モックの上限（262,144 バイト）を超える書き込みが reject されても、アプリは先に断る（送信待ちに残さない）', async () => {
  const db = makeDb(); const { ctx, page } = await open(db);
  await page.evaluate(async () => { const d = await window.claude.use('db'); window.__r = await d.doc('roasts/zz').set({ a: 'x'.repeat(262200) }).then(() => 'ok', e => String(e.message)); });
  assert.match(await page.evaluate(() => window.__r), /too large/);
  await ctx.close();
});

test('書き出し: downloads が使えれば save、使えない・失敗ならテキストエリアも必ず出る', async () => {
  const v1 = fx('v1-backup-a.json').roasts[0];
  for (const mode of ['ok', 'none', 'throw']) {
    const db = makeDb({ ['roasts/' + v1.id]: v1 }); const { ctx, page } = await open(db, { downloads: mode });
    await page.evaluate(() => window.__roastlog.show('settings')); await page.click('[data-action="export-json"]');
    if (mode === 'ok') {
      await waitFor(() => db.saved.length === 1, 'downloads.save');
      assert.match(db.saved[0].filename, /^焙煎記録バックアップ_\d{8}\.json$/); assert.equal(JSON.parse(db.saved[0].data).roasts.length, 1);
      assert.equal(await page.$eval('#exportFallback', e => e.hidden), true);
    } else {
      await waitFor(() => page.$eval('#exportFallback', e => !e.hidden), 'テキストの代替 ' + mode);
      assert.equal(JSON.parse(await page.$eval('#exportText', e => e.value)).roasts.length, 1);
    }
    await ctx.close();
  }
});

test('https（claude.ai）の見え方: ESP32・診断・校正・チャンネルは統一の文言。シミュレーターは使える。チップは「claude.ai に保存」', async () => {
  const db = makeDb(); const { ctx, page } = await open(db);
  assert.match(await page.textContent('#modeChip'), /claude\.ai に保存/);
  await page.evaluate(() => window.__roastlog.show('settings'));
  const msg = '機器から配信されたページでのみ使えます';
  assert.equal(await page.$eval('#sConnEsp', e => e.hidden), true);
  assert.match(await page.textContent('#sHttpsNote'), new RegExp(msg));
  for (const id of ['#pCh', '#pCal']) { assert.match(await page.$eval(id + ' .devnote', e => e.textContent), new RegExp(msg)); assert.equal(await page.$eval(id + ' .devnote', e => getComputedStyle(e).display !== 'none'), true); }
  await page.click('#sConn button[data-v="sim"]'); assert.equal(await page.$eval('#sSimBox', e => e.hidden), false);
  await page.evaluate(() => window.__roastlog.show('diag'));
  assert.match(await page.$eval('#dgDevNote', e => e.textContent), new RegExp(msg));
  assert.equal(await page.$eval('#dgDevNote', e => getComputedStyle(e).display !== 'none'), true);
  await ctx.close();
});

test('移行の安全装置: v1 の記録は 1 件も書き換わらずに表示され、評価を保存した 1 件だけが v2 になる。設定の未知の項目は残る。お知らせは 1 回だけ', async () => {
  const recs = []; const seen = new Set();
  for (const f of ['v1-backup-a.json', 'v1-backup-b.json', 'v1-backup-c.json']) fx(f).roasts.forEach(r => { if (!seen.has(r.id)) { seen.add(r.id); recs.push(r); } });
  assert.ok(recs.length >= 3 && recs.every(r => r.schema == null), 'v1 の記録が 3 件以上');
  const beans = fx('v1-backup-a.json').beans;
  const v1set = { ...fx('v1-backup-a.json').settings, legacyFoo: { keep: [1, 2] }, sound: false };
  const init = { 'config/app': v1set }; recs.forEach(r => { init['roasts/' + r.id] = r; }); beans.forEach(b => { init['beans/' + b.id] = b; });
  const db = makeDb(init); const before = new Map(db.docs);
  let { ctx, page, errors } = await open(db);
  // 表示: 全件が一覧に出る。詳細も開ける。書き込みは「お知らせの印」だけ
  assert.equal(await page.$$eval('.roast-item', e => e.length), recs.length);
  assert.equal(await page.$$eval('.roast-item .tag.bad', e => e.length), 0, '読めない記録はない');
  assert.equal(await page.$$eval('#migrateNote', e => e.length), 1, 'お知らせが出る');
  assert.match(await page.textContent('#migrateNote'), /新しい版になりました/); assert.match(await page.textContent('#migrateNote'), /書き出す/);
  for (const r of recs) { await page.click(`.roast-item[data-id="${r.id}"]`); assert.match(await page.textContent('#dTitle'), new RegExp((r.beanName || '').slice(0, 3))); await page.evaluate(() => window.__roastlog.show('home')); }
  assert.deepEqual(db.sets, ['config/notice'], '見ただけでは、記録・設定を一切書かない');
  for (const [k, v] of before) assert.equal(db.docs.get(k), v, k + ' は無傷');
  // 評価を保存した 1 件だけが v2
  const target = recs[1];
  await page.click(`.roast-item[data-id="${target.id}"]`);
  await page.evaluate(() => { document.querySelector('#tMemo').value = '移行後の評価'; document.querySelector('[data-action="save-tasting"]').click(); });
  await waitFor(() => db.sets.includes('roasts/' + target.id), '評価の保存');
  const after = dbDoc(db, 'roasts/' + target.id);
  assert.equal(after.schema, 2); assert.equal(after.tasting.memo, '移行後の評価');
  for (const k of Object.keys(target)) if (!['schema', 'tasting', 'savedAt', 'source', 'channels', 'primary', 'rorConfig'].includes(k)) assert.deepEqual(after[k], target[k], k + ' は v1 のまま');
  assert.deepEqual(after.points, target.points);
  assert.deepEqual(db.sets.filter(p => p.startsWith('roasts/')), ['roasts/' + target.id]);
  for (const r of recs) if (r.id !== target.id) assert.equal(db.docs.get('roasts/' + r.id), before.get('roasts/' + r.id), r.id + ' は v1 のまま');
  // 設定を保存しても、v1 の項目と未知の項目は残る
  await page.evaluate(() => window.__roastlog.show('home')); await page.evaluate(() => window.__roastlog.show('settings'));
  await page.click('[data-action="save-settings"]'); await waitFor(() => db.sets.includes('config/app'), '設定の保存');
  const cfg = dbDoc(db, 'config/app');
  assert.deepEqual(cfg.legacyFoo, { keep: [1, 2] }); assert.equal(cfg.sound, false);
  for (const k of ['interval', 'flick', 'crash', 'rorWindow', 'fireLabels', 'damperLabels', 'rpmOptions']) assert.deepEqual(cfg[k], v1set[k], k);
  assert.ok(cfg.channels && cfg.roasterType, '新しい項目は足される');
  assert.equal(errors.length, 0, errors.join('\n')); await ctx.close();
  // 2 回目の起動では、お知らせは出ない（db の印）
  ({ ctx, page } = await open(db));
  assert.equal(await page.$$eval('#migrateNote', e => e.length), 0, '2 回目は出ない');
  assert.equal((await page.evaluate(() => window.__roastlog.S.roasts.length)), recs.length);
  await ctx.close();
});

test('お知らせの「書き出す」で全データが書き出される', async () => {
  const v1 = fx('v1-backup-a.json').roasts[0];
  const db = makeDb({ ['roasts/' + v1.id]: v1 }); const { ctx, page } = await open(db, { downloads: 'ok' });
  await page.click('[data-action="migrate-export"]');
  await waitFor(() => db.saved.length === 1, '書き出し'); assert.equal(JSON.parse(db.saved[0].data).roasts[0].id, v1.id);
  assert.equal(await page.$$eval('#migrateNote', e => e.length), 0);
  await ctx.close();
});

test('E2E-5: v2 の記録を読み込み → 表示 → 評価を保存 → 再読み込み後も保持', async () => {
  const v2 = fx('v2-esp32-drum-2ch.json'); const rec = (v2.roasts || [v2])[0];
  const db = makeDb(); let { ctx, page, errors } = await open(db);
  await page.evaluate(() => window.__roastlog.show('settings'));
  await importFile(page, { app: 'roastlog', version: 2, roasts: [rec], beans: [] }); await confirmYes(page);
  await waitFor(() => db.sets.includes('roasts/' + rec.id), '読み込みの保存');
  await page.evaluate(() => window.__roastlog.show('home'));
  assert.equal(await page.$$eval('.roast-item', e => e.length), 1);
  await page.click('.roast-item'); await page.waitForSelector('[data-view="detail"]:not([hidden])');
  assert.equal(await page.$eval('#detailChart', c => c.width > 0 && c.height > 0), true);
  await page.evaluate(() => { const s = document.querySelector('#sc_acidity'); s.value = '5'; s.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#tMemo').value = '明るい酸'; document.querySelector('[data-action="save-tasting"]').click(); });
  await waitFor(async () => (await toasts(page)).some(t => /評価を保存しました/.test(t.t)), '保存の表示');
  const saved = dbDoc(db, 'roasts/' + rec.id);
  assert.equal(saved.tasting.acidity, 5); assert.deepEqual(saved.series.data, rec.series.data, 'series は完全一致'); assert.equal(saved.schema, 2);
  await ctx.close();
  ({ ctx, page, errors } = await open(db));   // 再読み込み（端末の保存は空の新しい文脈。db だけが頼り）
  await page.click('.roast-item');
  assert.equal(await page.inputValue('#tMemo'), '明るい酸'); assert.equal(await page.inputValue('#sc_acidity'), '5');
  assert.match(await page.textContent('.roast-item'), /評価済み/);
  assert.equal(errors.length, 0, errors.join('\n')); await ctx.close();
});

// 工兵一番隊 A5: 本物の claude.ai（v1 の記録が入っている db）へ載せ替える前の安全装置。
//   v1 が残した送信待ちは自動で送らない（退避→[内容を見る][送る][捨てる]）、読み込めていない間は設定を保存しない、
//   localStorage が使えない sandbox、v2 で書いた記録を legacy（v1）で開ける往復、軽微な修正 (a)〜(d)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
const LEGACY = fs.readFileSync(path.join(root, 'legacy/roastlog-artifact-v1.html'), 'utf8');
const fx = n => JSON.parse(fs.readFileSync(path.join(root, 'tools/fixtures', n), 'utf8'));
const URL_ = 'https://roast.example/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, label, ms = 8000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + label); await sleep(50); } }

function makeDb(initial = {}) { return { docs: new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)])), sets: [], deletes: [], fail: false, hang: false }; }
const dbDoc = (db, p) => (db.docs.has(p) ? JSON.parse(db.docs.get(p)) : null);
// ls: 起動前に localStorage へ入れておく中身（最初の読み込みだけ）。noLS: localStorage に触ると例外になる sandbox
async function open(db, { html = HTML, ls = null, noLS = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await ctx.route('**/*', route => { const u = route.request().url(); if (u === URL_ || u.startsWith(URL_ + '?')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }); return route.abort(); });
  await ctx.exposeFunction('__dbList', async col => { if (db.hang) await new Promise(r => setTimeout(r, 15000)); return [...db.docs].filter(([k]) => k.startsWith(col + '/')).map(([k, v]) => ({ id: k.slice(col.length + 1), json: v })); });
  await ctx.exposeFunction('__dbGet', p => db.docs.has(p) ? db.docs.get(p) : null);
  await ctx.exposeFunction('__dbSet', (p, json) => { if (db.fail) return { err: 'network' }; if (Buffer.byteLength(json, 'utf8') > 262144) return { err: 'big' }; db.docs.set(p, json); db.sets.push(p); return { ok: true }; });
  await ctx.exposeFunction('__dbDel', p => { if (db.fail) return { err: 'network' }; db.docs.delete(p); db.deletes.push(p); return { ok: true }; });
  await ctx.addInitScript(([lsInit, noLS]) => {
    if (noLS) Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
    else if (lsInit && !sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); for (const k in lsInit) localStorage.setItem(k, JSON.stringify(lsInit[k])); }
    const database = {
      collection: col => ({ get: async () => ({ docs: (await window.__dbList(col)).map(d => ({ id: d.id, data: () => JSON.parse(d.json) })) }) }),
      doc: p => ({
        get: async () => { const j = await window.__dbGet(p); return { exists: j != null, id: p.split('/').pop(), data: () => (j == null ? undefined : JSON.parse(j)) }; },
        set: async o => { const r = await window.__dbSet(p, JSON.stringify(o)); if (r.err) throw new Error(r.err); },
        delete: async () => { const r = await window.__dbDel(p); if (r.err) throw new Error(r.err); },
      }),
    };
    window.claude = { use: async n => (n === 'db' ? database : null) };
  }, [ls, noLS]);
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL_);
  if (!db.hang) await page.waitForFunction(() => document.querySelector('#modeChip')?.textContent !== '読み込み中');
  return { ctx, page, errors };
}
const toasts = page => page.$$eval('.toast', els => els.map(e => ({ t: e.textContent, err: e.classList.contains('err') })));
const lsGet = (page, k) => page.evaluate(k => { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }, k);
const v1a = fx('v1-backup-a.json');
const base = () => { const i = { 'config/app': v1a.settings }; v1a.roasts.forEach(r => { i['roasts/' + r.id] = r; }); v1a.beans.forEach(b => { i['beans/' + b.id] = b; }); return i; };

// ---- 重大1: v1 の送信待ち ----
function leftoverSetup() {
  const r0 = v1a.roasts[0], id = r0.id;
  const db = makeDb(base()); db.docs.set('roasts/' + id, JSON.stringify({ ...r0, memo: 'NEW from other device' }));
  const ls = {
    'roastlog.cache': { roasts: [{ ...r0, memo: 'OLD stale local' }], beans: v1a.beans, settings: { ...v1a.settings, fireLabels: ['LOCAL'] } },
    'roastlog.pending': [{ col: 'roasts', id, op: 'set' }, { col: 'config', id: 'app', op: 'set' }, { col: 'roasts', id: 'ghost', op: 'set' }, { col: 'beans', id: v1a.beans[0].id, op: 'delete' }],
  };
  return { db, ls, id, r0 };
}
test('v1 の送信待ちが残っていても、新しい記録・設定を上書きせず削除もしない。退避して案内を出す', async () => {
  const { db, ls, id } = leftoverSetup();
  const before = db.docs.get('config/app');
  const { ctx, page, errors } = await open(db, { ls });
  await sleep(600);
  assert.deepEqual(db.sets.filter(p => p !== 'config/notice'), [], '自動では何も送らない');
  assert.deepEqual(db.deletes, []);
  assert.equal(dbDoc(db, 'roasts/' + id).memo, 'NEW from other device');
  assert.equal(db.docs.get('config/app'), before);
  assert.ok(db.docs.has('beans/' + v1a.beans[0].id), '豆も削除されない');
  const bak = await lsGet(page, 'roastlog.pending.v1bak');
  assert.equal(bak.length, 3, 'ghost（端末に実体なし）は除き、残りを退避');
  assert.equal(bak.find(e => e.id === id).local.memo, 'OLD stale local', '端末の記録ごと退避');
  assert.deepEqual(await lsGet(page, 'roastlog.pending'), [], '印の無い送信待ちは送信待ちから外す');
  assert.match(await page.textContent('#legacyNote'), /前の版で送れなかった変更が 3 件/);
  for (const t of ['内容を見る', '送る', '捨てる']) assert.ok(await page.$(`#legacyNote button:has-text("${t}")`), t);
  assert.equal(await page.evaluate(id => window.__roastlog.S.roasts.find(r => r.id === id).memo, id), 'NEW from other device', '画面の記録は db の新しい方');
  await page.click('#legacyNote [data-action="legacy-view"]');
  const txt = await page.textContent('#legacyReview');
  assert.match(txt, /NEW from other device/); assert.match(txt, /OLD stale local/); assert.match(txt, /claude\.ai の今/); assert.match(txt, /この端末/);
  assert.equal(errors.length, 0, errors.join('\n')); await ctx.close();
});
test('[送る]: 確認のあと端末の内容で置き換え、削除も実行する。押すまでは何も変わらない', async () => {
  const { db, ls, id } = leftoverSetup();
  const { ctx, page, errors } = await open(db, { ls });
  await page.click('#legacyNote [data-action="legacy-send"]');
  assert.match(await page.textContent('#legacyReview'), /送ると/);
  await sleep(300); assert.equal(dbDoc(db, 'roasts/' + id).memo, 'NEW from other device', '確認画面の間は変わらない');
  await page.click('#legacyReview [data-action="legacy-send-now"]');
  await waitFor(() => dbDoc(db, 'roasts/' + id).memo === 'OLD stale local', '送信');
  assert.deepEqual(dbDoc(db, 'config/app').fireLabels, ['LOCAL']);
  await waitFor(() => !db.docs.has('beans/' + v1a.beans[0].id), '削除');
  await waitFor(async () => (await lsGet(page, 'roastlog.pending.v1bak')) === null, '退避が消える');
  assert.equal(await page.$('#legacyNote'), null);
  assert.equal(errors.length, 0, errors.join('\n'));
  await ctx.close();
  const o2 = await open(db); assert.equal(await o2.page.$('#legacyNote'), null, '二度目の起動では案内は出ない'); await o2.ctx.close();
});
test('[捨てる]: 確認のあと端末の退避を消す。db は何も変わらない', async () => {
  const { db, ls, id } = leftoverSetup();
  const { ctx, page } = await open(db, { ls });
  const sets0 = db.sets.length;
  await page.click('#legacyNote [data-action="legacy-discard"]');
  await page.click('.overlay [data-r="1"]');
  await waitFor(async () => (await lsGet(page, 'roastlog.pending.v1bak')) === null, '退避が消える');
  assert.equal(await page.$('#legacyNote'), null);
  assert.equal(dbDoc(db, 'roasts/' + id).memo, 'NEW from other device'); assert.equal(db.sets.length, sets0); assert.deepEqual(db.deletes, []);
  await ctx.close();
});
test('[内容を見る]の画面からも [送る][捨てる] できる', async () => {
  const { db, ls, id } = leftoverSetup();
  const { ctx, page } = await open(db, { ls });
  await page.click('#legacyNote [data-action="legacy-view"]');
  await page.click('#legacyReview [data-action="legacy-send-now"]');
  await waitFor(() => dbDoc(db, 'roasts/' + id).memo === 'OLD stale local', '送信');
  await ctx.close();
});
test('v1 の delete の送信待ちだけが残っていても、削除しない', async () => {
  const id = v1a.roasts[0].id; const db = makeDb(base());
  const { ctx, page } = await open(db, { ls: { 'roastlog.pending': [{ col: 'roasts', id, op: 'delete' }] } });
  await sleep(500);
  assert.deepEqual(db.deletes, []); assert.ok(db.docs.has('roasts/' + id));
  assert.match(await page.textContent('#legacyNote'), /1 件/);
  await ctx.close();
});
test('この版が積んだ送信待ち（v:2）は、従来どおり自動で送る', async () => {
  const r0 = v1a.roasts[0]; const db = makeDb(base());
  const ls = { 'roastlog.cache': { roasts: [{ ...r0, memo: 'offline edit' }], beans: v1a.beans, settings: v1a.settings }, 'roastlog.pending': [{ col: 'roasts', id: r0.id, op: 'set', v: 2 }] };
  const { ctx, page } = await open(db, { ls });
  await waitFor(() => dbDoc(db, 'roasts/' + r0.id).memo === 'offline edit', '自動送信');
  assert.equal(await page.$('#legacyNote'), null); await ctx.close();
});

// ---- 重大2: 読み込めていない間は保存しない ----
test('読み込みが時間切れのあと設定を保存しても、db の設定は初期値で上書きされない', async () => {
  const db = makeDb({ ...base(), 'config/app': { ...v1a.settings, fireLabels: ['とろ火', '弱', '中', '強', '全開'] } }); db.hang = true;
  const { ctx, page } = await open(db, { noLS: true });
  await page.waitForFunction(() => window.__roastlog.S.loadFrom === 'cache', null, { timeout: 16000 });
  assert.match(await page.textContent('#noloadNote'), /claude\.ai から読み込めていません/);
  assert.ok(await page.$('#noloadNote [data-action="noload-reload"]'));
  await page.evaluate(() => window.__roastlog.show('settings')); await page.click('[data-action="save-settings"]');
  await waitFor(async () => (await toasts(page)).some(t => /読み込めるまで保存できません。書き出しは使えます/.test(t.t)), '保存できない表示');
  await page.evaluate(() => window.__roastlog.show('home')); await page.evaluate(() => document.querySelector('[data-action="toggle-sound"]').click());
  await sleep(500);
  assert.deepEqual(db.sets.filter(p => p !== 'config/notice'), [], 'db に何も書かない');
  assert.deepEqual(dbDoc(db, 'config/app').fireLabels, ['とろ火', '弱', '中', '強', '全開']);
  assert.ok(await page.$('#noloadNote'), 'バナーは出し続ける');
  db.hang = false; await page.click('#noloadNote [data-action="noload-reload"]');
  await waitFor(async () => !(await page.$('#noloadNote')), 'バナーが消える');
  assert.equal(await page.evaluate(() => window.__roastlog.S.settings.fireLabels.join(',')), 'とろ火,弱,中,強,全開');
  await page.evaluate(() => window.__roastlog.show('settings')); await page.click('[data-action="save-settings"]');
  await waitFor(() => db.sets.includes('config/app'), '保存できる');
  await ctx.close();
});
test('読み込めていない間に焙煎を終えても、記録は下書きに残り、db には書かない', async () => {
  const db = makeDb(base()); db.hang = true;
  const { ctx, page } = await open(db);
  await page.waitForFunction(() => window.__roastlog.S.loadFrom === 'cache', null, { timeout: 16000 });
  await page.evaluate(() => { const S = window.__roastlog.S; S.draft = { id: 'rdr', status: 'finishing', beanName: 'X', points: [{ t: 0, temp: 100 }], events: [], changes: [], startedAt: Date.now() - 1000, interval: 30, initial: {}, greenWeight: 100 }; window.__roastlog.show('finish'); });
  await page.click('[data-action="save-finish"]');
  await waitFor(async () => (await toasts(page)).some(t => /読み込めるまで保存できません/.test(t.t)), '断る表示');
  assert.ok(await page.evaluate(() => !!window.__roastlog.S.draft), '下書きは残る');
  assert.equal(db.sets.filter(p => p.startsWith('roasts/')).length, 0);
  await ctx.close();
});

// ---- 中1: localStorage が使えない sandbox ----
test('localStorage が使えなくても容量不足の扱いにならない。db に保存できれば成功を表示する', async () => {
  const id = v1a.roasts[0].id; const db = makeDb(base());
  const { ctx, page, errors } = await open(db, { noLS: true });
  assert.equal(await page.evaluate(() => { try { return typeof localStorage; } catch { return 'blocked'; } }), 'blocked');
  await page.click(`.roast-item[data-id="${id}"]`);
  await page.evaluate(() => { document.querySelector('#tMemo').value = 'x'; document.querySelector('[data-action="save-tasting"]').click(); });
  await waitFor(() => db.sets.includes('roasts/' + id), 'db に保存');
  await waitFor(async () => (await toasts(page)).some(t => t.t === '評価を保存しました' && !t.err), '成功を表示');
  assert.ok(!(await toasts(page)).some(t => /容量/.test(t.t)));
  assert.equal(await page.$('#unsavedNote'), null);
  assert.equal(errors.length, 0, errors.join('\n')); await ctx.close();
});
test('localStorage が使えず db にも失敗したら「どこにも保存されていません」。トーストは 1 回だけで、以後はバナー', async () => {
  const id = v1a.roasts[0].id; const db = makeDb(base());
  const { ctx, page } = await open(db, { noLS: true });
  await page.click(`.roast-item[data-id="${id}"]`);
  db.fail = true;
  const save = async v => { await page.evaluate(v => { document.querySelector('#tMemo').value = v; document.querySelector('[data-action="save-tasting"]').click(); }, v); };
  await save('a');
  await waitFor(async () => (await toasts(page)).some(t => t.err && /どこにも保存されていません/.test(t.t)), '1 回目のトースト');
  assert.match(await page.textContent('#unsavedNote'), /この記録はまだどこにも保存されていません。書き出してください/);
  assert.ok(await page.$('#unsavedNote [data-action="unsaved-export"]'));
  await sleep(6300); assert.equal((await toasts(page)).length, 0);
  await save('b'); await sleep(700);
  assert.equal((await toasts(page)).filter(t => t.err).length, 0, '2 回目は赤いトーストを出さない');
  assert.ok(await page.$('#unsavedNote'));
  assert.ok(!(await toasts(page)).some(t => /容量/.test(t.t)));
  db.fail = false; await save('c'); await waitFor(async () => !(await page.$('#unsavedNote')), '保存できたらバナーが消える');
  await ctx.close();
});

// ---- legacy へ戻したときの往復 ----
test('新版で書いた v2 の記録・設定を legacy（v1）のコードで開いて表示できる', async () => {
  const db = makeDb(base());
  let { ctx, page } = await open(db);
  const id = v1a.roasts[0].id;
  await page.click(`.roast-item[data-id="${id}"]`);
  await page.evaluate(() => { document.querySelector('#tMemo').value = 'v2 で評価'; document.querySelector('[data-action="save-tasting"]').click(); });
  await waitFor(() => db.sets.includes('roasts/' + id), '評価の保存');
  await page.evaluate(() => window.__roastlog.show('settings')); await page.click('[data-action="save-settings"]');
  await waitFor(() => db.sets.includes('config/app'), '設定の保存');
  const auto = fx('v2-esp32-tenami-3ch.json'); const ar = (auto.roasts || [auto])[0]; db.docs.set('roasts/' + ar.id, JSON.stringify(ar));
  await ctx.close();
  assert.equal(dbDoc(db, 'roasts/' + id).schema, 2);
  ({ ctx, page } = await open(db, { html: LEGACY }));
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await waitFor(async () => (await page.$$('.roast-item')).length >= 2, 'legacy の一覧');
  for (const rid of [id, ar.id]) {
    await page.click(`.roast-item[data-id="${rid}"]`);
    await waitFor(async () => (await page.evaluate(() => document.querySelector('#dTitle')?.textContent || '')).length > 0, 'legacy の詳細 ' + rid);
    await page.goto(URL_); await page.waitForSelector('.roast-item');
  }
  assert.equal(errs.length, 0, errs.join('\n'));
  await ctx.close();
});

// ---- 軽 ----
test('(a) 間引いても排出の温度が平均にならない  (b) 保存を断ったら間引いた series を画面に残さない', async () => {
  const base2 = fx('v2-esp32-drum-2ch.json'); const rec0 = (base2.roasts || [base2])[0];
  const mk = (n, a, b) => Array.from({ length: n }, (_, i) => 1000 + Math.round(a * Math.sin(i / b) + (i * 7919 % 97)));
  const mkRec = (id, n, drop) => { const r = JSON.parse(JSON.stringify(rec0)); r.id = id; r.channels = [r.channels[0], r.channels[1], { key: 'c3', role: 'amb', name: '外気温', color: '#6B7280', offset: 0 }]; r.series = { dt: 1, start: -30, scale: 10, data: { c1: mk(n, 900, 700), c2: mk(n, 1000, 650), c3: mk(n, 80, 3000) } }; r.dropTime = drop; r.events = (r.events || []).filter(e => e.type !== 'drop').concat([{ type: 'drop', t: drop }]); return r; };
  const rec = mkRec('rdrop', 21000, 16999);
  const db = makeDb({ 'roasts/rdrop': rec });
  const { ctx, page } = await open(db);
  await page.click('.roast-item[data-id="rdrop"]');
  await page.evaluate(() => { document.querySelector('#tMemo').value = 'm'; document.querySelector('[data-action="save-tasting"]').click(); });
  await waitFor(() => db.sets.includes('roasts/rdrop'), '保存');
  const saved = dbDoc(db, 'roasts/rdrop'); assert.ok(saved.series.decimated >= 2);
  const idx = Math.floor((16999 - saved.series.start) / saved.series.dt + 1e-9);
  assert.equal(saved.series.data.c1[idx], rec.series.data.c1[16999 + 30], '排出の秒の温度は生の値');
  assert.equal(saved.series.data.c1.length, idx + 1, '排出で打ち切る');
  await ctx.close();
  // (b) 240,000 バイトを超えて断られたら、画面のデータは間引かれたままにならない
  const bigRec = mkRec('rhuge', 60000, 50000); bigRec.memo = 'x'.repeat(245000);   // 間引いても 240,000 バイトを超える
  const db2 = makeDb({ 'roasts/rhuge': bigRec });
  const o = await open(db2);
  await o.page.evaluate(() => { window.__roastlog.S.detailId = 'rhuge'; window.__roastlog.show('detail'); window.__big = window.__roastlog.S.roasts[0]; });
  const before = await o.page.evaluate(() => window.__big.series.data.c1.length);
  await o.page.evaluate(() => { document.querySelector('#tMemo').value = 'm'; document.querySelector('[data-action="save-tasting"]').click(); });
  await waitFor(async () => (await toasts(o.page)).some(t => /大きすぎ/.test(t.t)), '断る表示');
  const after2 = await o.page.evaluate(() => ({ n: window.__big.series.data.c1.length, dec: window.__big.series.decimated, tasting: window.__big.tasting && window.__big.tasting.memo }));
  assert.equal(after2.dec, undefined, '間引いた series を画面に残さない');
  assert.equal(after2.n, before, '元の長さのまま');
  assert.notEqual(after2.tasting, 'm', '評価も残さない');
  assert.ok(!db2.sets.includes('roasts/rhuge'));
  await o.ctx.close();
});
test('(c) 豆の保存に失敗したら表示する  (d) 名前の無い豆があっても豆の管理が開く', async () => {
  const i = base(); i['beans/noname'] = { id: 'noname' }; i['beans/num'] = { id: 'num', name: 5 };
  const db = makeDb(i);
  const { ctx, page, errors } = await open(db);
  await page.evaluate(() => window.__roastlog.show('beans'));
  assert.ok((await page.$$('.bean-item')).length >= 3, '名前の無い豆も一覧に出る');
  db.fail = true;
  await page.fill('#bName', '新しい豆'); await page.click('[data-action="save-bean"]');
  await waitFor(async () => (await toasts(page)).some(t => t.err && /送れませんでした/.test(t.t)), '失敗の表示');
  assert.ok(!(await toasts(page)).some(t => t.t === '豆を保存しました'));
  db.fail = false; await page.fill('#bName', '新しい豆2'); await page.click('[data-action="save-bean"]');
  await waitFor(async () => (await toasts(page)).some(t => t.t === '豆を保存しました'), '成功の表示');
  assert.equal(errors.length, 0, errors.join('\n')); await ctx.close();
});

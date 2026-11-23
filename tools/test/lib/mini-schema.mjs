// 依存なしの JSON Schema 検証器（このリポジトリの schema が使う部分集合のみ）
// 対応: $ref(#/$defs/..), type(配列可), enum, const, properties, required, additionalProperties(schema/false),
//       items, minItems, maxItems, minimum, maximum, exclusiveMinimum, minLength, pattern, oneOf, anyOf
export function validate(schema, data, root = schema) {
  const errors = [];
  walk(schema, data, '', root, errors);
  return errors;
}

function typeOf(x) {
  if (x === null) return 'null';
  if (Array.isArray(x)) return 'array';
  if (typeof x === 'number') return Number.isInteger(x) ? 'integer' : 'number';
  return typeof x;
}
function typeOk(t, x) {
  const a = typeOf(x);
  return t === a || (t === 'number' && a === 'integer');
}
function resolve(ref, root) {
  if (!ref.startsWith('#/')) throw new Error('未対応の $ref: ' + ref);
  return ref.slice(2).split('/').reduce((o, k) => o[k], root);
}

function walk(s, x, p, root, errs) {
  if (s.$ref) return walk(resolve(s.$ref, root), x, p, root, errs);
  const at = p || '(root)';
  if (s.oneOf || s.anyOf) {
    const list = s.oneOf || s.anyOf;
    const hits = list.filter(sub => { const e = []; walk(sub, x, p, root, e); return e.length === 0; });
    if (s.oneOf ? hits.length !== 1 : hits.length < 1) {
      // 診断用: type/const が一致する候補のエラーを出す
      const guess = list.find(sub => { const r = sub.$ref ? resolve(sub.$ref, root) : sub; return r.properties?.type?.const !== undefined && r.properties.type.const === x?.type; });
      if (guess) walk(guess, x, p, root, errs);
      else errs.push(`${at}: ${list.length} 個の候補のどれにも一致しません`);
    }
    return;
  }
  if (s.const !== undefined && x !== s.const) { errs.push(`${at}: ${JSON.stringify(s.const)} である必要があります`); return; }
  if (s.enum && !s.enum.includes(x)) { errs.push(`${at}: ${JSON.stringify(x)} は ${JSON.stringify(s.enum)} のいずれかである必要があります`); return; }
  if (s.type) {
    const ts = Array.isArray(s.type) ? s.type : [s.type];
    if (!ts.some(t => typeOk(t, x))) { errs.push(`${at}: 型が ${ts.join('|')} ではありません (${typeOf(x)})`); return; }
  }
  if (typeof x === 'number') {
    if (s.minimum !== undefined && x < s.minimum) errs.push(`${at}: ${x} < ${s.minimum}`);
    if (s.maximum !== undefined && x > s.maximum) errs.push(`${at}: ${x} > ${s.maximum}`);
    if (s.exclusiveMinimum !== undefined && x <= s.exclusiveMinimum) errs.push(`${at}: ${x} <= ${s.exclusiveMinimum}`);
  }
  if (typeof x === 'string') {
    if (s.minLength !== undefined && x.length < s.minLength) errs.push(`${at}: 短すぎます`);
    if (s.pattern && !new RegExp(s.pattern).test(x)) errs.push(`${at}: pattern ${s.pattern} に一致しません (${x})`);
  }
  if (Array.isArray(x)) {
    if (s.minItems !== undefined && x.length < s.minItems) errs.push(`${at}: 要素数 ${x.length} < ${s.minItems}`);
    if (s.maxItems !== undefined && x.length > s.maxItems) errs.push(`${at}: 要素数 ${x.length} > ${s.maxItems}`);
    if (s.items) x.forEach((it, i) => walk(s.items, it, `${p}[${i}]`, root, errs));
  }
  if (x && typeof x === 'object' && !Array.isArray(x)) {
    for (const k of s.required || []) if (!(k in x)) errs.push(`${at}: 必須の "${k}" がありません`);
    for (const [k, sub] of Object.entries(s.properties || {})) if (k in x) walk(sub, x[k], `${p}.${k}`, root, errs);
    if (s.additionalProperties !== undefined) {
      for (const k of Object.keys(x)) {
        if (s.properties && k in s.properties) continue;
        if (s.additionalProperties === false) errs.push(`${at}: 未知のキー "${k}"`);
        else walk(s.additionalProperties, x[k], `${p}.${k}`, root, errs);
      }
    }
  }
}

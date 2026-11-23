// 焙煎曲線モデル（SPEC 7.2）。app/index.html の @sim 区間と同一コード。
// - Node 専用 API は使わない（ブラウザでそのまま動く）
// - @sim-begin 〜 @sim-end の中身を app に貼る。区間の外（export 等）は貼らない
// - 時刻はモデル秒 k（0 始まり、1 秒刻み）。step() を呼ぶたびに 1 秒進む

// @sim-begin
const SIM_FAULT_CODES = { open: 1, gnd: 2, vcc: 3, ovuv: 4, range: 5, cj: 6, nodev: 7, stale: 8 };

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// opts: { profile:'drum'|'tenami', seed, noise(σ℃), room, preheat, chargeAt(モデル秒|null),
//         outlierP, tauP, h, fire, damper, faults:[{ch:0..2|'c1'..'c3', kind, from, to}] }
// controls: { fire:0..2, damper:0..4, charge:true(今すぐ投入) }
// 戻り値 step(): { k, t, charged, v:[BT,ET,AMB]|null, f:[..], cj }（v は 0.1℃ に丸めた℃）
//   t = 投入からの秒（投入前は null）
function createModel(opts) {
  const o = opts || {};
  const profile = o.profile === 'tenami' ? 'tenami' : 'drum';
  const tenami = profile === 'tenami';
  const rng = mulberry32(o.seed == null ? 1 : o.seed);
  const sigma = o.noise == null ? 0.3 : o.noise;
  const room = o.room == null ? 20 : o.room;
  const outlierP = o.outlierP == null ? 1 / 300 : o.outlierP;
  const h = o.h == null ? 0.0030 : o.h;            // 豆への熱伝達（1/秒）
  const tauP = o.tauP == null ? (tenami ? 15 : 25) : o.tauP;   // プローブの時定数（秒）
  const exoUp = o.exoUp == null ? 0.08 : o.exoUp;              // SPEC: +0.08℃/秒
  const exoDown = o.exoDown == null ? -0.10 : o.exoDown;      // SPEC は -0.05。プローブの遅れ（τp）で薄まるので強めた
  const shakeA = 8;                                 // 手網の振り（Ta への揺れ ℃）
  const shakeBt = 5;                                // 手網の振りが BT 表示に直接出る分（℃）
  const chargeAt = o.chargeAt === undefined ? 40 : o.chargeAt;
  const faults = (o.faults || []).map(function (f) {
    var ch = typeof f.ch === 'string' ? parseInt(f.ch.replace(/^c/i, ''), 10) - 1 : f.ch;
    return { ch: ch, code: typeof f.kind === 'number' ? f.kind : (SIM_FAULT_CODES[f.kind] || 1), from: f.from, to: f.to };
  });
  const ctl = { fire: o.fire == null ? 2 : o.fire, damper: o.damper == null ? 1 : o.damper };
  const preheat = o.preheat == null ? 200 : o.preheat;

  var k = 0;
  var Ta = tenami ? (o.ta0 == null ? 150 : o.ta0) : preheat;
  var Tb = room;
  var Tp = tenami ? room : preheat;
  var chargeK = null;
  var truth = { chargeT: null, tpT: null, fc1T: null, fc1eT: null, tpTemp: null, chargeTemp: null };
  var minTp = Infinity, minTpK = null, tpLocked = false, tp0 = null;
  var cj = room + 4;
  var lastSample = null;

  function gauss() {
    var u = Math.max(rng(), 1e-12), w = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
  }
  function r1(x) { return Math.round(x * 10) / 10; }

  function exo() {
    if (chargeK == null || truth.fc1T == null) return 0;
    if (truth.fc1eT == null) return exoUp;             // 1ハゼの発熱（195〜205℃）
    if (k - truth.fc1eT < 30) return exoDown;          // 直後 30 秒は水分の放出（RoR の急降下）
    return 0;
  }

  function step(controls) {
    var c = controls || {};
    if (c.fire != null) ctl.fire = c.fire;
    if (c.damper != null) ctl.damper = c.damper;
    if (chargeK == null && (c.charge || (chargeAt != null && k >= chargeAt))) {
      chargeK = k; truth.chargeT = k; truth.chargeTemp = r1(Tp); tp0 = Tp;
    }
    // 乱数は常に同じ数だけ引く（故障の有無でノイズ列が変わらない）
    var n = [gauss(), gauss(), gauss(), gauss()];
    var ou = [rng(), rng(), rng()];
    var shake = tenami ? Math.sin(2 * Math.PI * 0.7 * k) : 0;

    // 空気: Ta_target = 150 + 45*fire - 15*damper(0..1)
    var target = 150 + 45 * ctl.fire - 15 * (ctl.damper / 4);
    Ta += (target - Ta) / 40;
    // 豆
    if (chargeK != null) {
      if (truth.fc1T == null && Tb >= 195) truth.fc1T = k;
      if (truth.fc1T != null && truth.fc1eT == null && Tb >= 205) truth.fc1eT = k;
      var inWindow = Tb >= 195 && Tb < 205;
      var e = (inWindow || truth.fc1eT != null) ? exo() : 0;
      Tb += h * (Ta - Tb) + e;
      Tp += ((0.8 * Tb + 0.2 * Ta) - Tp) / tauP;
      // TP の真値（投入から 5℃以上下がって上がりに転じた最小点）
      if (!tpLocked) {
        if (Tp < minTp) { minTp = Tp; minTpK = k; }
        if (tp0 - minTp >= 5 && Tp >= minTp + 3) { tpLocked = true; truth.tpT = minTpK; truth.tpTemp = r1(minTp); }
      }
    } else {
      Tp += tenami ? (room - Tp) / 5 : (Ta - Tp) / tauP;   // 手網: 室温のまま / ドラム: 空気に追従
    }

    var bt = Tp + (tenami ? shakeBt * shake : 0) + sigma * n[0];
    var et = Ta + 5 + (tenami ? shakeA * shake : 0) + sigma * n[1];
    var amb = room + 0.3 * Math.sin(k / 60) + 0.1 * sigma * n[2];
    if (ou[0] < outlierP) bt += 40;
    if (ou[1] < outlierP) et += 40;
    if (ou[2] < outlierP) amb += 40;
    cj = room + 4 + Math.min(10, k / 600) + 0.05 * n[3];

    var v = [r1(bt), r1(et), r1(amb)];
    var f = [0, 0, 0];
    for (var i = 0; i < faults.length; i++) {
      var ft = faults[i];
      if (k >= ft.from && k <= ft.to && ft.ch >= 0 && ft.ch < 3) { v[ft.ch] = null; f[ft.ch] = ft.code; }
    }
    lastSample = { k: k, t: chargeK == null ? null : k - chargeK, charged: chargeK != null, v: v, f: f, cj: r1(cj) };
    k++;
    return lastSample;
  }

  return {
    profile: profile,
    step: step,
    get k() { return k; },
    get charged() { return chargeK != null; },
    last: function () { return lastSample; },
    truth: function () {
      return {
        profile: profile, now: k, chargeT: truth.chargeT, tpT: truth.tpT, fc1T: truth.fc1T, fc1eT: truth.fc1eT,
        tpTemp: truth.tpTemp, chargeTemp: truth.chargeTemp,
        tb: r1(Tb), tp: r1(Tp), ta: r1(Ta),
      };
    },
    controls: function () { return { fire: ctl.fire, damper: ctl.damper }; },
    // 故障を後から足す（シミュレーターの「故障を起こす」ボタン用）
    addFault: function (ch, kind, from, to) {
      var idx = typeof ch === 'string' ? parseInt(ch.replace(/^c/i, ''), 10) - 1 : ch;
      faults.push({ ch: idx, code: typeof kind === 'number' ? kind : (SIM_FAULT_CODES[kind] || 1), from: from, to: to });
    },
  };
}
// @sim-end

export { createModel, mulberry32, SIM_FAULT_CODES };

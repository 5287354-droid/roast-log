#!/usr/bin/env python3
"""1本用（秋月 C タイプ 72x47）の部品配置の全探索。layout_check.py と同じ考え方（2.54mm の格子の上を全部試す）。

手順
  1. XIAO とアンプの置き方（位置、アンプの向き 2 通り）を全部ためして、
     基板のふち・取付穴・XIAO とアンプの距離の条件を満たすものを数える。
  2. それぞれについて、核になる配線（3V3 / GND / SCK / MISO / CS）の最小の配線（長さ・交差・はんだの点数）を求める。
  3. 上位の置き方について、抵抗 + LED、タクトスイッチを全部の位置と向きでためして、
     全体の配線が最小になるものを選ぶ。
  評価 = 100 × 交差の数 + 5 × 線の端のはんだの数 + 線の長さ(mm) + 0.3 × 他のネットのはんだの上を通る数
使い方: python3 board_1ch_search.py [--flip-only 0|1] [--top N]   （結果は board_1ch_search_result.json にも書く）
"""
import sys, json, math, itertools, time
from multiprocessing import Pool
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from board_1ch_lib import *

def free(lay, p):
    return (not pad_blocked(p)) and p not in lay.occ

def seg_clear(lay, a, b, own, clr=2.4):
    """抵抗の胴が、ほかの足の穴に近すぎないか"""
    A, B = mm(a), mm(b)
    for p in lay.occ:
        if p in own: continue
        if seg_dist_pt(A, B, mm(p)) < clr: return False
    return True

def window(p, w):
    for dc in range(-w, w + 1):
        for dr in range(-w, w + 1):
            q = (p[0] + dc, p[1] + dr)
            if 0 <= q[0] < COLS and 0 <= q[1] < ROWS: yield q

def led_ok(lay, rects, centre):
    cx, cy = centre
    if min(cx, BX - cx, cy, BY - cy) < 5.0: return False
    for r in rects:
        if pt_rect_dist(centre, r) < LED_TUBE_R + 0.5: return False
    for m in MOUNT:
        if math.dist(centre, mm(m)) < 6.0: return False
    return True

def btn_ok(rects, centre):
    cx, cy = centre
    if min(cx, BX - cx, cy, BY - cy) < 5.4: return False
    for r in rects:
        if pt_rect_dist(centre, r) < BTN_TUBE_R + 0.5: return False
    for m in MOUNT:
        if math.dist(centre, mm(m)) < 7.0: return False
    return True

def d4_pad(lay): return [p for p, o in lay.occ.items() if o[1] == "D4"][0]
def d5_pad(lay): return [p for p, o in lay.occ.items() if o[1] == "D5"][0]

def best_chain(lay, rects, top_r=40, per_r=80):
    """抵抗 + LED の置き方を全部ためして、全体の配線が最小のものを返す"""
    d4 = d4_pad(lay)
    rcand = []
    for ra in window(d4, 8):
        for horiz in (True, False):
            for span in (1, 3, 4):
                rb = (ra[0] + span, ra[1]) if horiz else (ra[0], ra[1] + span)
                if not (0 <= rb[0] < COLS and 0 <= rb[1] < ROWS): continue
                if not (free(lay, ra) and free(lay, rb)): continue
                if span > 1 and not seg_clear(lay, ra, rb, (ra, rb)): continue
                for (pin_in, pin_out) in ((ra, rb), (rb, ra)):
                    est = min(local_cost(w) for w in edge_options(lay, "LEDIN", d4, pin_in))
                    rcand.append((est, pin_in, pin_out, span))
    rcand.sort(key=lambda t: t[0])
    best = None
    for est, rin, rout, span in rcand[:top_r]:
        l2 = lay.copy()
        l2.add("R1", "res", [("a", rin, "LEDIN"), ("b", rout, "LEDA")])
        l2.extra["res_span"] = span
        # LED の候補: アノード A の窓、カソード K は上下左右
        lc = []
        for a in window(rout, 4):
            for dk in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                k = (a[0] + dk[0], a[1] + dk[1])
                if not (0 <= k[0] < COLS and 0 <= k[1] < ROWS): continue
                if not (free(l2, a) and free(l2, k)) or a == k: continue
                cen = ((mm(a)[0] + mm(k)[0]) / 2, (mm(a)[1] + mm(k)[1]) / 2)
                if not led_ok(l2, rects, cen): continue
                if span > 1 and seg_dist_pt(mm(rin), mm(rout), cen) < 4.0: continue
                est = min(local_cost(w) for w in edge_options(l2, "LEDA", rout, a))
                lc.append((est, a, k, cen))
        lc.sort(key=lambda t: t[0])
        for est, a, k, cen in lc[:per_r]:
            l3 = l2.copy()
            l3.add("LED1", "led", [("anode", a, "LEDA"), ("cathode", k, "GND")])
            l3.extra["led_centre"] = cen
            res = full_route(l3, keep=8)
            if res is None: continue
            if best is None or res[0] < best[0]: best = (res[0], l3, res)
    return best

def sw_pads(c, r, horiz, flipnet):
    """4 本足: horiz = 3 列 × 2 段。つながった同じ側の 2 本が、列（または段）の方向に 2 穴はなれる"""
    if horiz:
        a = [(c, r), (c, r + 2)]; b = [(c + 3, r), (c + 3, r + 2)]
        cen = (mm((c, r))[0] / 2 + mm((c + 3, r + 2))[0] / 2, mm((c, r))[1] / 2 + mm((c + 3, r + 2))[1] / 2)
    else:
        a = [(c, r), (c + 2, r)]; b = [(c, r + 3), (c + 2, r + 3)]
        cen = (mm((c, r))[0] / 2 + mm((c + 2, r + 3))[0] / 2, mm((c, r))[1] / 2 + mm((c + 2, r + 3))[1] / 2)
    if flipnet: a, b = b, a
    return a, b, cen

def best_switch(lay, rects, top=150):
    d5 = d5_pad(lay)
    cands = []
    for c in range(COLS):
        for r in range(ROWS):
            for horiz in (True, False):
                for fl in (False, True):
                    a, b, cen = sw_pads(c, r, horiz, fl)
                    pads = a + b
                    if any(not (0 <= p[0] < COLS and 0 <= p[1] < ROWS) for p in pads): continue
                    if any(not free(lay, p) for p in pads): continue
                    if not btn_ok(rects, cen): continue
                    if math.dist(cen, lay.extra["led_centre"]) < 9.5: continue
                    est = min(math.dist(mm(d5), mm(p)) for p in a)
                    cands.append((est, a, b, cen, horiz))
    cands.sort(key=lambda t: t[0])
    best = None
    for est, a, b, cen, horiz in cands[:top]:
        l2 = lay.copy()
        l2.add("SW1", "sw", [("a1", a[0], "BTN"), ("a2", a[1], "BTN"), ("b1", b[0], "GND"), ("b2", b[1], "GND")])
        l2.extra["sw_centre"] = cen; l2.extra["sw_horiz"] = horiz
        res = full_route(l2, keep=8)
        if res is None: continue
        if best is None or res[0] < best[0]: best = (res[0], l2, res)
    return best

def stage2(args):
    xp, ap, xr, ar_ = args
    lay = Layout(xp, ap)
    rects = [xr, ar_]
    t = best_chain(lay, rects)
    if t is None: return None
    s = best_switch(t[1], rects)
    if s is None: return None
    return (s[0], xp, ap, s[1], s[2])

def summarize(res):
    cost, wires, cr, att, ln = res[2] if len(res) == 3 else res
    return cost, cr, att, ln

if __name__ == "__main__":
    t0 = time.time()
    flip_only = None; top_n = 12
    if "--flip-only" in sys.argv: flip_only = int(sys.argv[sys.argv.index("--flip-only") + 1])
    if "--top" in sys.argv: top_n = int(sys.argv[sys.argv.index("--top") + 1])
    cores = core_candidates()
    print(f"1. XIAO とアンプの置き方（条件を満たすもの）: {len(cores)} 通り"
          f"（うち アンプ向き 通常 {sum(1 for c in cores if c[1][2]==0)} / 逆 {sum(1 for c in cores if c[1][2]==1)}）")
    out = {}
    for flip in (0, 1):
        if flip_only is not None and flip != flip_only: continue
        cs = [c for c in cores if c[1][2] == flip]
        scored = []
        for xp, ap, xr, ar_ in cs:
            lay = Layout(xp, ap)
            r = full_route(lay, keep=10)
            if r is None: continue
            scored.append((r[0], xp, ap, xr, ar_, r))
        scored.sort(key=lambda t: t[0])
        print(f"2. アンプ向き={'逆' if flip else '通常'}: 核の配線が成り立つ置き方 {len(scored)} 通り。上位 {top_n} を詳しく調べます")
        for s in scored[:5]:
            print(f"   核のみ cost={s[0]:.1f} XIAO={s[1]} アンプ={s[2]} 交差={s[5][2]} 端={s[5][3]} 長さ={s[5][4]:.1f}mm")
        with Pool() as pool:
            res = [r for r in pool.map(stage2, [(s[1], s[2], s[3], s[4]) for s in scored[:top_n]]) if r]
        res.sort(key=lambda t: t[0])
        print(f"3. 抵抗+LED+スイッチまで入れた全体（アンプ向き={'逆' if flip else '通常'}）")
        for s in res[:6]:
            cost, xp, ap, lay, r = s
            print(f"   cost={cost:.1f} XIAO={xp} アンプ={ap[:2]} 交差={r[2]} 線の端={r[3]} 長さ={r[4]:.1f}mm"
                  f" LED={lay.extra['led_centre'][0]:.0f},{lay.extra['led_centre'][1]:.0f} SW={lay.extra['sw_centre'][0]:.0f},{lay.extra['sw_centre'][1]:.0f}")
        out[flip] = [{"cost": s[0], "xiao": s[1], "amp": s[2], "crossings": s[4][2], "attach": s[4][3], "length": s[4][4],
                      "parts": [(p, k, [(n, list(pad), net) for n, pad, net in pins]) for p, k, pins in s[3].parts],
                      "extra": {k: (list(v) if isinstance(v, (tuple, list)) else v) for k, v in s[3].extra.items()},
                      "wires": [(n, w[0], list(w[1]), list(w[2]), [list(c) for c in w[3]]) for n, w in s[4][1]]} for s in res[:8]]
    json.dump(out, open(__import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)), "board_1ch_search_result.json"), "w"), ensure_ascii=False, indent=1)
    print(f"経過 {time.time()-t0:.0f} 秒")

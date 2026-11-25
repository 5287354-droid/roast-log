#!/usr/bin/env python3
"""熱電対1本用の基板（秋月 C タイプ）の配置と配線のモデル。
board_1ch_search.py（全探索）と board_1ch_make.py（JSON を作る）が使う。

座標: 穴は (c, r)。c = 左から（0 始まり）、r = 手前（前）から（0 始まり）。
      表（部品面）から見て、USB-C が左、手前が下。
名前: 列は A, B, ...（左から）、行は 1, 2, ...（上=奥 から）。左上の穴が A1。
      つまり r（手前から）の穴は、行番号 = ROWS - r。
"""
import itertools, math

P = 2.54
COLS, ROWS = 28, 18            # [要実測] 秋月 C タイプの穴の数
BX, BY = 72.0, 47.0            # [要実測] 基板の外形
GX0 = (BX - (COLS - 1) * P) / 2
GY0 = (BY - (ROWS - 1) * P) / 2
MOUNT = [(1, 1), (COLS - 2, 1), (1, ROWS - 2), (COLS - 2, ROWS - 2)]   # [要実測] 取付穴（格子の穴の位置と仮定）

# 部品の寸法（scad と同じ。[要実測]）
XIAO_L, XIAO_W = 21.0, 17.8
AMP_L, AMP_W, AMP_PIN_OFF = 25.0, 20.0, 2.5
XIAO_ROWGAP = 6                # 左右のピン列の間（穴 6 ピッチ = 15.24mm）
MIN_XA = 16.0                  # XIAO とアンプの最低距離（mm。基板の温度で測るため）
EDGE = 1.0                     # 部品と基板のふちのすき間
MOUNT_KEEP = 4.0               # 取付穴の中心から部品の本体まで
PAD_KEEP = 3.7                 # 取付穴の中心からこの距離以内の穴は使わない（柱がある）
LED_TUBE_R = 4.5               # ふたの導光筒の半径
BTN_TUBE_R = 4.9               # ふたのボタン筒の半径

def X(c): return GX0 + c * P
def Y(r): return GY0 + r * P
def mm(p): return (X(p[0]), Y(p[1]))
def col_letter(c): return chr(ord('A') + c) if c < 26 else 'A' + chr(ord('A') + c - 26)   # A..Z, AA, AB
def name(p): return col_letter(p[0]) + str(ROWS - p[1])
def parse(n):
    i = 0
    while n[i].isalpha(): i += 1
    letters = n[:i]
    c = ord(letters[0]) - ord('A') if len(letters) == 1 else 26 + ord(letters[1]) - ord('A')
    return (c, ROWS - int(n[i:]))

XIAO_BACK = ["5V", "GND", "3V3", "D10", "D9", "D8", "D7"]     # 奥の列（左=USB 側から）
XIAO_FRONT = ["D0", "D1", "D2", "D3", "D4", "D5", "D6"]       # 手前の列
AMP_PINS = ["Vin", "3Vo", "GND", "DO", "CS", "CLK"]

# ネットとつなぐピン（HARDWARE.md 2.1 の 1 本版）
XIAO_NET = {"3V3": "3V3", "GND": "GND", "D8": "SCK", "D7": "MISO", "D1": "CS", "D4": "LEDIN", "D5": "BTN"}
AMP_NET = {"Vin": "3V3", "GND": "GND", "DO": "MISO", "CS": "CS", "CLK": "SCK"}


class Layout:
    """配置。xiao=(c0,r0)、amp=(ac,ar,flip)、led=..., res=..., sw=... をあとから足す。"""
    def __init__(self, xiao, amp):
        self.xiao, self.amp = xiao, amp
        self.parts = []          # (id, kind, [(pin, pad, net)])
        self.occ = {}            # pad -> (part_id, pin, net)
        c0, r0 = xiao
        pins = []
        for i, n in enumerate(XIAO_FRONT): pins.append((n, (c0 + i, r0), XIAO_NET.get(n)))
        for i, n in enumerate(XIAO_BACK): pins.append((n, (c0 + i, r0 + XIAO_ROWGAP), XIAO_NET.get(n)))
        self.add("XIAO", "xiao", pins)
        ac, ar, flip = amp
        order = AMP_PINS[::-1] if flip else AMP_PINS      # 手前から奥へ
        self.add("AMP1", "amp", [(n, (ac, ar + i), AMP_NET.get(n)) for i, n in enumerate(order)])

    def add(self, pid, kind, pins):
        self.parts.append((pid, kind, pins))
        for pin, pad, net in pins:
            assert pad not in self.occ, (pid, pin, pad, self.occ.get(pad))
            self.occ[pad] = (pid, pin, net)

    def copy(self):
        o = Layout.__new__(Layout)
        o.xiao, o.amp = self.xiao, self.amp
        o.parts = list(self.parts); o.occ = dict(self.occ)
        o.extra = dict(getattr(self, "extra", {}))
        return o


# ---------- 部品の外形（mm、基板の左前の角が原点）----------
def xiao_rect(c0, r0):
    x0 = X(c0) - (XIAO_L - XIAO_ROWGAP * P) / 2
    y0 = Y(r0) - (XIAO_W - XIAO_ROWGAP * P) / 2
    return (x0, y0, x0 + XIAO_L, y0 + XIAO_W)

def amp_rect(ac, ar):
    x0 = X(ac) - AMP_PIN_OFF
    yc = Y(ar + 2.5)
    return (x0, yc - AMP_W / 2, x0 + AMP_L, yc + AMP_W / 2)

def rect_dist(a, b):
    dx = max(b[0] - a[2], a[0] - b[2], 0); dy = max(b[1] - a[3], a[1] - b[3], 0)
    return math.hypot(dx, dy)

def pt_rect_dist(p, r):
    dx = max(r[0] - p[0], p[0] - r[2], 0); dy = max(r[1] - p[1], p[1] - r[3], 0)
    return math.hypot(dx, dy)

def rect_ok(r, x_left_edge=EDGE):
    if r[0] < x_left_edge or r[2] > BX - EDGE or r[1] < EDGE or r[3] > BY - EDGE: return False
    for m in MOUNT:
        if pt_rect_dist(mm(m), r) < MOUNT_KEEP: return False
    return True

def pad_blocked(p):
    if not (0 <= p[0] < COLS and 0 <= p[1] < ROWS): return True
    for m in MOUNT:
        if math.hypot(X(p[0]) - X(m[0]), Y(p[1]) - Y(m[1])) < PAD_KEEP: return True
    return False

def core_candidates():
    xs = []
    for c0 in range(0, 5):
        for r0 in range(0, ROWS - XIAO_ROWGAP):
            r = xiao_rect(c0, r0)
            if rect_ok(r, 0.5): xs.append(((c0, r0), r))
    am = []
    for ac in range(6, COLS):
        for ar in range(0, ROWS - 5):
            r = amp_rect(ac, ar)
            if rect_ok(r): am.append(((ac, ar), r))
    out = []
    for (xp, xr) in xs:
        for (ap, ar_) in am:
            if rect_dist(xr, ar_) < MIN_XA: continue
            for flip in (0, 1):
                out.append((xp, (ap[0], ap[1], flip), xr, ar_))
    return out


# ---------- 配線 ----------
INF = 1e9
W_CROSS, W_ATT, W_OVER = 100.0, 5.0, 0.3

def seg_dist_pt(a, b, p):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

def seg_inter(a, b, c, d):
    """線分 ab と cd が（端点を含めて）交わるか"""
    def o(p, q, r):
        v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
        return 0 if abs(v) < 1e-9 else (1 if v > 0 else -1)
    def on(p, q, r): return min(p[0], q[0]) - 1e-9 <= r[0] <= max(p[0], q[0]) + 1e-9 and min(p[1], q[1]) - 1e-9 <= r[1] <= max(p[1], q[1]) + 1e-9
    o1, o2, o3, o4 = o(a, b, c), o(a, b, d), o(c, d, a), o(c, d, b)
    if o1 != o2 and o3 != o4: return True
    if o1 == 0 and on(a, b, c): return True
    if o2 == 0 and on(a, b, d): return True
    if o3 == 0 and on(c, d, a): return True
    if o4 == 0 and on(c, d, b): return True
    return False

def line_pads(a, b):
    """同じ行か列の a から b までの穴（両端を含む）。そうでなければ None"""
    if a[0] == b[0]:
        s = 1 if b[1] >= a[1] else -1
        return [(a[0], r) for r in range(a[1], b[1] + s, s)]
    if a[1] == b[1]:
        s = 1 if b[0] >= a[0] else -1
        return [(c, a[1]) for c in range(a[0], b[0] + s, s)]
    return None

def edge_options(lay, net, a, b):
    """パッド a と b をつなぐ線の候補: ('bare', a, b, covered) か ('ins', a, b)"""
    opts = []
    lp = line_pads(a, b)
    if lp is not None:
        ok = True; cov = []
        for p in lp[1:-1]:
            o = lay.occ.get(p)
            if o is None: continue
            if o[2] == net: cov.append(p)
            else: ok = False; break
        if ok: opts.append(("bare", a, b, tuple(cov)))
    opts.append(("ins", a, b, ()))
    return opts

def wire_len(w):
    return math.dist(mm(w[1]), mm(w[2]))

def local_cost(w):
    att = 2 + len(w[3])
    return wire_len(w) + W_ATT * att

def trees(n):
    """n 個の節点の全域木（辺の組）"""
    if n == 1: return [()]
    if n == 2: return [((0, 1),)]
    alle = list(itertools.combinations(range(n), 2))
    res = []
    for es in itertools.combinations(alle, n - 1):
        par = list(range(n))
        def f(x):
            while par[x] != x: par[x] = par[par[x]]; x = par[x]
            return x
        ok = True
        for a, b in es:
            ra, rb = f(a), f(b)
            if ra == rb: ok = False; break
            par[ra] = rb
        if ok: res.append(es)
    return res

def net_candidates(lay, net, nodes, keep=20):
    """nodes = [[候補パッド, ...], ...]（内部でつながった足は同じ節点の候補）。上位 keep 個の線の組を返す"""
    cands = []
    for reps in itertools.product(*nodes):
        for tr in trees(len(nodes)):
            lists = [edge_options(lay, net, reps[i], reps[j]) for i, j in tr]
            for ws in itertools.product(*lists):
                cands.append((sum(local_cost(w) for w in ws), ws))
    cands.sort(key=lambda t: t[0])
    return cands[:keep]

def pair_penalty(w1, w2):
    """2 本の線の関係。INF = 禁止（裸線どうしの接触）、それ以外は交差の数"""
    a, b, c, d = mm(w1[1]), mm(w1[2]), mm(w2[1]), mm(w2[2])
    if seg_inter(a, b, c, d):
        if w1[0] == "bare" and w2[0] == "bare": return INF
        return 1
    return 0

def over_count(lay, ws_net):
    pass

def route(lay, netnodes, keep=20):
    """netnodes: {net: [[pad候補...], ...]}。全体で最小の配線を返す: (cost, wires, crossings, attach, length)"""
    per = []
    for net, nodes in netnodes.items():
        c = net_candidates(lay, net, nodes, keep)
        per.append((net, c))
    per.sort(key=lambda t: len(t[1]))
    best = [INF, None]
    # 禁止ペアの前計算は遅延
    cache = {}
    def pen(w1, w2):
        k = (w1, w2)
        if k not in cache: cache[k] = pair_penalty(w1, w2)
        return cache[k]
    def over(ws, net):
        n = 0
        for w in ws:
            if w[0] != "ins": continue
            a, b = mm(w[1]), mm(w[2])
            for p, o in lay.occ.items():
                if o[2] == net: continue
                if p == w[1] or p == w[2]: continue
                if seg_dist_pt(a, b, mm(p)) < 0.6: n += 1
        return n
    ocache = {}
    def rec(i, chosen, cost):
        if cost >= best[0]: return
        if i == len(per):
            best[0] = cost; best[1] = list(chosen); return
        net, cs = per[i]
        for lc, ws in cs:
            add = lc
            bad = False
            for w in ws:
                for (_, ows) in chosen:
                    for ow in ows:
                        pp = pen(w, ow)
                        if pp >= INF: bad = True; break
                        add += W_CROSS * pp
                    if bad: break
                if bad: break
            if bad: continue
            k = (net, ws)
            if k not in ocache: ocache[k] = over(ws, net)
            add += W_OVER * ocache[k]
            chosen.append((net, ws))
            rec(i + 1, chosen, cost + add)
            chosen.pop()
    rec(0, [], 0.0)
    if best[1] is None: return None
    wires = []
    for net, ws in best[1]:
        for w in ws: wires.append((net, w))
    cr = 0
    for (n1, w1), (n2, w2) in itertools.combinations(wires, 2):
        if pair_penalty(w1, w2) == 1: cr += 1
    att = sum(2 + len(w[3]) for _, w in wires)
    ln = sum(wire_len(w) for _, w in wires)
    return (best[0], wires, cr, att, ln)

def netnodes_of(lay):
    """配置から、ネットごとの節点（つなぐ足の候補）を作る"""
    nn = {}
    for pid, kind, pins in lay.parts:
        if pid == "SW1":
            # スイッチ: 同じ側の 2 本は内部でつながっている → 1 節点（候補 2 つ）
            groups = {}
            for pin, pad, net in pins: groups.setdefault(net, []).append(pad)
            for net, pads in groups.items(): nn.setdefault(net, []).append(pads)
            continue
        for pin, pad, net in pins:
            if net: nn.setdefault(net, []).append([pad])
    return nn

def full_route(lay, keep=14):
    return route(lay, netnodes_of(lay), keep)

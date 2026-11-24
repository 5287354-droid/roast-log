#!/usr/bin/env python3
"""ユニバーサル基板に XIAO + アンプ3枚 + LED + ボタンが 2.54mm 格子で収まるかの全探索。
使い方: python3 layout_check.py   （寸法は roastlogger_case.scad と同じ仮の値。実測したら書き換える）"""
import itertools, sys
P = 2.54
AMP = (25.0, 20.0)      # 長さ x 幅（要実測）
XIAO = (21.0, 17.8)
BTN = (8.0, 8.0)        # タクトスイッチ + 指の余裕
LED = (7.0, 7.0)
MARGIN = 1.0            # 部品どうし・基板の縁との最低すき間（はんだ付けの余裕）
MOUNT_KEEP = 4.0        # 取付穴の中心から、部品を置かない半径
XA_MIN = 15.0           # XIAO とアンプの最低距離（冷接点のため。要検討）
BOARDS = {"C": (72.0, 47.0), "B": (95.0, 72.0)}

def search(bx, by):
    cols = int((bx - 2*MARGIN) // P); rows = int((by - 2*MARGIN) // P)
    # 取付穴: 四隅（格子の (1,1) 付近）
    holes = [(4.3, 4.3), (bx-4.3, 4.3), (4.3, by-4.3), (bx-4.3, by-4.3)]
    items = [("XIAO", XIAO), ("AMP1", AMP), ("AMP2", AMP), ("AMP3", AMP), ("LED", LED), ("BTN", BTN)]
    def cand(sz):
        for rot in (0, 1):
            w, h = (sz[1], sz[0]) if rot else sz
            x = MARGIN
            while x + w <= bx - MARGIN + 1e-6:
                y = MARGIN
                while y + h <= by - MARGIN + 1e-6:
                    ok = all(not (x - MOUNT_KEEP < hx < x + w + MOUNT_KEEP and y - MOUNT_KEEP < hy < y + h + MOUNT_KEEP)
                             for hx, hy in holes)
                    if ok: yield (x, y, w, h)
                    y += P
                x += P
    def overlap(a, b, gap):
        return not (a[0] + a[2] + gap <= b[0] or b[0] + b[2] + gap <= a[0] or
                    a[1] + a[3] + gap <= b[1] or b[1] + b[3] + gap <= a[1])
    def dist(a, b):
        dx = max(b[0] - (a[0]+a[2]), a[0] - (b[0]+b[2]), 0); dy = max(b[1] - (a[1]+a[3]), a[1] - (b[1]+b[3]), 0)
        return (dx*dx + dy*dy) ** .5
    cands = [list(cand(s)) for _, s in items]
    sol = []
    def rec(i):
        if i == len(items): return True
        for c in cands[i]:
            if any(overlap(c, s, MARGIN) for s in sol): continue
            if items[i][0].startswith("AMP") and dist(c, sol[0]) < XA_MIN: continue
            sol.append(c)
            if rec(i + 1): return True
            sol.pop()
        return False
    return rec(0), list(sol)

for name, (bx, by) in BOARDS.items():
    ok, sol = search(bx, by)
    print(f"{name}タイプ {bx}x{by}mm:", "収まる配置あり" if ok else "収まる配置が1つもない")
    if ok:
        for (n, _), c in zip([("XIAO",0),("AMP1",0),("AMP2",0),("AMP3",0),("LED",0),("BTN",0)], sol):
            print(f"   {n}: x={c[0]:.1f} y={c[1]:.1f} {c[2]}x{c[3]}")

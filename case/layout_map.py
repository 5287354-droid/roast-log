#!/usr/bin/env python3
"""docs/CASE.md の配置図（ASCII）を作る。表示は 1 始まり（列は左=USB 側、段は手前）。"""
C, R = 37, 28
g = [["·"]*C for _ in range(R)]
def put(c, r, ch): g[r-1][c-1] = ch
for c in range(3,11):
    for r in range(11,20): put(c, r, "▒")
for c, r in [(2,2),(36,2),(2,27),(36,27)]: put(c, r, "◎")
for i, ch in enumerate("0123456"): put(3+i, 12, ch)           # XIAO 手前列 D0..D6
put(5,18,"3"); put(4,18,"G"); put(3,18,"5"); put(6,18,"x"); put(7,18,"x"); put(8,18,"S"); put(9,18,"M")
for r in range(2, 27):                                         # バス
    put(17, r, "│"); put(18, r, "│"); put(19, r, "│"); put(20, r, "│")
for rb in (3, 12, 21):
    for k, ch in enumerate("VoGDCK"): put(22, rb+k, ch)
    for c in range(23, 33):
        for r in range(rb-1, rb+7): put(c, r, "░")
    put(32, rb+2, "T"); put(32, rb+3, "T")
put(7,10,"R"); put(7,6,"R"); put(9,6,"L"); put(10,6,"l")
put(13,5,"B"); put(15,5,"b"); put(13,7,"A"); put(15,7,"b")
print("     " + "".join(str(c//10) if c % 10 == 0 or c == 1 else " " for c in range(1, C+1)))
print("     " + "".join(str(c%10) for c in range(1, C+1)))
for r in range(R, 0, -1):
    print(f"{r:3d}  " + "".join(g[r-1]))

#!/usr/bin/env python3
"""1 本用ケースの STL の確認: 閉じた形状（watertight）、部品との干渉（体積）、外寸、サポートが要る面。
使い方: python3 check_1ch.py   （基板 7050 と akizukiC の両方を確かめる）
旧: python3 check_1ch.py   （openscad と trimesh が必要。build_1ch.sh のあとに実行）"""
import os, subprocess, sys, tempfile
import numpy as np, trimesh
HERE = os.path.dirname(os.path.abspath(__file__))
SCAD = os.path.join(HERE, "roastlogger_case_1ch.scad")
ok = True
def fail(msg):
    global ok; ok = False; print("NG:", msg)

for BD, SUB in (("7050", ()), ("akizukiC", ("akizukiC",))):
    for n in ("body", "lid", "button"):
        m = trimesh.load(os.path.join(HERE, "stl", "1ch", *SUB, n + ".stl"))
        b = m.bounds
        print(f"[{BD}] {n}: 閉じた形状={m.is_watertight} 体積={m.volume/1000:.1f}cm3 外寸={b[1][0]-b[0][0]:.1f} x {b[1][1]-b[0][1]:.1f} x {b[1][2]-b[0][2]:.1f} mm 面={len(m.faces)}")
        if not m.is_watertight or not m.is_winding_consistent or m.volume <= 0: fail(BD + " " + n + " が閉じた形状でない")

    tmp = tempfile.mkdtemp()
    for p, what in (("interf", "ケース（本体・ふた・押し棒）と基板・部品"), ("interf_ant", "ふた・押し棒とアンテナ"), ("interf_inner", "ふたと本体・押し棒")):
        f = os.path.join(tmp, p + ".stl")
        r = subprocess.run(["openscad", "-D", f'part="{p}"', "-D", f'board="{BD}"', "-o", f, SCAD], capture_output=True, text=True)
        if "empty" in r.stderr.lower() and p != "interf_inner":
            vol = 0.0; print(f"[{BD}] 干渉 {p}（{what}）: 空（干渉なし）")
        else:
            m = trimesh.load(f)
            # 面で接するだけ（体積 0）のものは干渉ではない。体積が 0.001mm3 を超えたら干渉
            vol = abs(m.volume) if len(m.faces) else 0.0
            print(f"[{BD}] 干渉 {p}（{what}）: 体積 {vol:.4f} mm3")
        if vol > 1e-3: fail(f"{BD} {p} に干渉 {vol} mm3")

    # サポートなしで印刷できるか: 下を向く面のうち、水平から 45 度より寝ている面（かぶさりが大きい面）を数える
    for n, up in (("body", True), ("lid", True), ("button", True)):
        m = trimesh.load(os.path.join(HERE, "stl", "1ch", *SUB, n + ".stl"))
        nz = m.face_normals[:, 2]
        z = m.triangles_center[:, 2]
        bad = (nz < -0.7072) & (z > m.bounds[0][2] + 0.01)      # 下向きで 45 度より急でない(=水平に近い)面。いちばん下の面は除く
        area = m.area_faces[bad].sum()
        print(f"[{BD}] {n}: 45 度より水平に近い下向きの面（橋・サポートが要る可能性）面積 {area:.1f} mm2", end="")
        if bad.any():
            zs = np.unique(np.round(z[bad], 1))
            print(f"、高さ z = {', '.join(str(v) for v in zs[:8])}")
        else: print()

print("OK" if ok else "NG があります")
sys.exit(0 if ok else 1)

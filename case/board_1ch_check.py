#!/usr/bin/env python3
"""board_1ch_7050.json（実物の基板）と、前の board_1ch.json / board_1ch_amp_reversed.json（秋月 C タイプの仮定）の配線を、docs/HARDWARE.md 2.1 の配線表（アンプ #1 の列）と突き合わせる。
さらに、JSON の中身が物理的に成り立つか（裸線がほかのネットに触れない、穴が重ならない…）と、
roastlogger_case_1ch.scad の先頭の値が JSON の配置と同じかを確かめる。
使い方: python3 board_1ch_check.py   （問題があれば NG を出して終了コード 1）"""
import json, os, re, sys, itertools
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import board_1ch_lib as L
from board_1ch_lib import parse, name, mm, pad_blocked, XIAO_BACK, XIAO_FRONT, AMP_PINS, seg_inter
errors = []
def ng(m): errors.append(m); print("NG:", m)

# ---------- HARDWARE.md 2.1 の表を読む ----------
hw = open(os.path.join(ROOT, "docs", "HARDWARE.md"), encoding="utf-8").read()
sec = hw.split("### 2.1 配線表")[1].split("###")[0]
expected_pairs = {}      # XIAO のピン -> アンプ #1 のピン
text_rows = {}
for line in sec.splitlines():
    if not line.startswith("|") or "---" in line: continue
    cols = [c.strip().strip("*").strip() for c in line.strip().strip("|").split("|")]
    if len(cols) < 4 or cols[0].startswith("XIAO"): continue
    xp, amp1 = re.match(r"[A-Za-z0-9]+", cols[0]).group(0), cols[3]
    amp1c = amp1.replace("*", "").strip()
    if amp1c in AMP_PINS: expected_pairs[xp] = amp1c
    elif amp1c not in ("—", ""): text_rows[xp] = amp1c
need = {"3V3": "Vin", "GND": "GND", "D8": "CLK", "D7": "DO", "D1": "CS"}
if expected_pairs != need: ng(f"HARDWARE.md の表から読んだ配線 {expected_pairs} が想定 {need} と違う（表が変わった？）")
if not ("LED" in text_rows.get("D4", "") and "330" in text_rows.get("D4", "") and "GND" in text_rows.get("D4", "")): ng("HARDWARE.md の D4 の行が LED + 330Ω → GND でない: " + text_rows.get("D4", ""))
if not ("ボタン" in text_rows.get("D5", "") and "GND" in text_rows.get("D5", "")): ng("HARDWARE.md の D5 の行が ボタン → GND でない: " + text_rows.get("D5", ""))
if "3Vo は何もつなぎません" not in sec and "3Vo** は何もつなぎません" not in sec and "3Vo は何も" not in sec.replace("**", ""): ng("HARDWARE.md に 3Vo をつながない記述が見つからない")
if "D9 には何もつなぎません" not in sec: ng("HARDWARE.md に D9 をつながない記述が見つからない")
print("HARDWARE.md 2.1 の表（アンプ #1）:", expected_pairs, "| D4:", text_rows.get("D4"), "| D5:", text_rows.get("D5"))

# 期待する電気的なつながり（グループ）
exp_groups = [{f"XIAO.{x}", f"AMP1.{a}"} for x, a in expected_pairs.items() if x != "GND"]
exp_groups.append({"XIAO.GND", "AMP1.GND", "LED1.cathode", "SW1.b1", "SW1.b2"})   # LED の短い足 → GND、スイッチのもう片方 → GND
exp_groups.append({"XIAO.D4", "R1.a"})            # D4 → 330Ω
exp_groups.append({"R1.b", "LED1.anode"})         # 330Ω → LED の長い足
exp_groups.append({"XIAO.D5", "SW1.a1", "SW1.a2"})  # D5 → スイッチ

def check(fn):
    d = json.load(open(os.path.join(HERE, fn), encoding="utf-8"))
    tag = fn
    key = d["board"].get("key", "akizukiC")
    L.configure(key)          # 基板の種類（穴の数・取付穴）をこの JSON に合わせる
    COLS, ROWS = L.COLS, L.ROWS
    if (d["board"]["cols"], d["board"]["rows"], d["board"]["size_mm"]) != (COLS, ROWS, [L.BX, L.BY]): ng(f"{tag}: 基板の穴数・外形が lib の {key} と違う")
    holes = {}; pinhole = {}
    nets = {}
    for p in d["parts"]:
        for q in p["pins"]:
            h = q["hole"]
            if h in holes: ng(f"{tag}: 穴 {h} に足が 2 本ある（{holes[h]} と {p['id']}.{q['pin']}）")
            holes[h] = f"{p['id']}.{q['pin']}"; pinhole[f"{p['id']}.{q['pin']}"] = h
            c, r = parse(h)
            if not (0 <= c < COLS and 0 <= r < ROWS): ng(f"{tag}: {h} が基板の外")
            if pad_blocked((c, r)): ng(f"{tag}: {h} は取付穴のそば（柱）で使えない")
            nets[f"{p['id']}.{q['pin']}"] = q["net"]
    # XIAO / アンプのピン並び
    xi = {q["pin"]: parse(q["hole"]) for q in next(p for p in d["parts"] if p["id"] == "XIAO")["pins"]}
    c0, r0 = xi["D0"]
    for i, n in enumerate(XIAO_FRONT):
        if xi[n] != (c0 + i, r0): ng(f"{tag}: XIAO の {n} の穴が手前の列の並びと違う")
    for i, n in enumerate(XIAO_BACK):
        if xi[n] != (c0 + i, r0 + 6): ng(f"{tag}: XIAO の {n} の穴が奥の列の並びと違う")
    am = {q["pin"]: parse(q["hole"]) for q in next(p for p in d["parts"] if p["id"] == "AMP1")["pins"]}
    ac = am["Vin"][0]; order = sorted(am, key=lambda k: am[k][1])
    want = AMP_PINS[::-1] if d["amp_reversed_variant"] else AMP_PINS
    if order != want or any(am[k][0] != ac for k in am): ng(f"{tag}: アンプのピン並び {order} が想定 {want} と違う")
    # 配線 → つながりのグラフ
    par = {k: k for k in pinhole}
    def f(x):
        while par[x] != x: par[x] = par[par[x]]; x = par[x]
        return x
    def un(a, b): par[f(a)] = f(b)
    hole2pin = {h: k for k, h in pinhole.items()}
    ends_ok = True
    for w in d["wires"]:
        a, b = w["from_hole"], w["to_hole"]
        pa, pb = hole2pin.get(a), hole2pin.get(b)
        if not pa or not pb: ng(f"{tag}: 線 {w['id']} の端 {a}/{b} に足がない"); continue
        if w["kind"] == "bare":
            ca, cb = parse(a), parse(b)
            if ca[0] != cb[0] and ca[1] != cb[1]: ng(f"{tag}: 裸線 {w['id']} がまっすぐ（同じ行か列）でない")
            from board_1ch_lib import line_pads
            path = [name(p) for p in line_pads(ca, cb)]
            if sorted(path) != sorted(w["touches_holes"]): ng(f"{tag}: 裸線 {w['id']} の touches_holes が経路と違う")
            touched = [hole2pin[h] for h in path if h in hole2pin]
            for t in touched: un(touched[0], t)
        else:
            if w["touches_holes"] != [a, b]: ng(f"{tag}: 被覆線 {w['id']} の touches_holes が端の 2 つでない")
            un(pa, pb)
    for pre in ("a", "b"):                      # スイッチの内部（同じ側の 2 本はつながっている）
        un(f"SW1.{pre}1", f"SW1.{pre}2")
    groups = {}
    for k in pinhole: groups.setdefault(f(k), set()).add(k)
    got = [g for g in groups.values() if len(g) > 1]
    for g in exp_groups:
        if g not in got: ng(f"{tag}: 期待するつながり {sorted(g)} が JSON の配線にない（実際: {[sorted(x) for x in got if x & g]}）")
    for g in got:
        if g not in exp_groups: ng(f"{tag}: 余計なつながり {sorted(g)}")
    # つながない足（5V, D9, 3Vo など）が孤立しているか
    for k in ("XIAO.5V", "XIAO.D9", "XIAO.D10", "XIAO.D0", "XIAO.D2", "XIAO.D3", "XIAO.D6", "AMP1.3Vo"):
        if len(groups[f(k)]) != 1: ng(f"{tag}: {k} に何かがつながっている: {sorted(groups[f(k)])}")
    # ネット名の整合（JSON の net 欄と、配線で実際につながったもの）
    for g in got:
        ns = {nets[k] for k in g if nets[k]}
        if k and len(ns) > 1 and not ({"LEDIN", "LEDA"} >= ns): ng(f"{tag}: ネット名が混ざる {g} {ns}")
    # 裸線: ほかのネットの足の穴の上を通らない、裸線どうしは交わらない
    bare = [w for w in d["wires"] if w["kind"] == "bare"]
    for w in bare:
        for h in w["touches_holes"]:
            pin = hole2pin.get(h)
            if pin and f(pin) != f(hole2pin[w["from_hole"]]): ng(f"{tag}: 裸線 {w['id']} が別ネットの穴 {h}（{pin}）に触れる")
    for w1, w2 in itertools.combinations(bare, 2):
        if seg_inter(mm(parse(w1["from_hole"])), mm(parse(w1["to_hole"])), mm(parse(w2["from_hole"])), mm(parse(w2["to_hole"]))):
            ng(f"{tag}: 裸線 {w1['id']} と {w2['id']} が交わる")
    # 点数の整合
    cnt = d["counts"]
    parts_pins = sum(len(p["pins"]) for p in d["parts"])
    if cnt["part_lead_solder_points"] != parts_pins: ng(f"{tag}: 部品の足の数 {parts_pins} と点数 {cnt['part_lead_solder_points']} が違う")
    if cnt["total_solder_points"] != len(d["solder_points"]): ng(f"{tag}: はんだ付けの点数が合わない")
    # 取付穴: JSON の位置が lib と同じ
    if "blocked_holes" in d["board"]:
        mh = [(m["x_mm"], round(L.BY - m["y_from_top_mm"], 2)) for m in d["board"]["mount_holes"]]
        if sorted(mh) != sorted((round(x, 2), round(y, 2)) for x, y in L.MOUNT_MM): ng(f"{tag}: 取付穴の位置が lib と違う")
        if sorted(d["board"]["blocked_holes"]) != sorted(name((c, r)) for c in range(COLS) for r in range(ROWS) if pad_blocked((c, r))):
            ng(f"{tag}: blocked_holes が lib と違う")
    # scad の値と同じか（配置の並びは layout_<board> に書いてある。向きが実物に合う「逆」の配置だけが scad に入る）
    scad = open(os.path.join(HERE, "roastlogger_case_1ch.scad"), encoding="utf-8").read()
    cp = d["case_params"]
    if d["amp_reversed_variant"]:
        m = re.search(r"^layout_%s\s*=\s*\[([^\]]*)\]\s*;" % key, scad, re.M)
        vec = [int(v) for v in m.group(1).split(",")] if m else None
        names = ["xiao_c0", "xiao_r0", "amp_c", "amp_r", "led_c", "led_r", "led_dc", "led_dr", "sw_c", "sw_r", "sw_horiz", "res_c", "res_r", "res_span"]
        if vec is None: ng(f"{tag}: scad に layout_{key} がない")
        else:
            for k, v in zip(names, vec):
                if cp[k] != v: ng(f"{tag}: scad の layout_{key} の {k}={v} が JSON の {cp[k]} と違う")
        def sv(n):
            mm_ = re.search(r"^%s\s*=\s*(.*?);" % n, scad, re.M | re.S); return re.sub(r"\s+", " ", mm_.group(1)) if mm_ else ""
        if key == "7050":
            if not sv("board_x").startswith('board == "7050" ? 70 '): ng(f"{tag}: scad の board_x が 70 でない")
            if not sv("board_y").startswith('board == "7050" ? 50 '): ng(f"{tag}: scad の board_y が 50 でない")
            if not sv("grid_cols").startswith('board == "7050" ? 24 '): ng(f"{tag}: scad の grid_cols が 24 でない")
            if not sv("mount_off").startswith('board == "7050" ? [2.5, 2.5]'): ng(f"{tag}: scad の mount_off が [2.5, 2.5] でない")
            if re.search(r'^board\s*=\s*"7050"\s*;', scad, re.M) is None: ng(f"{tag}: scad の既定の board が 7050 でない")
        if sv("amp_flip") != "1": ng(f"{tag}: scad の amp_flip が 1 でない")
    print(f"{tag}: 配線 {len(d['wires'])} 本（裸線 {len(bare)}、被覆線 {len(d['wires'])-len(bare)}）、はんだ付け {cnt['total_solder_points']} 点、"
          f"交差 {cnt['crossings']}、期待するつながり {len(exp_groups)} 組すべて一致" if not errors else f"{tag}: NG あり")

for fn in ("board_1ch_7050.json", "board_1ch.json", "board_1ch_amp_reversed.json"):
    check(fn)
print("OK（HARDWARE.md の配線と一致）" if not errors else f"NG {len(errors)} 件")
sys.exit(1 if errors else 0)

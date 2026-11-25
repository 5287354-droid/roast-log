#!/usr/bin/env python3
"""選んだ配置から、機械が読める配置データ（board_1ch.json）を作る。
使い方: python3 board_1ch_make.py [--flip 0|1] [--xiao C,R --amp C,R] [--ascii]
  何も指定しなければ、アンプの向き「通常」（手前から Vin, 3Vo, GND, DO, CS, CLK）で、
  XIAO を USB 側の壁にいちばん寄せた（列 B）置き方の中で、評価がいちばん小さい配置を選ぶ。
  --flip 1 は、アンプの実物のピン並びが逆だったとき用の配置（board_1ch_amp_reversed.json）。
"""
import sys, os, json, math, itertools
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from board_1ch_lib import *
from board_1ch_search import stage2

NET_COLOR = {"3V3": "赤", "GND": "黒", "SCK": "黄", "MISO": "緑", "CS": "青", "LEDIN": "橙", "LEDA": "橙", "BTN": "白"}
NET_NOTE = {"3V3": "電源 3.3V", "GND": "0V", "SCK": "クロック（GPIO8）", "MISO": "データ（GPIO20。D9 ではない）",
            "CS": "チップ選択 チャンネル1（GPIO3 = D1）", "LEDIN": "D4（GPIO6）から抵抗へ", "LEDA": "抵抗から LED の長い足へ",
            "BTN": "D5（GPIO7）からスイッチへ"}


def pick(flip, xiao=None, amp=None):
    cs = core_candidates()
    best = None
    for xp, ap, xr, ar_ in cs:
        if ap[2] != flip: continue
        if xiao and xp != xiao: continue
        if amp and ap[:2] != amp: continue
        if not xiao and xp[0] != 1: continue
        r = stage2((xp, ap, xr, ar_))
        if r is None: continue
        key = (round(r[0], 3), ap[1])
        if best is None or key < best[0]: best = (key, r, xr, ar_)
    return best


def hole_obj(p):
    x, y = mm(p)
    return {"name": name(p), "col": p[0], "row_from_front": p[1], "x_mm": round(x, 2), "y_from_top_mm": round(BY - y, 2),
            "view_front": {"col_letter": col_letter(p[0]), "row_number": ROWS - p[1]},
            "back_view_col_letter": col_letter(COLS - 1 - p[0])}


def build(flip, xiao=None, amp=None):
    key, r, xr, ar_ = pick(flip, xiao, amp)
    cost, xp, ap, lay, res = r
    _, wires, cr, att, ln = res
    ex = lay.extra
    # --- ネット: 足の一覧 ---
    nets = {}
    for pid, kind, pins in lay.parts:
        for pin, pad, net in pins:
            if net: nets.setdefault(net, []).append(f"{pid}.{pin}")
    # --- 部品 ---
    parts = []
    meta = {
        "XIAO": dict(label="Seeed XIAO ESP32C3（ピンヘッダ付き、ピン下向き）", socket="丸ピンソケット 1×7 ×2（メス。基板にはんだ付けし、XIAO を上から差す）",
                     orientation="USB-C が左（基板の左の端の側）、部品面が上。奥の列が左から 5V, GND, 3V3, D10, D9, D8, D7、手前の列が左から D0〜D6"),
        "AMP1": dict(label="Adafruit MAX31855 #269（ピンヘッダがはんだ付け済み、ピン下向き）", socket="丸ピンソケット 1×6（メス）",
                     orientation=("ネジ端子が右（基板の右の端の側）、手前から奥へ " + ", ".join(AMP_PINS[::-1] if flip else AMP_PINS) + "。実物のシルクで確かめる")),
        "R1": dict(label="抵抗 330Ω（1/4W）", socket="なし（足を直接はんだ付け）", orientation="寝かせて差す（足の間 %d 穴）" % ex.get("res_span", 4) if ex.get("res_span", 4) > 1 else "立てて差す（となりの穴どうし）"),
        "LED1": dict(label="LED（3mm か 5mm）", socket="なし（足を直接はんだ付け）", orientation="長い足（アノード）= anode の穴、短い足 = cathode の穴"),
        "SW1": dict(label="タクトスイッチ 6mm 角（4 本足）", socket="なし（足を直接はんだ付け）",
                    orientation="同じ側の 2 本の足は、常につながっている。押すと、向かい側とつながる。テスターで確かめてから、同じ側の 2 本を同じ組の穴（a1,a2 / b1,b2）に差す"),
    }
    sp_id = 0
    solder = []
    for pid, kind, pins in lay.parts:
        plist = []
        for pin, pad, net in pins:
            sp_id += 1
            sid = f"P{sp_id:02d}"
            plist.append({"pin": pin, "hole": name(pad), "net": net, "solder_point": sid, "connected": bool(net)})
            solder.append({"id": sid, "type": "part_lead", "hole": name(pad), "part": pid, "pin": pin, "net": net,
                           "note": "ソケットのピン" if kind in ("xiao", "amp") else "部品の足（基板の裏で切る。1.5mm 以下）"})
        parts.append({"id": pid, "kind": kind, **meta[pid], "pins": plist})
    # 部品の外形（表から見た図の描画用。左上が原点、mm）
    def rect_obj(rc):
        return {"x0": round(rc[0], 2), "x1": round(rc[2], 2), "y0_from_top": round(BY - rc[3], 2), "y1_from_top": round(BY - rc[1], 2)}
    for p in parts:
        if p["id"] == "XIAO": p["outline_mm"] = rect_obj(xr); p["usb_side"] = "left"
        if p["id"] == "AMP1": p["outline_mm"] = rect_obj(ar_); p["terminal_side"] = "right"; p["pin_order_front_to_back"] = AMP_PINS[::-1] if flip else AMP_PINS
        if p["id"] == "LED1":
            c = ex["led_centre"]; p["centre_mm"] = {"x": round(c[0], 2), "y_from_top": round(BY - c[1], 2)}
        if p["id"] == "SW1":
            c = ex["sw_centre"]; p["centre_mm"] = {"x": round(c[0], 2), "y_from_top": round(BY - c[1], 2)}
            p["long_side"] = "horizontal" if ex["sw_horiz"] else "vertical"
            p["hole_spacing"] = "3 穴 × 2 穴（足の間 7.62mm × 5.08mm。足を少し広げて差す）"
    # --- 線 ---
    # 線ごとの交差
    ws = [(n, w) for n, w in wires]
    cross = {i: [] for i in range(len(ws))}
    for i, j in itertools.combinations(range(len(ws)), 2):
        if pair_penalty(ws[i][1], ws[j][1]) == 1: cross[i].append(j); cross[j].append(i)
    wlist = []
    for i, (net, w) in enumerate(ws):
        wid = f"W{i+1:02d}"
        covered = line_pads(w[1], w[2]) if w[0] == "bare" else [w[1], w[2]]
        solder_h = [w[1]] + list(w[3]) + [w[2]]      # はんだ付けするのは、両端と、途中にある同じネットの足の穴
        L = wire_len(w)
        d = {"id": wid, "net": net, "purpose": NET_NOTE[net], "kind": "bare" if w[0] == "bare" else "insulated",
             "wire": "スズメッキ線（裸線）0.5mm、裏の穴の上をまっすぐ張る" if w[0] == "bare" else "被覆線（AWG26〜30）。裏で、穴と穴のあいだを直線でわたす（部品の足や他の線にふれない）",
             "color": "銀（スズメッキ）" if w[0] == "bare" else NET_COLOR[net],
             "from_hole": name(w[1]), "to_hole": name(w[2]), "touches_holes": [name(c) for c in covered],
             "solder_holes": [name(c) for c in solder_h],
             "length_mm": round(L, 1), "cut_length_mm": round(L + (6 if w[0] == "bare" else 10), 0),
             "side": "back", "crosses": [f"W{j+1:02d}" for j in cross[i]],
             "passes_near_holes": ([name(p) for p, o in lay.occ.items() if o[2] != net and p not in (w[1], w[2]) and seg_dist_pt(mm(w[1]), mm(w[2]), mm(p)) < 1.2]
                                   if w[0] == "ins" else [])}
        wlist.append(d)
    wsolder = 0
    for d in wlist:
        for h in d["solder_holes"]:
            wsolder += 1
            sid = f"W{wsolder:02d}e" if False else f"E{wsolder:02d}"
            shared = any(s["hole"] == h and s["type"] == "part_lead" for s in solder)
            solder.append({"id": sid, "type": "wire_end" if h in (d["from_hole"], d["to_hole"]) else "wire_touch", "hole": h, "wire": d["id"], "net": d["net"],
                           "shares_pad_with_part_lead": shared,
                           "note": "同じ穴のはんだに、線の端を重ねてはんだ付けする" if shared else "この穴は、線の端だけ（部品は差さない）"})
    # --- ステップ（はんだ付けの順の提案）---
    order = [
        {"step": 1, "what": "抵抗 R1 を差して、裏で足をはんだ付け・切る", "solder_points": [s["id"] for s in solder if s["part"] == "R1"] if False else [s["id"] for s in solder if s.get("part") == "R1"]},
        {"step": 2, "what": "タクトスイッチ SW1", "solder_points": [s["id"] for s in solder if s.get("part") == "SW1"]},
        {"step": 3, "what": "丸ピンソケット 1×7 ×2（XIAO 用）。XIAO を仮に差して位置を決めてから", "solder_points": [s["id"] for s in solder if s.get("part") == "XIAO"]},
        {"step": 4, "what": "丸ピンソケット 1×6（アンプ用）", "solder_points": [s["id"] for s in solder if s.get("part") == "AMP1"]},
        {"step": 5, "what": "LED1（長い足 = アノード）", "solder_points": [s["id"] for s in solder if s.get("part") == "LED1"]},
        {"step": 6, "what": "裸線（スズメッキ線）の配線", "wires": [d["id"] for d in wlist if d["kind"] == "bare"]},
        {"step": 7, "what": "被覆線の配線。交差の少ない線から先に、交差する側の線をあとに", "wires": [d["id"] for d in wlist if d["kind"] == "insulated"]},
        {"step": 8, "what": "テスターで導通・ショートを確認（HARDWARE.md 2.4）"},
    ]
    # --- 使わない穴 ---
    unused = [f"{p['id']}.{q['pin']}" for p in parts for q in p["pins"] if not q["connected"]]
    out = {
        "schema": "roastlog-board-1ch/1",
        "title": "焙煎ロガー 熱電対1本用 基板（秋月 C タイプ）の配置と配線",
        "generated_by": "case/board_1ch_make.py（全探索は case/board_1ch_search.py）",
        "amp_pin_order_assumption": ("アンプのネジ端子を右に向けたとき、手前から奥へ " + " → ".join(AMP_PINS[::-1] if flip else AMP_PINS) +
                                     "。実物で確かめること。逆なら board_1ch_amp_reversed.json（アンプの向きを変えた配置）を使う"),
        "amp_reversed_variant": bool(flip),
        "board": {"type": "秋月電子 ユニバーサル基板 C タイプ（片面・2.54mm ピッチ）", "size_mm": [BX, BY], "cols": COLS, "rows": ROWS, "pitch_mm": P,
                  "measure_required": True, "first_hole_mm": {"x": round(GX0, 2), "y_from_top": round(GY0, 2)},
                  "mount_holes": [hole_obj(m) for m in MOUNT], "mount_hole_note": "取付穴は格子の穴の位置と仮定（要実測）。取付穴の周り 3.7mm 以内の穴は使わない（ケースの柱がある）"},
        "coordinates": {
            "view": "表（部品を差す面）を上から見た図。USB-C が左、基板の左上の穴が A1",
            "naming": "穴の名前 = 列の英字 + 行の番号。列は左から A, B, C, …, AB（28 列）。行は上（奥）から 1, 2, …, 18",
            "front_row_note": "case/roastlogger_case_1ch.scad の r（手前から 0 始まり）= 18 - 行番号。c（左から 0 始まり）= 列の英字の番号（A=0）",
            "mirror_rule": ("裏（はんだ面）から見るときは、基板を本のページのように縦の軸でひっくり返す。左右が反転する: "
                            "表の列 i（A=0）は、裏から見ると左から数えて (27 - i) 番目。行は上下とも変わらない。"
                            "例: 表の A1（左上）は、裏では右上。表の AB18（右下）は、裏では左下。表の E8 は、裏では左から 23 番目（X）の行 8。"
                            "mm で言えば、裏から見た x = 基板の幅 72 - 表の x。JSON の座標はすべて「表から見た座標」"),
            "back_view_x_formula": "x_back_mm = 72 - x_mm; col_back_index = 27 - col_index",
        },
        "parts": parts,
        "nets": nets,
        "unused_pins_do_not_connect": unused,
        "wires": wlist,
        "solder_points": solder,
        "counts": {"part_lead_solder_points": sum(1 for s in solder if s["type"] == "part_lead"),
                   "wire_end_solder_points": sum(1 for s in solder if s["type"] != "part_lead"),
                   "total_solder_points": len(solder),
                   "wires_bare": sum(1 for d in wlist if d["kind"] == "bare"), "wires_insulated": sum(1 for d in wlist if d["kind"] == "insulated"),
                   "wire_length_total_mm": round(sum(d["length_mm"] for d in wlist), 1),
                   "crossings": cr},
        "ascii_front_view": ascii_map(lay, wires).split("\n"),
        "ascii_legend": "x=XIAO のソケット穴, a=アンプのソケット穴, R=抵抗の足, L=LED の足, S=スイッチの足, ◎=取付穴（A..Z の次の 2 列は AA, AB）",
        "assembly_order": order,
        "case_params": {  # scad の先頭に書いてある値（board_1ch_check.py が突き合わせる）
            "xiao_c0": xp[0], "xiao_r0": xp[1], "amp_c": ap[0], "amp_r": ap[1], "amp_flip": ap[2],
            "led_c": [p for p in lay.occ if lay.occ[p][1] == "anode"][0][0], "led_r": [p for p in lay.occ if lay.occ[p][1] == "anode"][0][1],
            "led_dc": [p for p in lay.occ if lay.occ[p][1] == "cathode"][0][0] - [p for p in lay.occ if lay.occ[p][1] == "anode"][0][0],
            "led_dr": [p for p in lay.occ if lay.occ[p][1] == "cathode"][0][1] - [p for p in lay.occ if lay.occ[p][1] == "anode"][0][1],
            "sw_c": min(p[0] for p, o in lay.occ.items() if o[0] == "SW1"), "sw_r": min(p[1] for p, o in lay.occ.items() if o[0] == "SW1"),
            "sw_horiz": 1 if ex["sw_horiz"] else 0,
            "res_c": min(p[0] for p, o in lay.occ.items() if o[0] == "R1"), "res_r": min(p[1] for p, o in lay.occ.items() if o[0] == "R1"),
            "res_span": max(p[0] - q[0] + p[1] - q[1] for p, o in lay.occ.items() if o[0] == "R1" for q, o2 in lay.occ.items() if o2[0] == "R1")},
        "search": {"cost": round(cost, 1), "weights": {"crossing": W_CROSS, "wire_end": W_ATT, "per_mm": 1.0, "over_other_net_joint": W_OVER},
                   "note": "評価 = 100×交差 + 5×線の端 + 線の長さ(mm) + 0.3×他のネットのはんだの上を通る数。小さいほどよい"},
        "notes": [
            "5V・D0・D2・D3・D6・D9・D10 と、アンプの 3Vo には何もつながない（ソケットのピンははんだ付けするが、線はつながない）。",
            "D9 には何もつながない（BOOT ボタンと同じ線）。MISO は D7。",
            "裸線は、同じネットの穴だけを通す。ほかのネットの穴の上を通る裸線は、ショートする。",
            "被覆線は交差してよい。ただし裸線の上を通すときは、被覆がやぶれていないことを確かめる。",
            "passes_near_holes: 被覆線が、ほかのネットの穴のはんだの 1.2mm 以内を通る所。被覆がやぶれていなければ問題ないが、そこだけ線を少し浮かせて通すと安心。",
            "10kΩ のプルアップは付けない（任意の部品。付けるなら CS のあいだに入れる）。",
        ],
    }
    return out, lay, wires


def ascii_map(lay, wires):
    g = [['·'] * COLS for _ in range(ROWS)]
    sym = {"XIAO": "x", "AMP1": "a", "R1": "R", "LED1": "L", "SW1": "S"}
    for p, o in lay.occ.items(): g[ROWS - 1 - p[1]][p[0]] = sym[o[0]]
    for m in MOUNT: g[ROWS - 1 - m[1]][m[0]] = "◎"
    lines = ["    " + "".join(chr(65 + i) if i < 26 else "+-"[i-26] for i in range(COLS))]
    for i, row in enumerate(g): lines.append(f"{i+1:2d}  " + "".join(row))
    return "\n".join(lines)


if __name__ == "__main__":
    a = sys.argv
    flip = int(a[a.index("--flip") + 1]) if "--flip" in a else 0
    xiao = tuple(int(v) for v in a[a.index("--xiao") + 1].split(",")) if "--xiao" in a else None
    amp = tuple(int(v) for v in a[a.index("--amp") + 1].split(",")) if "--amp" in a else None
    out, lay, wires = build(flip, xiao, amp)
    fn = os.path.join(HERE, "board_1ch_amp_reversed.json" if flip else "board_1ch.json")
    with open(fn, "w") as f: json.dump(out, f, ensure_ascii=False, indent=1)
    print("書き出し:", fn)
    print(json.dumps({"counts": out["counts"], "case_params": out["case_params"], "search": out["search"]}, ensure_ascii=False))
    if "--ascii" in a: print(ascii_map(lay, wires))

// 焙煎ロガー ケース【熱電対 1 本用】（実物の基板 70×50mm・24×18 穴 + XIAO ESP32C3 + MAX31855 ×1）
// 3 本用（roastlogger_case.scad）はそのまま残してある。これは別ファイル・別パラメータ。
// 印刷: Bambu Lab A1 / PETG / ノズル 0.4mm / サポートなし
// 使い方: part を切り替えて書き出す（case/build_1ch.sh が全部やる）
//   openscad -D 'part="body"' -o stl/1ch/body.stl roastlogger_case_1ch.scad
//   part = "body" | "lid" | "button" | "assembly" | "assembly_open" | "assembly_cut"
//   基板の種類: -D 'board="akizukiC"'（前に仮定した秋月 C タイプ 72×47 / 28×18 穴）で切り替える。既定は 7050（実物）
// 座標: ケース内側の左前の角が (0,0)。X = 長辺（左端が USB-C 側）、Y = 短辺、Z = 上。
// 基板の穴は (列, 段) = (c, r)。0 始まり。c は左(USB 側)から、r は手前から。
// 穴の名前（A1 など）との対応: c = 列の英字（A=0）、r = 18 - 行番号。docs/CASE.md と board_1ch_7050.json を参照。
// 電池の場所は、小さくするため今回は省いた（3 本用にはある）。

part = "assembly";
board = "7050";     // "7050" = ユーザーが買った実物（70×50mm, 24×18 穴, 取付穴は各辺から約 2.5mm）| "akizukiC" = 前に仮定した 72×47mm, 28×18 穴

// =====================================================================
// 実測して書き換える値。数字は公表値または仮の値。全部 [要実測]。単位は mm。
// 配置の列・段は board_1ch.json の case_params と同じ（case/board_1ch_check.py が突き合わせる）
// =====================================================================

// ---- ユニバーサル基板（片面。ランドは裏だけ。部品は表から挿して裏ではんだ付け）----
//   7050 のうち、全部 [要実測]: 外形、穴の数（数える）、最初の穴までの距離（格子が中央にあると仮定）、取付穴の位置と直径
board_x   = board == "7050" ? 70 : 72;     // [要実測] 基板の長辺
board_y   = board == "7050" ? 50 : 47;     // [要実測] 基板の短辺
board_t   = 1.6;    // [要実測] 基板の厚さ
pitch     = 2.54;   // 穴のピッチ
grid_cols = board == "7050" ? 24 : 28;     // [要実測] 長辺方向の穴の数（数える）
grid_rows = 18;     // [要実測] 短辺方向の穴の数（数える）
// 取付穴の中心の位置: 基板の左・手前の辺から (x, y)。右・奥は、反対側の辺から同じ距離
//   7050: 各辺から約 2.5mm [要実測]。akizukiC: 格子の B2 の穴（仮定）
mount_off = board == "7050" ? [2.5, 2.5]
          : [(72 - 27*2.54)/2 + 2.54, (47 - 17*2.54)/2 + 2.54];
mount_d   = board == "7050" ? 3.0 : 3.2;   // [要実測] 取付穴の直径（7050 は仮に 3.0）
// 取付ねじ（セルフタップ）: 2 = M2、2.6 = M2.6。7050 の取付穴は直径が不明なので、測ってから決める
mount_screw = 2.6;
mount_pilot = mount_screw == 2 ? 1.7 : 2.2;   // 柱の下穴（PETG）
mount_head  = mount_screw == 2 ? 4.0 : 5.0;   // なべ頭の直径
mount_head_h = mount_screw == 2 ? 1.6 : 2.0;  // なべ頭の高さ

// ---- XIAO ESP32C3 ----
xiao_l    = 21.0;   // [要実測] 基板の長さ（USB-C 側の端から反対の端）
xiao_w    = 17.8;   // [要実測] 基板の幅
xiao_pcb_t= 1.0;    // [要実測] 基板の厚さ（部品を除く）
xiao_row_gap = 6;   // 左右のピン列の間の穴の数（15.24mm = 6 ピッチ）
usb_w     = 9.0;    // [要実測] USB-C コネクタの幅
usb_h     = 3.3;    // [要実測] USB-C コネクタの高さ（基板の上面から）
usb_out   = 0.3;    // [要実測] USB-C が基板の端から出っぱる量
usb_plug_w= 12.0;   // [要実測] 使うケーブルのプラグ（根元の樹脂）の幅
usb_plug_h= 7.0;    // [要実測] 同じく高さ
sock_h    = 8.5;    // [要実測] 基板に立てる丸ピンソケット（メス）の高さ
pin_body  = 2.5;    // [要実測] XIAO / アンプに付けたオスピンヘッダの黒い樹脂の高さ

// ---- アンプ Adafruit MAX31855 #269（1 枚）----
amp_l     = 25.0;   // [要実測] 長さ（ピン列から端子台の端まで）
amp_w     = 20.0;   // [要実測] 幅（ピン列に沿った方向）
amp_pcb_t = 1.6;    // [要実測] 基板の厚さ
amp_pin_off = 2.5;  // [要実測] ピン列の中心から、アンプ基板の端（XIAO 側）までの距離
term_h    = 10.0;   // [要実測] 基板の上面から、ネジ端子台の一番上まで
term_wire_h = 5.0;  // [要実測] 基板の上面から、端子の線の差し込み口の中心まで
term_w    = 10.0;   // [要実測] 端子台の幅（2 ピン分）
amp_flip  = 1;      // 1 = 手前から CLK, CS, DO, GND, 3Vo, Vin（ネジ端子が右。実物に合うと判定済み）。0 は使わない

// ---- 抵抗 330Ω / LED / タクトスイッチ ----
res_d     = 2.4;    // [要実測] 抵抗の胴の太さ
led_d     = 5.0;    // [要実測] LED の直径（3mm か 5mm）
led_h     = 9.0;    // [要実測] 基板の上面から LED の頭まで（足を曲げず立てたとき）
sw_size   = 6.0;    // [要実測] タクトスイッチの角の長さ（6mm 角）
sw_h      = 5.0;    // [要実測] 基板の上面からボタンの頭まで

// ---- 部品の穴の位置（列 c は左から、段 r は手前から。どちらも 0 始まり）----
// 並び: [xiao_c0, xiao_r0, amp_c, amp_r, led_c, led_r, led_dc, led_dr, sw_c, sw_r, sw_horiz, res_c, res_r, res_span]
//   xiao_c0/r0 = XIAO の手前側の列 D0..D6 の左端の穴。amp_c/r = アンプのピン 6 本の最初（手前）の穴、ピンは段 r..r+5
//   led = アノード（長い足）の穴、カソードは + (led_dc, led_dr)。sw = タクトスイッチの足の穴の左下（3 列 × 2 段 / sw_horiz=0 は 2 列 × 3 段）
//   res = 抵抗の左の足の穴、右の足は 列 + res_span（4 = 10.16mm）
// 全探索の結果（case/board_1ch_7050.json / board_1ch_amp_reversed.json の case_params と同じ。board_1ch_check.py が突き合わせる）
layout_7050     = [1, 5, 16, 9, 2, 2, -1, 0, 6, 0, 0, 2, 4, 3];
layout_akizukiC = [1, 4, 16, 6, 11, 5, 0, 1, 14, 1, 1, 5, 3, 4];
lay = board == "7050" ? layout_7050 : layout_akizukiC;
xiao_c0 = lay[0];  xiao_r0 = lay[1];  amp_c = lay[2];  amp_r = lay[3];
led_c = lay[4];  led_r = lay[5];  led_dc = lay[6];  led_dr = lay[7];
sw_c = lay[8];  sw_r = lay[9];  sw_horiz = lay[10];
res_c = lay[11];  res_r = lay[12];  res_span = lay[13];

// ---- アンテナ（XIAO 付属のフィルムアンテナ）----
ant_l     = 30.0;   // [要実測] アンテナの長さ（貼る部分。線は含まない）
ant_w     = 8.0;    // [要実測] アンテナの幅
ant_c_x   = 6;      // 貼る位置（左端、ケース内側の座標）
ant_z     = 12;     // 貼る位置の高さ（基板の上面から、中心まで）

// ---- 熱電対の線（1 本）----
tc_d      = 3.0;    // [要実測] 熱電対の線 1 本（2 芯なら束）の太さ。クランプはこの太さ用
tie_w     = 3.6;    // [要実測] 使うケーブルタイの幅
tie_t     = 1.3;    // [要実測] ケーブルタイの厚さ

// ---- 印刷・はめあい ----
wall      = 2.2;    // 壁の厚さ
floor_t   = 2.4;    // 底の厚さ
lid_t     = 2.4;    // ふたの板の厚さ
fit       = 0.25;   // はめあい公差（0.2〜0.3）
board_clr = 0.5;    // 基板と壁のすき間（片側）
extra_right = 3;    // 熱電対の線側に追加する余白
post_h    = 5.0;    // 基板の下の空間（はんだの足 1.5 + 被覆線 + 余裕）。電池なし
ledge_w   = 1.5;    // 基板のふちを受ける段の幅
top_gap   = 2.0;    // いちばん高い部品とふたのすき間
screw_pilot = 2.5;  // ふた用 M3 セルフタップの下穴（PETG）。基板の取付ねじは上の mount_screw
screw_clear = 3.4;  // ふたのビス穴
screw_head  = 6.2;  // ビスの頭の直径
boss_r    = 3.2;    // ふたビスの柱の半径
lid_screw_x = [20, -20]; // ふたビスの位置（内側の左端から。負は右端から）
ear_x     = [9, -9];     // 壁に留める耳の位置（同じ決め方）
vent_x    = [38, 42, 46, 62, 66, 70]; // 通気スリットの位置（ふたビスの柱とアンテナのくぼみをさける）

// =====================================================================
// ここから下は計算。ふつうは触らない
// =====================================================================
$fn = 32;
eps = 0.01;

cav_x = board_x + 2*board_clr + extra_right;
cav_y = board_y + 2*board_clr;
bx = board_clr;  by = board_clr;
gx0 = (board_x - (grid_cols-1)*pitch)/2;
gy0 = (board_y - (grid_rows-1)*pitch)/2;
function gp(c, r) = [bx + gx0 + c*pitch, by + gy0 + r*pitch];
function xs(v) = v >= 0 ? v : cav_x + v;

z0        = floor_t;
z_bb      = z0 + post_h;
z_bt      = z_bb + board_t;
amp_stack = sock_h + pin_body + amp_pcb_t + term_h;
cav_h     = post_h + board_t + amp_stack + top_gap;
rim       = z0 + cav_h;
out_x = cav_x + 2*wall;  out_y = cav_y + 2*wall;

xiao_yc   = gp(0, xiao_r0 + xiao_row_gap/2)[1];
usb_zc    = z_bt + sock_h + pin_body + xiao_pcb_t + usb_h/2;
amp_yc    = gp(0, amp_r + 2.5)[1];
amp_top_z = z_bt + sock_h + pin_body + amp_pcb_t;
wire_z    = amp_top_z + term_wire_h;
notch_w   = 5.5;
notch_bot = wire_z - tc_d/2;
tooth_gap = tc_d - 0.6;
led_p     = gp(led_c + led_dc/2, led_r + led_dr/2);
sw_p      = sw_horiz ? gp(sw_c + 1.5, sw_r + 1) : gp(sw_c + 1, sw_r + 1.5);
led_tube_id = led_d + 0.8;   led_tube_od = led_tube_id + 3.2;
rod_d     = 5.6;  rod_hole = rod_d + 0.6;  rod_tube_od = rod_hole + 3.6;
flange_d  = 9.0;  flange_t = 1.5;  rod_gap = 0.8;
tube_bot_btn = z_bt + sw_h + rod_gap + flange_t;
tube_bot_led = z_bt + led_h + 1.0;
mounts = [for (x = [mount_off[0], board_x - mount_off[0]], y = [mount_off[1], board_y - mount_off[1]]) [bx + x, by + y]];

module rr(x, y, r) { // 角丸の長方形（2D、原点は左下）
    hull() for (i=[r, x-r], j=[r, y-r]) translate([i,j]) circle(r);
}

// ---------------- 本体 ----------------
module lid_screw_pts() {
    for (xv = lid_screw_x) {
        x = xs(xv);
        for (y = [-boss_r, cav_y + boss_r]) translate([x, y]) children();
    }
}
module body() {
    difference() {
        union() {
            difference() {
                translate([-wall, -wall, 0]) linear_extrude(rim) rr(out_x, out_y, 3);
                translate([0, 0, z0]) cube([cav_x, cav_y, cav_h + 1]);
            }
            lid_screw_pts() cylinder(r=boss_r, h=rim);
            // 壁に固定する耳（底の高さ。厚さ 3）
            for (xv = ear_x) { x = xs(xv);
                hull() { translate([x-7, -wall-1, 0]) cube([14, 1.5, 3]);
                         translate([x, -wall-6.5, 0]) cylinder(r=6.5, h=3); }
                hull() { translate([x-7, cav_y+wall-0.5, 0]) cube([14, 1.5, 3]);
                         translate([x, cav_y+wall+6.5, 0]) cylinder(r=6.5, h=3); }
            }
            // 基板の四隅の柱
            for (m = mounts) translate([m[0], m[1], 0]) cylinder(d=7, h=z0 + post_h);
            ledge();
        }
        // 柱の下穴（深さ 5mm。底は貫通しない）
        for (m = mounts) translate([m[0], m[1], z0 + post_h - 5]) cylinder(d=mount_pilot, h=6);
        lid_screw_pts() translate([0, 0, rim - 12]) cylinder(d=screw_pilot, h=13);
        // 耳のビス穴（皿つき）
        for (xv = ear_x) for (y = [-wall-6.5, cav_y+wall+6.5]) translate([xs(xv), y, 0]) {
            translate([0,0,-1]) cylinder(d=4.5, h=5);
            translate([0,0,1.0]) cylinder(d1=4.5, d2=8.5, h=2.01);
        }
        usb_hole();
        // 熱電対の出口（上が開いた切り欠き）
        translate([cav_x - 1, amp_yc - notch_w/2, notch_bot]) cube([wall + 2, notch_w, rim - notch_bot + 1]);
        // ケーブルタイ穴（床。線を床にくくる）
        for (s = [-1, 1])
            translate([cav_x - 10 - tie_w/2, amp_yc + s*(tc_d/2 + 2.5) - tie_t/2 - 0.3, -1])
                cube([tie_w + 0.6, tie_t + 0.6, floor_t + 2]);
        // 通気穴（長い壁の両側、アンプのまわり）
        for (x = vent_x, y = [-wall-1, cav_y-1]) translate([x - 1.2, y, z_bt + 5])
            cube([2.4, wall + 2, 16]);
        // アンテナを貼る浅いくぼみ
        translate([ant_c_x, cav_y - 0.4, z_bt + ant_z - ant_w/2]) cube([ant_l, 1, ant_w]);
    }
}
module ledge() {
    t = ledge_w;
    hull() { translate([0, 0, z_bb - eps]) cube([cav_x, t, eps]);
             translate([0, 0, z_bb - t]) cube([cav_x, eps, t]); }
    hull() { translate([0, cav_y - t, z_bb - eps]) cube([cav_x, t, eps]);
             translate([0, cav_y - eps, z_bb - t]) cube([cav_x, eps, t]); }
    hull() { translate([0, 0, z_bb - eps]) cube([t, cav_y, eps]);
             translate([0, 0, z_bb - t]) cube([eps, cav_y, t]); }
    hull() { translate([cav_x - t, 0, z_bb - eps]) cube([t, cav_y, eps]);
             translate([cav_x - eps, 0, z_bb - t]) cube([eps, cav_y, t]); }
}
module usb_hole() {
    cz = usb_zc; cy = xiao_yc; w = usb_plug_w + 1; h = usb_plug_h + 1; ch = min(3.5, h/2);
    translate([-wall - 1, 0, 0]) rotate([90, 0, 90]) linear_extrude(wall + 2)
        polygon([[cy - w/2, cz - h/2], [cy + w/2, cz - h/2], [cy + w/2, cz + h/2 - ch],
                 [cy + w/2 - ch, cz + h/2], [cy - w/2 + ch, cz + h/2], [cy - w/2, cz + h/2 - ch]]);
}

// ---------------- ふた（組み立てた向き。下面が z=rim）----------------
module lid_asm() {
    difference() {
        union() {
            translate([0, 0, rim]) linear_extrude(lid_t) union() {
                translate([-wall, -wall]) rr(out_x, out_y, 3);
                lid_screw_pts() circle(r=boss_r);
            }
            translate([fit, fit, rim - 3]) linear_extrude(3 + eps) difference() {
                square([cav_x - 2*fit, cav_y - 2*fit]);
                translate([1.6, 1.6]) square([cav_x - 2*fit - 3.2, cav_y - 2*fit - 3.2]);
            }
            // 線を押さえるクランプの歯
            translate([cav_x + fit, amp_yc - notch_w/2 + 0.3, notch_bot + tooth_gap])
                cube([wall - fit, notch_w - 0.6, rim - notch_bot - tooth_gap + eps]);
            translate([sw_p[0], sw_p[1], tube_bot_btn]) cylinder(d=rod_tube_od, h=rim - tube_bot_btn + eps);
            translate([led_p[0], led_p[1], tube_bot_led]) cylinder(d=led_tube_od, h=rim - tube_bot_led + eps);
        }
        lid_screw_pts() {
            translate([0, 0, rim - 1]) cylinder(d=screw_clear, h=lid_t + 2);
            translate([0, 0, rim + lid_t - (screw_head - screw_clear)/2]) cylinder(d1=screw_clear, d2=screw_head + 0.01, h=(screw_head - screw_clear)/2 + eps);
        }
        translate([sw_p[0], sw_p[1], tube_bot_btn - 1]) cylinder(d=rod_hole, h=rim - tube_bot_btn + lid_t + 2);
        // LED の窓: 外面に 0.6mm の薄い皮を残す
        translate([led_p[0], led_p[1], tube_bot_led - 1]) cylinder(d=led_tube_id, h=rim + lid_t - 0.6 - tube_bot_led + 1);
    }
}
module lid() { // 印刷の向き（外面を下）
    translate([wall, cav_y + wall, rim + lid_t]) rotate([180, 0, 0]) lid_asm();
}

// ---------------- 押し棒（印刷の向き: つばを下）----------------
module button() {
    shaft = (rim - tube_bot_btn) + lid_t + 1.5;
    cylinder(d=flange_d, h=flange_t);
    cylinder(d=rod_d, h=flange_t + shaft);
}
module button_asm() translate([sw_p[0], sw_p[1], tube_bot_btn - flange_t]) button();

// ---------------- 確認用: 基板と部品（干渉の確認。印刷しない）----------------
module dummy_parts(wire=true, ant=true) {
    color("seagreen") translate([bx, by, z_bb]) cube([board_x, board_y, board_t]);
    // XIAO（ソケット + ヘッダ + 基板 + USB）
    xl = gp(xiao_c0, xiao_r0);
    color("gray") translate([xl[0] - 1.27, xl[1] - 1.27, z_bt]) cube([6*pitch + 2.54, 2.54, sock_h]);
    color("gray") translate([xl[0] - 1.27, xl[1] + xiao_row_gap*pitch - 1.27, z_bt]) cube([6*pitch + 2.54, 2.54, sock_h]);
    color("royalblue") translate([xl[0] + 3*pitch - xiao_l/2, xiao_yc - xiao_w/2, z_bt + sock_h + pin_body]) cube([xiao_l, xiao_w, xiao_pcb_t]);
    color("silver") translate([xl[0] + 3*pitch - xiao_l/2 - usb_out, xiao_yc - usb_w/2, z_bt + sock_h + pin_body + xiao_pcb_t]) cube([8, usb_w, usb_h]);
    // アンプ
    p = gp(amp_c, amp_r + 2.5);
    color("gray") translate([p[0] - 1.27, gp(0, amp_r)[1] - 1.27, z_bt]) cube([2.54, 5*pitch + 2.54, sock_h]);
    color("crimson") translate([p[0] - amp_pin_off, p[1] - amp_w/2, z_bt + sock_h + pin_body]) cube([amp_l, amp_w, amp_pcb_t]);
    color("royalblue") translate([p[0] - amp_pin_off + amp_l - 8, p[1] - term_w/2, amp_top_z]) cube([8, term_w, term_h]);
    if (wire) color("orange") translate([p[0] - amp_pin_off + amp_l - 8, p[1] - tc_d/2, wire_z - tc_d/2]) cube([cav_x + wall - (p[0] - amp_pin_off + amp_l - 8), tc_d, tc_d]);
    // 抵抗（寝かせる）
    ra = gp(res_c, res_r);
    color("tan") translate([ra[0], ra[1], z_bt + res_d/2]) rotate([0, 90, 0]) cylinder(d=res_d, h=res_span*pitch);
    color("red") translate([led_p[0], led_p[1], z_bt]) cylinder(d=led_d, h=led_h);
    color("black") translate([sw_p[0] - sw_size/2, sw_p[1] - sw_size/2, z_bt]) cube([sw_size, sw_size, sw_h]);
    // 基板の取付ビスの頭（なべ頭）
    for (m = mounts) color("silver") translate([m[0], m[1], z_bt]) cylinder(d=mount_head, h=mount_head_h);
    if (ant) color("white") translate([ant_c_x, cav_y - 0.4, z_bt + ant_z - ant_w/2]) cube([ant_l, 0.4, ant_w]);
}

if (part == "body") body();
else if (part == "lid") lid();
else if (part == "button") button();
else if (part == "assembly") { color("lightgray") body(); dummy_parts(); color("khaki") lid_asm(); color("tomato") button_asm(); }
else if (part == "assembly_cut") { // 手前半分を切って中を見る
    difference() {
        union() { color("lightgray") body(); dummy_parts(); color("khaki") lid_asm(); color("tomato") button_asm(); }
        translate([-20, -20, -5]) cube([300, 20 + sw_p[1] + 0.01, 100]);
    }
}
else if (part == "interf") { // 部品とケースの干渉（体積が空なら干渉なし）
    intersection() {
        union() { body(); lid_asm(); button_asm(); }
        dummy_parts(wire=false, ant=false);
    }
}
else if (part == "interf_ant") { // アンテナのくぼみ以外との干渉
    intersection() { union() { lid_asm(); button_asm(); } translate([ant_c_x, cav_y - 0.4, z_bt + ant_z - ant_w/2]) cube([ant_l, 0.4, ant_w]); }
}
else if (part == "interf_inner") { intersection() { lid_asm(); union() { button_asm(); body(); } } }
else if (part == "assembly_open") { color("lightgray") body(); dummy_parts(); }

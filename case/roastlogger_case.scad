// 焙煎ロガー ケース（ユニバーサル基板 + XIAO ESP32C3 + MAX31855 ×3）
// 印刷: Bambu Lab A1 / PETG / ノズル 0.4mm / サポートなし
// 使い方: part を切り替えて書き出す（case/build.sh が全部やる）
//   openscad -D 'part="body"' -o stl/body.stl roastlogger_case.scad
//   part = "body" | "lid" | "button" | "divider" | "assembly" | "assembly_cut"
// 座標: ケース内側の左前の角が (0,0)。X = 長辺（左端が USB-C 側）、Y = 短辺、Z = 上。
// 基板の穴は (列, 段) = (c, r)。0 始まり。c は左(USB 側)から、r は手前から。

part = "assembly";

// =====================================================================
// 実測して書き換える値（部品が届いたら、docs/CASE.md「測ってほしい場所」で測る）
// 数字は公表値または仮の値。全部 [要実測]。単位は mm。
// =====================================================================

// ---- ユニバーサル基板（標準は秋月 B タイプ。理由は docs/CASE.md 2 章）----
board_x   = 95;     // [要実測] 基板の長辺。ノギスで外形を測る（B=95 / C=72）
board_y   = 72;     // [要実測] 基板の短辺（B=72 / C=47）
board_t   = 1.6;    // [要実測] 基板の厚さ
pitch     = 2.54;   // 穴のピッチ（ふつうは変えない）
grid_cols = 37;     // [要実測] 長辺方向の穴の数（数える）
grid_rows = 28;     // [要実測] 短辺方向の穴の数（数える）
// 取付穴の位置: 一番近い格子の穴の (列,段)。基板の四隅
mount_c   = 1;      // [要実測] 隅の取付穴は、左端から何番目の穴か（0 始まり）
mount_r   = 1;      // [要実測] 同じく手前の端から何番目か
mount_d   = 3.2;    // [要実測] 取付穴の直径

// ---- XIAO ESP32C3 ----
xiao_l    = 21.0;   // [要実測] 基板の長さ（USB-C 側の端から反対の端）
xiao_w    = 17.8;   // [要実測] 基板の幅
xiao_pcb_t= 1.0;    // [要実測] 基板の厚さ（部品を除く）
xiao_row_gap = 6;   // 左右のピン列の間の穴の数（15.24mm = 6 ピッチ。ふつうは変えない）
xiao_c0   = 2;      // XIAO のピン1（D0 / 5V）を挿す列（0 始まり）
xiao_r0   = 11;     // XIAO の手前側ピン列（D0..D6）の段
usb_w     = 9.0;    // [要実測] USB-C コネクタの幅
usb_h     = 3.3;    // [要実測] USB-C コネクタの高さ（基板の上面から）
usb_out   = 0.3;    // [要実測] USB-C が基板の端から出っぱる量（0 でも可）
usb_plug_w= 12.0;   // [要実測] 使うケーブルのプラグ（根元の樹脂）の幅
usb_plug_h= 7.0;    // [要実測] 同じく高さ
sock_h    = 8.5;    // [要実測] 基板に立てる丸ピンソケット（メス）の高さ
pin_body  = 2.5;    // [要実測] XIAO / アンプに付けたオスピンヘッダの黒い樹脂の高さ

// ---- アンプ Adafruit MAX31855 #269 ----
amp_l     = 25.0;   // [要実測] 長さ（ピン列から端子台の端まで）
amp_w     = 20.0;   // [要実測] 幅（ピン列に沿った方向）
amp_pcb_t = 1.6;    // [要実測] 基板の厚さ
amp_pin_off = 2.5;  // [要実測] ピン列の中心から、アンプ基板の端（XIAO 側）までの距離
term_h    = 10.0;   // [要実測] 基板の上面から、ネジ端子台の一番上まで
term_wire_h = 5.0;  // [要実測] 基板の上面から、端子の線の差し込み口の中心まで
term_w    = 10.0;   // [要実測] 端子台の幅（2 ピン分）
amp_c     = 21;     // アンプのピン列の列（0 始まり）
amp_r     = [2, 11, 20]; // 3 枚のピン列の最初の段（Vin の穴）。ピン 6 本は段 r..r+5

// ---- LED / タクトスイッチ ----
led_d     = 5.0;    // [要実測] LED の直径（3mm か 5mm）
led_h     = 9.0;    // [要実測] 基板の上面から LED の頭まで（足を曲げず立てたとき）
led_c     = 8;      // LED のアノード（長い足）の穴 (列, 段)。カソードは列+1
led_r     = 5;
sw_size   = 6.0;    // [要実測] タクトスイッチの角の長さ（6mm 角）
sw_h      = 5.0;    // [要実測] 基板の上面からボタンの頭まで
sw_c      = 12;     // タクトスイッチの足の穴（左下）。対角の足は (列+2, 段+2)
sw_r      = 4;

// ---- アンテナ（XIAO 付属のフィルムアンテナ）----
ant_l     = 30.0;   // [要実測] アンテナの長さ（貼る部分。線は含まない）
ant_w     = 8.0;    // [要実測] アンテナの幅
ant_c_x   = 8;      // 貼る位置（左端、ケース内側の座標）
ant_z     = 12;     // 貼る位置の高さ（基板の上面から、中心まで）

// ---- 熱電対の線 ----
tc_d      = 3.0;    // [要実測] 熱電対の線 1 本（2 芯なら 2 本ぶん）の太さ。クランプはこの太さ用
tie_w     = 3.6;    // [要実測] 使うケーブルタイの幅（幅 2.5mm のものが無難。実測する）
tie_t     = 1.3;    // [要実測] ケーブルタイの厚さ

// ---- 電池（今回は入れない。将来の LiPo 503035）----
bat_x     = 35.0;   // [要実測] 電池の長さ
bat_y     = 30.0;   // [要実測] 電池の幅
bat_z     = 5.0;    // [要実測] 電池の厚さ（膨らみ余裕は別に取る）

// ---- 印刷・はめあい ----
wall      = 2.2;    // 壁の厚さ（0.4mm ノズルで 5 本ぶん強）
floor_t   = 2.4;    // 底の厚さ
lid_t     = 2.4;    // ふたの板の厚さ
fit       = 0.25;   // はめあい公差（0.2〜0.3）。きついときは大きく
board_clr = 0.5;    // 基板と壁のすき間（片側）
extra_right = 4;    // 熱電対の線側に追加する余白
post_h    = 9.5;    // 基板の下の空間（電池 5mm + 仕切り + はんだの足）
ledge_w   = 1.5;    // 基板のふちを受ける段の幅
top_gap   = 2.0;    // いちばん高い部品とふたのすき間
screw_pilot = 2.5;  // M3 セルフタップの下穴（PETG）
screw_clear = 3.4;  // ふたのビス穴（M3 が通る）
screw_head  = 6.2;  // ビスの頭の直径（皿の大きさ）
boss_r    = 3.2;    // ふたビスの柱の半径
lid_screw_x = [22, -22]; // ふたビスの位置（ケース内側の左端から。負は右端から）

// =====================================================================
// ここから下は計算。ふつうは触らない
// =====================================================================
$fn = 32;
eps = 0.01;

cav_x = board_x + 2*board_clr + extra_right;
cav_y = board_y + 2*board_clr;
bx = board_clr;  by = board_clr;               // 基板の左前の角（ケース内側座標）
gx0 = (board_x - (grid_cols-1)*pitch)/2;
gy0 = (board_y - (grid_rows-1)*pitch)/2;
function gp(c, r) = [bx + gx0 + c*pitch, by + gy0 + r*pitch];

z0        = floor_t;                           // 内側の床
z_bb      = z0 + post_h;                       // 基板の下面
z_bt      = z_bb + board_t;                    // 基板の上面
amp_stack = sock_h + pin_body + amp_pcb_t + term_h;
cav_h     = post_h + board_t + amp_stack + top_gap;
rim       = z0 + cav_h;                        // ふちの高さ（ふたが載る面）
out_x = cav_x + 2*wall;  out_y = cav_y + 2*wall;

xiao_yc   = gp(0, xiao_r0 + xiao_row_gap/2)[1];
usb_zc    = z_bt + sock_h + pin_body + xiao_pcb_t + usb_h/2;
function amp_yc(i) = gp(0, amp_r[i] + 2.5)[1];
amp_top_z = z_bt + sock_h + pin_body + amp_pcb_t;
wire_z    = amp_top_z + term_wire_h;
notch_w   = 5.5;
notch_bot = wire_z - tc_d/2;
tooth_gap = tc_d - 0.6;                        // 線をつぶす量 0.6
led_p     = gp(led_c + 0.5, led_r);
sw_p      = gp(sw_c + 1, sw_r + 1);
bat_cx    = cav_x/2 - 6;  bat_cy = cav_y/2;
leg_dx    = bat_x + 7;  leg_dy = bat_y + 7;    // 仕切りの脚の間隔（中心）
led_tube_id = led_d + 0.8;   led_tube_od = led_tube_id + 3.2;
rod_d     = 5.6;  rod_hole = rod_d + 0.6;  rod_tube_od = rod_hole + 3.6;
flange_d  = 9.0;  flange_t = 1.5;  rod_gap = 0.8;
tube_bot_btn = z_bt + sw_h + rod_gap + flange_t;
tube_bot_led = z_bt + led_h + 1.0;

module rr(x, y, r) { // 角丸の長方形（2D、原点は左下）
    hull() for (i=[r, x-r], j=[r, y-r]) translate([i,j]) circle(r);
}

// ---------------- 本体 ----------------
module lid_screw_pts() {
    for (xs = lid_screw_x) {
        x = xs >= 0 ? xs : cav_x + xs;
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
            // ふたビスの柱
            lid_screw_pts() cylinder(r=boss_r, h=rim);
            // 壁に固定する耳（底の高さ。厚さ 3）
            for (x = [10, cav_x-10]) {
                hull() { translate([x-7, -wall-1, 0]) cube([14, 1.5, 3]);
                         translate([x, -wall-6.5, 0]) cylinder(r=6.5, h=3); }
                hull() { translate([x-7, cav_y+wall-0.5, 0]) cube([14, 1.5, 3]);
                         translate([x, cav_y+wall+6.5, 0]) cylinder(r=6.5, h=3); }
            }
            // 基板の四隅の柱
            for (c = [mount_c, grid_cols-1-mount_c], r = [mount_r, grid_rows-1-mount_r])
                translate([gp(c, r)[0], gp(c, r)[1], 0]) cylinder(d=7, h=z0 + post_h);
            // 基板のふちを受ける段（45 度の斜面でサポート不要）
            ledge();
        }
        // 柱の下穴
        for (c = [mount_c, grid_cols-1-mount_c], r = [mount_r, grid_rows-1-mount_r])
            translate([gp(c, r)[0], gp(c, r)[1], z0 + post_h - 8]) cylinder(d=screw_pilot, h=9);
        // ふたビスの下穴
        lid_screw_pts() translate([0, 0, rim - 12]) cylinder(d=screw_pilot, h=13);
        // 耳のビス穴（皿つき）
        for (x = [10, cav_x-10]) {
            for (y = [-wall-6.5, cav_y+wall+6.5]) translate([x, y, 0]) {
                translate([0,0,-1]) cylinder(d=4.5, h=5);
                translate([0,0,1.0]) cylinder(d1=4.5, d2=8.5, h=2.01);
            }
        }
        // USB-C の穴（上の角を 45 度に落としてブリッジを避ける）
        usb_hole();
        // 熱電対の出口（上が開いた切り欠き）と、ふたのクランプで押さえる
        for (i = [0:2]) translate([cav_x - 1, amp_yc(i) - notch_w/2, notch_bot])
            cube([wall + 2, notch_w, rim - notch_bot + 1]);
        // ケーブルタイ穴（床。線を床にくくる）
        for (i = [0:2], s = [-1, 1])
            translate([cav_x - 10 - tie_w/2, amp_yc(i) + s*(tc_d/2 + 2.5) - tie_t/2 - 0.3, -1])
                cube([tie_w + 0.6, tie_t + 0.6, floor_t + 2]);
        // 通気穴（長い壁の両側、アンプのまわり）
        for (x = [40:5:70], y = [-wall-1, cav_y-1]) translate([x - 1.2, y, z_bb + 3])
            cube([2.4, wall + 2, 16]);
        // アンテナを貼る浅いくぼみ（奥の長い壁の内側）
        translate([ant_c_x, cav_y - 0.4, z_bt + ant_z - ant_w/2]) cube([ant_l, 1, ant_w]);
        // 電池の仕切りの脚の位置決めのくぼみ
        for (sx = [-1, 1], sy = [-1, 1]) translate([bat_cx + sx*leg_dx/2, bat_cy + sy*leg_dy/2, z0 - 0.6])
            cylinder(d=4.6, h=1);
    }
}
module ledge() {
    // 4 辺の壁にそった三角形の段。上面の幅 ledge_w、下へ 45 度
    t = ledge_w;
    {
        hull() { translate([0, 0, z_bb - eps]) cube([cav_x, t, eps]);
                 translate([0, 0, z_bb - t]) cube([cav_x, eps, t]); }
        hull() { translate([0, cav_y - t, z_bb - eps]) cube([cav_x, t, eps]);
                 translate([0, cav_y - eps, z_bb - t]) cube([cav_x, eps, t]); }
        hull() { translate([0, 0, z_bb - eps]) cube([t, cav_y, eps]);
                 translate([0, 0, z_bb - t]) cube([eps, cav_y, t]); }
        hull() { translate([cav_x - t, 0, z_bb - eps]) cube([t, cav_y, eps]);
                 translate([cav_x - eps, 0, z_bb - t]) cube([eps, cav_y, t]); }
    }
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
            // 板（本体の外形 + ふたビスの柱）
            translate([0, 0, rim]) linear_extrude(lid_t) union() {
                translate([-wall, -wall]) rr(out_x, out_y, 3);
                lid_screw_pts() circle(r=boss_r);
            }
            // 内側のつば（壁の内側にはまる）
            translate([fit, fit, rim - 3]) linear_extrude(3 + eps) difference() {
                square([cav_x - 2*fit, cav_y - 2*fit]);
                translate([1.6, 1.6]) square([cav_x - 2*fit - 3.2, cav_y - 2*fit - 3.2]);
            }
            // 線を押さえるクランプの歯
            for (i = [0:2]) translate([cav_x + fit, amp_yc(i) - notch_w/2 + 0.3, notch_bot + tooth_gap])
                cube([wall - fit, notch_w - 0.6, rim - notch_bot - tooth_gap + eps]);
            // ボタンの案内筒
            translate([sw_p[0], sw_p[1], tube_bot_btn]) cylinder(d=rod_tube_od, h=rim - tube_bot_btn + eps);
            // LED の導光筒
            translate([led_p[0], led_p[1], tube_bot_led]) cylinder(d=led_tube_od, h=rim - tube_bot_led + eps);
        }
        // ふたビス穴（皿つき。外面側が広い。45 度）
        lid_screw_pts() {
            translate([0, 0, rim - 1]) cylinder(d=screw_clear, h=lid_t + 2);
            translate([0, 0, rim + lid_t - (screw_head - screw_clear)/2]) cylinder(d1=screw_clear, d2=screw_head + 0.01, h=(screw_head - screw_clear)/2 + eps);
        }
        // ボタンの穴
        translate([sw_p[0], sw_p[1], tube_bot_btn - 1]) cylinder(d=rod_hole, h=rim - tube_bot_btn + lid_t + 2);
        // LED の窓: 外面に 0.6mm の薄い皮を残す（光を通す）
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

// ---------------- 電池の仕切り（印刷の向き: 板を下）----------------
div_t = 1.2;
module divider() {
    leg_h = bat_z + 1.8;
    translate([-leg_dx/2 - 3, -leg_dy/2 - 3, 0]) cube([leg_dx + 6, leg_dy + 6, div_t]);
    for (sx = [-1, 1], sy = [-1, 1]) translate([sx*leg_dx/2, sy*leg_dy/2, 0]) cylinder(d=4, h=div_t + leg_h);
}
module divider_asm() translate([bat_cx, bat_cy, z0]) divider_flipped();
module divider_flipped() { // 組み立て: 板が上、脚が下
    leg_h = bat_z + 1.8;
    translate([-leg_dx/2 - 3, -leg_dy/2 - 3, leg_h]) cube([leg_dx + 6, leg_dy + 6, div_t]);
    for (sx = [-1, 1], sy = [-1, 1]) translate([sx*leg_dx/2, sy*leg_dy/2, 0]) cylinder(d=4, h=leg_h + div_t);
}

// ---------------- 確認用: 基板と部品（干渉の確認。印刷しない）----------------
module dummy_parts(wire=true, bat=true, ant=true) {
    color("seagreen") translate([bx, by, z_bb]) cube([board_x, board_y, board_t]);
    // XIAO（ソケット + ヘッダ + 基板 + USB）
    xl = gp(xiao_c0, xiao_r0); 
    color("gray") translate([xl[0] - 1.27, xl[1] - 1.27, z_bt]) cube([6*pitch + 2.54, 2.54, sock_h]);
    color("gray") translate([xl[0] - 1.27, xl[1] + xiao_row_gap*pitch - 1.27, z_bt]) cube([6*pitch + 2.54, 2.54, sock_h]);
    color("royalblue") translate([xl[0] + 3*pitch - xiao_l/2 + 0 , xiao_yc - xiao_w/2, z_bt + sock_h + pin_body]) cube([xiao_l, xiao_w, xiao_pcb_t]);
    color("silver") translate([xl[0] + 3*pitch - xiao_l/2 - usb_out, xiao_yc - usb_w/2, z_bt + sock_h + pin_body + xiao_pcb_t]) cube([8, usb_w, usb_h]);
    for (i = [0:2]) {
        p = gp(amp_c, amp_r[i] + 2.5);
        color("gray") translate([p[0] - 1.27, gp(0, amp_r[i])[1] - 1.27, z_bt]) cube([2.54, 5*pitch + 2.54, sock_h]);
        color("crimson") translate([p[0] - amp_pin_off, p[1] - amp_w/2, z_bt + sock_h + pin_body]) cube([amp_l, amp_w, amp_pcb_t]);
        color("royalblue") translate([p[0] - amp_pin_off + amp_l - 8, p[1] - term_w/2, amp_top_z]) cube([8, term_w, term_h]);
        if (wire) color("orange") translate([p[0] - amp_pin_off + amp_l - 8, p[1] - tc_d/2, wire_z - tc_d/2]) cube([cav_x + wall - (p[0] - amp_pin_off + amp_l - 8), tc_d, tc_d]);
    }
    color("red") translate([led_p[0], led_p[1], z_bt]) cylinder(d=led_d, h=led_h);
    color("black") translate([sw_p[0] - sw_size/2, sw_p[1] - sw_size/2, z_bt]) cube([sw_size, sw_size, sw_h]);
    // 電池（将来）
    if (bat) color("gold", 0.6) translate([bat_cx - bat_x/2, bat_cy - bat_y/2, z0]) cube([bat_x, bat_y, bat_z]);
    // アンテナ
    if (ant) color("white") translate([ant_c_x, cav_y - 0.4, z_bt + ant_z - ant_w/2]) cube([ant_l, 0.4, ant_w]);
}

if (part == "body") body();
else if (part == "lid") lid();
else if (part == "button") button();
else if (part == "divider") divider();
else if (part == "assembly") { color("lightgray") body(); dummy_parts(); color("khaki") lid_asm(); color("tomato") button_asm(); color("plum") divider_asm(); }
else if (part == "assembly_cut") { // 手前半分を切って中を見る
    difference() {
        union() { color("lightgray") body(); dummy_parts(); color("khaki") lid_asm(); color("tomato") button_asm(); color("plum") divider_asm(); }
        translate([-20, -20, -5]) cube([300, 20 + 36.5, 100]);
    }
}
else if (part == "interf") { // 部品とケースの干渉（体積が空なら干渉なし）
    intersection() {
        union() { body(); lid_asm(); button_asm(); divider_asm(); }
        dummy_parts(wire=false, bat=false, ant=false);
    }
}
else if (part == "interf_bat") { intersection() { union() { body(); lid_asm(); button_asm(); divider_asm(); } translate([bat_cx - bat_x/2, bat_cy - bat_y/2, z0]) cube([bat_x, bat_y, bat_z]); } }
else if (part == "interf_inner") { // ふた・押し棒・仕切りどうしの干渉
    intersection() { union() { lid_asm(); } union() { button_asm(); body(); } } }
else if (part == "assembly_open") { color("lightgray") body(); dummy_parts(); color("plum") divider_asm(); }

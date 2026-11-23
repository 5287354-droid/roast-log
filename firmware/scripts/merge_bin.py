"""PlatformIO の extra_scripts（post:）。

- `pio run -e <env> -t flashparts` : ブラウザ書き込みページ（docs/flash/）用の 5 つの部品
  （bootloader / パーティション表 / boot_app0 / app / LittleFS）を build/<env>/flashparts/ に集め、
  flashparts.json（オフセット付き）を書く。NVS の領域には何も書かない（Wi-Fi・補正値が消えない。SPEC 9.6）。
  先に `pio run -e <env> -t buildfs` で LittleFS の像を作っておくこと（scripts/make_flash_bins.sh がまとめて行う）。
- `pio run -e <env> -t mergebin`   : 開発用。全部を 1 本の bin（オフセット 0）にまとめる。
  この 1 本は NVS の領域も 0xFF で埋めるので、書くと設定が消える。書き込みページでは使わない。
"""
import csv
import json
import os
import shutil
import subprocess

Import("env")  # noqa: F821


def _num(s):
    s = s.strip().lower()
    mult = 1
    if s.endswith("k"):
        mult, s = 1024, s[:-1]
    elif s.endswith("m"):
        mult, s = 1024 * 1024, s[:-1]
    return int(s, 0) * mult


def _fs_offset(env):
    path = env.subst("$PARTITIONS_TABLE_CSV")
    with open(path) as f:
        for row in csv.reader(line for line in f if line.strip() and not line.lstrip().startswith("#")):
            row = [c.strip() for c in row]
            if len(row) >= 5 and row[1] == "data" and row[2] in ("spiffs", "littlefs"):
                return _num(row[3])
    raise RuntimeError("パーティション表に LittleFS（spiffs）領域がありません: " + path)


def merge_bin(source, target, env):
    build = env.subst("$BUILD_DIR")
    mcu = env.BoardConfig().get("build.mcu", "esp32")
    fw = os.path.join(build, env.subst("${PROGNAME}.bin"))
    fs = os.path.join(build, "littlefs.bin")
    if not os.path.exists(fs):
        raise SystemExit("mergebin: %s がありません。先に `pio run -e %s -t buildfs` を実行してください" % (fs, env["PIOENV"]))
    out = os.path.join(build, "roastlog-%s-merged.bin" % env["PIOENV"])
    parts = []
    for off, img in env.get("FLASH_EXTRA_IMAGES", []):
        parts += [env.subst(off), env.subst(img)]
    parts += [env.subst("$ESP32_APP_OFFSET"), fw, hex(_fs_offset(env)), fs]
    esptool = os.path.join(env.PioPlatform().get_package_dir("tool-esptoolpy") or "", "esptool.py")
    cmd = [env.subst("$PYTHONEXE"), esptool, "--chip", mcu, "merge_bin", "-o", out,
           "--flash_mode", "dio", "--flash_freq", "keep", "--flash_size", env.BoardConfig().get("upload.flash_size", "4MB")] + parts
    print("mergebin:", " ".join(cmd))
    subprocess.check_call(cmd)
    print("mergebin: %s (%d bytes)" % (out, os.path.getsize(out)))


def flash_parts(source, target, env):
    build = env.subst("$BUILD_DIR")
    fw = os.path.join(build, env.subst("${PROGNAME}.bin"))
    fs = os.path.join(build, "littlefs.bin")
    if not os.path.exists(fs):
        raise SystemExit("flashparts: %s がありません。先に `pio run -e %s -t buildfs` を実行してください" % (fs, env["PIOENV"]))
    out = os.path.join(build, "flashparts")
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    names = {"bootloader": None, "partitions": None, "boot_app0": None}
    parts = []
    for off, img in env.get("FLASH_EXTRA_IMAGES", []):
        img = env.subst(img)
        base = os.path.basename(img)
        key = "bootloader" if "bootloader" in base else ("partitions" if "partitions" in base else ("boot_app0" if "boot_app0" in base else None))
        if key is None:
            raise SystemExit("flashparts: 知らない部品です: " + img)
        names[key] = (_num(env.subst(off)), img)
    for key in ("bootloader", "partitions", "boot_app0"):
        if names[key] is None:
            raise SystemExit("flashparts: %s が見つかりません" % key)
        parts.append({"name": key, "offset": names[key][0], "file": key + ".bin"})
        shutil.copy(names[key][1], os.path.join(out, key + ".bin"))
    parts.append({"name": "app", "offset": _num(env.subst("$ESP32_APP_OFFSET")), "file": "firmware.bin"})
    shutil.copy(fw, os.path.join(out, "firmware.bin"))
    parts.append({"name": "littlefs", "offset": _fs_offset(env), "file": "littlefs.bin"})
    shutil.copy(fs, os.path.join(out, "littlefs.bin"))
    info = {"env": env["PIOENV"], "chip": env.BoardConfig().get("build.mcu", "esp32"), "parts": sorted(parts, key=lambda p: p["offset"])}
    with open(os.path.join(out, "flashparts.json"), "w") as f:
        json.dump(info, f, indent=2)
    print("flashparts: %s" % json.dumps(info))


env.AddCustomTarget(  # noqa: F821
    name="flashparts",
    dependencies=["$BUILD_DIR/${PROGNAME}.bin"],
    actions=[flash_parts],
    title="Flash parts",
    description="書き込みページ用の 5 つの部品（NVS には書かない）を集める",
)

env.AddCustomTarget(  # noqa: F821
    name="mergebin",
    dependencies=["$BUILD_DIR/${PROGNAME}.bin"],
    actions=[merge_bin],
    title="Merge bin",
    description="開発用: ファーム + LittleFS を 1 本の bin（オフセット 0）にまとめる（NVS も消える）",
)

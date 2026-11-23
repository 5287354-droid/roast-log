"""PlatformIO の extra_scripts（post:）。`pio run -e <env> -t mergebin` で
ブートローダ・パーティション表・boot_app0・ファーム・LittleFS を 1 本の bin（オフセット 0）にまとめる。
ブラウザ書き込みページ（docs/flash/）は、この 1 本を ESP Web Tools で書き込む。

先に `pio run -e <env> -t buildfs` で LittleFS の像（littlefs.bin）を作っておくこと
（scripts/make_flash_bins.sh がまとめて行う）。
"""
import csv
import os
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


env.AddCustomTarget(  # noqa: F821
    name="mergebin",
    dependencies=["$BUILD_DIR/${PROGNAME}.bin"],
    actions=[merge_bin],
    title="Merge bin",
    description="ファーム + LittleFS を 1 本の bin（オフセット 0）にまとめる",
)

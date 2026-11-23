#!/usr/bin/env python3
"""app/index.html を gzip して firmware/data/index.html.gz に書く（SPEC 1.3）。

- PlatformIO の extra_scripts（pre:）として、ビルドのたびに自動で実行される
- 単体でも動く:  python3 firmware/scripts/build_fs.py
- 出力は決定的（gzip の時刻を 0 に固定）なので、同じ入力なら同じバイト列になる
"""
import gzip
import os
import sys


def build(project_dir):
    src = os.path.abspath(os.path.join(project_dir, "..", "app", "index.html"))
    dst_dir = os.path.join(project_dir, "data")
    dst = os.path.join(dst_dir, "index.html.gz")
    if not os.path.exists(src):
        print("build_fs: %s がありません（アプリ未配置）。LittleFS は空のままになります" % src)
        return None
    with open(src, "rb") as f:
        raw = f.read()
    os.makedirs(dst_dir, exist_ok=True)
    with open(dst, "wb") as out:
        with gzip.GzipFile(filename="", mode="wb", fileobj=out, compresslevel=9, mtime=0) as g:
            g.write(raw)
    print("build_fs: %s (%d bytes) -> %s (%d bytes)" % (os.path.relpath(src), len(raw), os.path.relpath(dst), os.path.getsize(dst)))
    return dst


try:
    Import("env")  # noqa: F821  PlatformIO から呼ばれたとき
    build(env["PROJECT_DIR"])  # noqa: F821
except NameError:
    if __name__ == "__main__":
        here = os.path.dirname(os.path.abspath(__file__))
        build(os.path.dirname(here))

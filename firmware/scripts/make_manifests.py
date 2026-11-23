#!/usr/bin/env python3
"""docs/flash/firmware/<env>/flashparts.json から ESP Web Tools の manifest を作る（SPEC 9.6）。

  python3 firmware/scripts/make_manifests.py <リポジトリのルート>

- manifest.json        : MAX31855 版（xiao_c3 = ESP32-C3 / esp32dev = ESP32）
- manifest-31856.json  : MAX31856 版（xiao_c3_31856 = ESP32-C3）
- parts は bootloader / パーティション表 / boot_app0 / app / LittleFS の 5 つ。NVS の領域には書かない。
- flashparts.json が無い env は、既存の manifest の build を残す。
"""
import json
import os
import re
import sys

root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
flash = os.path.join(root, "docs", "flash")
ver = re.search(r'#define FW_VERSION "([^"]+)"', open(os.path.join(root, "firmware", "include", "config.h"), encoding="utf-8").read()).group(1)
FAMILY = {"esp32": "ESP32", "esp32c3": "ESP32-C3"}

MANIFESTS = {
    "manifest.json": ("焙煎記録ノート（MAX31855 版）", ["xiao_c3", "esp32dev"]),
    "manifest-31856.json": ("焙煎記録ノート（MAX31856 版）", ["xiao_c3_31856"]),
}


def build_for(env):
    p = os.path.join(flash, "firmware", env, "flashparts.json")
    if not os.path.exists(p):
        return None
    info = json.load(open(p, encoding="utf-8"))
    return {
        "chipFamily": FAMILY[info["chip"]],
        "parts": [{"path": "firmware/%s/%s" % (env, x["file"]), "offset": x["offset"]} for x in info["parts"]],
    }


for fn, (name, envs) in MANIFESTS.items():
    path = os.path.join(flash, fn)
    old = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {"builds": []}
    builds = []
    for env in envs:
        b = build_for(env)
        if b is None:
            # この env は今回作っていない。既存の build（同じ env の path を持つもの）を残す
            builds += [x for x in old.get("builds", []) if any("firmware/%s/" % env in p["path"] for p in x["parts"])]
        else:
            builds.append(b)
    m = {"name": name, "version": ver, "new_install_prompt_erase": False, "builds": builds}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("manifest:", fn, "version", ver, "builds", [b["chipFamily"] for b in builds])

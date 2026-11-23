#!/usr/bin/env python3
"""docs/HARDWARE.md を docs/flash/hardware.html にする（SPEC 9.6）。

書き込みページ（GitHub Pages の /docs 以下）から、組み立て手順を開けるようにするため。
.md への相対リンクは Pages では開けない（Jekyll の設定しだい）ので、HTML にして同じ場所に置く。
外部ライブラリは使わない。使える書き方: 見出し(#)、表(|)、箇条書き(- / 1.)、コードブロック(```)、**太字**、`コード`、[リンク](url)、---

  python3 firmware/scripts/md_to_html.py <リポジトリのルート>
"""
import hashlib
import html
import os
import re
import sys

root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
src = os.path.join(root, "docs", "HARDWARE.md")
dst = os.path.join(root, "docs", "flash", "hardware.html")
text = open(src, encoding="utf-8").read()
digest = hashlib.sha256(text.encode("utf-8")).hexdigest()


def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r"`([^`]+)`", lambda m: "<code>%s</code>" % m.group(1), s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", lambda m: '<a href="%s">%s</a>' % (m.group(2).replace(".md", ".html") if m.group(2).startswith("..") else m.group(2), m.group(1)), s)
    return s


def anchor(t):
    return re.sub(r"[^\w぀-ヿ一-鿿-]+", "-", t).strip("-")


out, lines, i = [], text.split("\n"), 0
title = "組み立て"
while i < len(lines):
    ln = lines[i]
    if ln.startswith("```"):
        i += 1; buf = []
        while i < len(lines) and not lines[i].startswith("```"):
            buf.append(lines[i]); i += 1
        out.append("<pre>%s</pre>" % html.escape("\n".join(buf)))
        i += 1; continue
    m = re.match(r"^(#{1,4}) (.*)$", ln)
    if m:
        n = len(m.group(1)); t = m.group(2)
        if n == 1: title = t
        out.append('<h%d id="%s">%s</h%d>' % (n, anchor(t), inline(t), n)); i += 1; continue
    if ln.strip() == "---":
        out.append("<hr>"); i += 1; continue
    if ln.startswith("|"):
        rows = []
        while i < len(lines) and lines[i].startswith("|"):
            rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")]); i += 1
        head, body = rows[0], [r for r in rows[2:]] if len(rows) > 1 and set("".join(rows[1])) <= set("-: ") else rows[1:]
        t = "<table><thead><tr>%s</tr></thead><tbody>" % "".join("<th>%s</th>" % inline(c) for c in head)
        for r in body: t += "<tr>%s</tr>" % "".join("<td>%s</td>" % inline(c) for c in r)
        out.append(t + "</tbody></table>"); continue
    m = re.match(r"^(\s*)([-*]|\d+\.) (.*)$", ln)
    if m:
        ordered = m.group(2)[0].isdigit(); tag = "ol" if ordered else "ul"
        items = []
        while i < len(lines):
            m2 = re.match(r"^(\s*)([-*]|\d+\.) (.*)$", lines[i])
            if m2 and not m2.group(1):
                body = m2.group(3); i += 1
                while i < len(lines) and lines[i].startswith("  ") and lines[i].strip() and not re.match(r"^\s+([-*]|\d+\.) ", lines[i]):
                    body += " " + lines[i].strip(); i += 1
                sub = []
                while i < len(lines) and re.match(r"^\s+([-*]|\d+\.) (.*)$", lines[i]):
                    sub.append(re.match(r"^\s+([-*]|\d+\.) (.*)$", lines[i]).group(2)); i += 1
                li = inline(body)
                if sub: li += "<ul>%s</ul>" % "".join("<li>%s</li>" % inline(x) for x in sub)
                items.append("<li>%s</li>" % li)
            else:
                break
        out.append("<%s>%s</%s>" % (tag, "".join(items), tag)); continue
    if ln.strip() == "":
        i += 1; continue
    buf = [ln]; i += 1
    while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\||```|---$|\s*([-*]|\d+\.) )", lines[i]):
        buf.append(lines[i]); i += 1
    out.append("<p>%s</p>" % inline(" ".join(x.strip() for x in buf)))

page = """<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>%(title)s - 焙煎記録ノート</title>
<!-- source-sha256: %(sha)s（docs/HARDWARE.md から firmware/scripts/md_to_html.py で作る。直接は編集しない） -->
<style>
:root{--bg:#111;--fg:#f4f4f4;--sub:#b5b5b5;--line:#3a3a3a;--tl:#c2410c;--warn:#fbbf24}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.75 -apple-system,"Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif}
main{max-width:52rem;margin:0 auto;padding:1rem 1rem 4rem}
h1{font-size:1.5rem;border-bottom:4px solid var(--tl);padding-bottom:.4rem}
h2{font-size:1.2rem;margin-top:2.2rem;padding-left:.6rem;border-left:6px solid var(--tl)}
h3{font-size:1.05rem;margin-top:1.6rem}
h4{font-size:1rem;margin-top:1.2rem;color:var(--warn)}
table{border-collapse:collapse;width:100%%;margin:1rem 0;font-size:.92rem}
th,td{border:1px solid var(--line);padding:.35rem .5rem;text-align:left;vertical-align:top}
th{background:#1d1d1d}
code{background:#222;padding:0 .3rem;border-radius:3px}
pre{background:#1a1a1a;border:1px solid var(--line);padding:.8rem;overflow:auto;font:13px/1.35 ui-monospace,Menlo,Consolas,monospace}
a{color:var(--warn)}
hr{border:0;border-top:1px solid var(--line);margin:2rem 0}
li{margin:.25rem 0}
</style></head><body><main>
<p><a href="index.html">← 書き込みページにもどる</a></p>
%(body)s
<p><a href="index.html">← 書き込みページにもどる</a></p>
</main></body></html>
""" % {"title": html.escape(title), "sha": digest, "body": "\n".join(out)}
open(dst, "w", encoding="utf-8").write(page)
print("md_to_html: %s -> %s" % (os.path.relpath(src, root), os.path.relpath(dst, root)))

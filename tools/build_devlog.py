#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""开发日记静态生成器：devlog/src/*.md → devlog/<slug>.html + 索引页。

    python3 tools/build_devlog.py       # 或 make devlog

为什么自己写 Markdown 转换而不用第三方库：GitHub Pages 直接托管静态文件，
本仓库不引入任何依赖，clone 下来 python3 一跑就出结果。支持的语法见 md_to_html()。

为什么值得写开发日记：对 GEO 来说，长文是**被引用的主要素材**。
产品页只能回答"它是什么"，开发日记能回答"为什么这么做""踩过什么坑"——
后者才是 AI 在回答开放问题时会引用的内容。

新增一篇：
    1. Markdown 放进 devlog/src/，文件名即 slug（如 03-zero-servers.md）
    2. 顶部写 frontmatter
    3. 跑本脚本，提交生成的 html

frontmatter 字段：
    title    标题（必填）
    date     日期，索引页按 order 排序、date 仅展示
    summary  摘要，同时用作 meta description 与 og:description
    tags     逗号分隔
    lang     语言 code，需与 site.config.json 的 locales 对应（默认取第一个）
    order    索引页排序，数字小的在前
    status   published（默认）| draft —— draft 会生成页面但不进索引
"""

import html as _html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "devlog", "src")
OUT = os.path.join(ROOT, "devlog")

with open(os.path.join(ROOT, "site.config.json"), encoding="utf-8") as f:
    CONF = json.load(f)
SITE = CONF["site"]
DOMAIN = SITE["domain"].rstrip("/")
LOCALES = CONF["locales"]["list"]
DEFAULT_LANG = LOCALES[0]["code"]

STR = {
    "zh-CN": {"kicker": "开发日记", "index_h1": "开发日记", "back": "← 全部开发日记",
              "home": "首页", "next": "下一篇", "prev": "上一篇", "draft": "草稿"},
    "en": {"kicker": "Devlog", "index_h1": "Devlog", "back": "← All posts",
           "home": "Home", "next": "Next", "prev": "Previous", "draft": "Draft"},
}


def s(lang, key):
    return STR.get(lang, STR["en"]).get(key, key)


def t(v, lang, fallback=""):
    """site.config.json 里面向用户的文本可以写成 {lang: text}（见 gen_geo.py 的 t）。
    这里按语言取，取不到退回配置里的第一门语言；裸字符串原样返回。"""
    if not isinstance(v, dict):
        return v or fallback
    return v.get(lang) or next(iter(v.values()), fallback)


def suffix_of(lang):
    for l in LOCALES:
        if l["code"] == lang:
            return l["suffix"]
    return ""


# ── Markdown 子集 ───────────────────────────────────────────────────
def inline(t: str) -> str:
    t = _html.escape(t)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', t)
    return t


def md_to_html(md: str) -> str:
    out, i = [], 0
    lines = md.split("\n")
    while i < len(lines):
        line = lines[i]

        if line.startswith("```"):                       # 代码块
            lang = line[3:].strip()
            i += 1
            buf = []
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(lines[i]); i += 1
            i += 1
            cls = f' class="lang-{lang}"' if lang else ""
            out.append(f"<pre><code{cls}>{_html.escape(chr(10).join(buf))}</code></pre>")
            continue

        if re.match(r"^#{1,4} ", line):                   # 标题
            lvl = len(line) - len(line.lstrip("#"))
            text = line[lvl:].strip()
            anchor = re.sub(r"[^\w\u4e00-\u9fff]+", "-", text.lower()).strip("-")
            out.append(f'<h{lvl} id="{anchor}">{inline(text)}</h{lvl}>')
            i += 1
            continue

        if re.match(r"^(---|\*\*\*)\s*$", line):          # 分隔线
            out.append("<hr>"); i += 1; continue

        if line.startswith("> "):                         # 引用
            buf = []
            while i < len(lines) and lines[i].startswith(">"):
                buf.append(lines[i].lstrip(">").strip()); i += 1
            out.append("<blockquote>" + inline(" ".join(buf)) + "</blockquote>")
            continue

        if re.match(r"^\s*[-*] ", line):                  # 无序列表
            buf = []
            while i < len(lines) and re.match(r"^\s*[-*] ", lines[i]):
                buf.append(inline(re.sub(r"^\s*[-*] ", "", lines[i]))); i += 1
            out.append("<ul>" + "".join(f"<li>{x}</li>" for x in buf) + "</ul>")
            continue

        if re.match(r"^\s*\d+\. ", line):                 # 有序列表
            buf = []
            while i < len(lines) and re.match(r"^\s*\d+\. ", lines[i]):
                buf.append(inline(re.sub(r"^\s*\d+\. ", "", lines[i]))); i += 1
            out.append("<ol>" + "".join(f"<li>{x}</li>" for x in buf) + "</ol>")
            continue

        if line.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:\-|]+\|$", lines[i + 1]):
            rows = []                                     # 表格
            while i < len(lines) and lines[i].startswith("|"):
                rows.append([c.strip() for c in lines[i].strip("|").split("|")]); i += 1
            head, body = rows[0], rows[2:]
            th = "".join(f"<th>{inline(c)}</th>" for c in head)
            tb = "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in body)
            out.append(f"<div class='table-wrap'><table><thead><tr>{th}</tr></thead><tbody>{tb}</tbody></table></div>")
            continue

        if line.strip() == "":
            i += 1; continue

        buf = []                                          # 段落
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,4} |```|> |\||\s*[-*] |\s*\d+\. |---)", lines[i]):
            buf.append(lines[i].strip()); i += 1
        out.append("<p>" + inline(" ".join(buf)) + "</p>")

    return "\n".join(out)


def parse(path):
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    meta, body = {}, raw
    if raw.startswith("---"):
        parts = raw.split("---", 2)
        if len(parts) >= 3:
            for line in parts[1].strip().split("\n"):
                if ":" in line:
                    k, v = line.split(":", 1)
                    meta[k.strip()] = v.strip()
            body = parts[2]
    meta.setdefault("lang", DEFAULT_LANG)
    meta.setdefault("status", "published")
    meta.setdefault("order", "999")
    meta["slug"] = os.path.splitext(os.path.basename(path))[0]
    meta["html"] = md_to_html(body)
    return meta


# ── 页面模板 ────────────────────────────────────────────────────────
def shell(lang, title, desc, canonical, body, extra_ld=None):
    ld = {
        "@context": "https://schema.org",
        "@type": "BlogPosting" if extra_ld else "CollectionPage",
        "headline": title,
        "description": desc,
        "url": canonical,
        "inLanguage": lang,
        "publisher": {"@type": "Organization", "name": t(SITE["name"], lang)},
    }
    if extra_ld:
        ld.update(extra_ld)
    return f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="../{SITE.get('icon', 'icon.png')}">
<title>{_html.escape(title)} · {_html.escape(t(SITE['name'], lang))}</title>
<meta name="description" content="{_html.escape(desc)}">
<link rel="canonical" href="{canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="{_html.escape(title)}">
<meta property="og:description" content="{_html.escape(desc)}">
<meta property="og:url" content="{canonical}">
<link rel="stylesheet" href="../style.css">
<script type="application/ld+json">
{json.dumps(ld, ensure_ascii=False, indent=2)}
</script>
</head>
<body>
<nav class="wrap"><a class="brand" href="../index{suffix_of(lang)}.html">{_html.escape(t(SITE['name'], lang))}</a>
  <a href="../devlog{suffix_of(lang)}.html">{s(lang, 'kicker')}</a></nav>
<main class="wrap prose">
{body}
</main>
<footer class="wrap"><p>© {SITE.get('author', {}).get('name', '')}</p></footer>
</body>
</html>
"""


def build():
    if not os.path.isdir(SRC):
        sys.exit(f"❌ 没有 {SRC}/ —— 把 Markdown 放进去再跑")
    posts = [parse(os.path.join(SRC, f)) for f in sorted(os.listdir(SRC)) if f.endswith(".md")]
    if not posts:
        print("（devlog/src/ 里还没有文章）")
        return

    os.makedirs(OUT, exist_ok=True)
    by_lang = {}
    for p in posts:
        by_lang.setdefault(p["lang"], []).append(p)

    for lang, group in by_lang.items():
        group.sort(key=lambda p: int(p.get("order", 999)))
        published = [p for p in group if p["status"] == "published"]

        for idx, p in enumerate(group):
            canonical = f"{DOMAIN}/devlog/{p['slug']}.html"
            nav = []
            if p in published:
                i = published.index(p)
                if i > 0:
                    nav.append(f'<a href="{published[i-1]["slug"]}.html">← {s(lang,"prev")}</a>')
                if i < len(published) - 1:
                    nav.append(f'<a href="{published[i+1]["slug"]}.html">{s(lang,"next")} →</a>')
            draft_badge = f'<p class="badge">{s(lang, "draft")}</p>' if p["status"] != "published" else ""
            body = (f'<p class="kicker">{s(lang,"kicker")} · {p.get("date","")}</p>'
                    f'{draft_badge}<h1>{_html.escape(p["title"])}</h1>'
                    f'<p class="lead">{_html.escape(p.get("summary",""))}</p>'
                    f'{p["html"]}'
                    f'<p class="pager">{" · ".join(nav)}</p>'
                    f'<p><a href="../devlog{suffix_of(lang)}.html">{s(lang,"back")}</a></p>')
            with open(os.path.join(OUT, f"{p['slug']}.html"), "w", encoding="utf-8") as f:
                f.write(shell(lang, p["title"], p.get("summary", ""), canonical, body,
                              extra_ld={"datePublished": p.get("date", ""),
                                        "keywords": p.get("tags", "")}))
            print(f"  ✎ devlog/{p['slug']}.html")

        items = "".join(
            f'<li><a href="devlog/{p["slug"]}.html"><span class="d">{p.get("date","")}</span>'
            f'<strong>{_html.escape(p["title"])}</strong>'
            f'<span class="s">{_html.escape(p.get("summary",""))}</span></a></li>'
            for p in published)
        idx_body = (f'<h1>{s(lang,"index_h1")}</h1>'
                    f'<ul class="postlist">{items}</ul>')
        idx_name = f"devlog{suffix_of(lang)}.html"
        idx_html = shell(lang, s(lang, "index_h1"),
                         t(SITE["description"], lang), f"{DOMAIN}/{idx_name}", idx_body)
        # 索引页在根目录，相对路径要少一层
        idx_html = idx_html.replace('href="../', 'href="').replace('src="../', 'src="')
        with open(os.path.join(ROOT, idx_name), "w", encoding="utf-8") as f:
            f.write(idx_html)
        print(f"  ✎ {idx_name}（{len(published)} 篇，{len(group)-len(published)} 篇草稿）")


if __name__ == "__main__":
    print("── 生成开发日记 ──")
    build()
    print("\n✅ 完成。记得跑 make geo 更新 sitemap 与 llms.txt。")

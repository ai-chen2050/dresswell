#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GEO 一致性体检。

    python3 tools/geo_check.py      # 或 make geo-check

检查的是**会让 AI 少引用你或引用错**的那些问题：
  1. JSON-LD 能不能被解析（解析失败 = 结构化数据完全无效，但页面看起来正常）
  2. canonical / hreflang 是否齐全、是否互指
  3. llms.txt / sitemap 里的链接是否都存在
  4. robots.txt 有没有把 AI 抓取方挡在外面
  5. 各页 title / description 是否缺失或重复
  6. 配置里是否还留着占位文本（example.com、"关键词1"、空 FAQ 答案）

退出码 1 表示有 error。warning 不阻塞。
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
errors, warns = [], []


def err(m): errors.append(m)
def warn(m): warns.append(m)


def html_files():
    return sorted(f for f in os.listdir(ROOT) if f.endswith(".html"))


def read(p):
    with open(os.path.join(ROOT, p), encoding="utf-8") as f:
        return f.read()


def vals(v):
    """面向用户的文本可能写成 {lang: text}（见 gen_geo.py 的 t）。
    统一摊平成字符串列表，好逐门语言检查 —— 只查默认语言的话，
    英文那份缺了或者留着占位符都查不出来。"""
    if isinstance(v, dict):
        return [x for x in v.values() if isinstance(x, str)]
    return [v] if isinstance(v, str) else []


def any_blank(v):
    got = vals(v)
    return (not got) or any(not x.strip() for x in got)


def check_config():
    p = os.path.join(ROOT, "site.config.json")
    if not os.path.exists(p):
        err("缺 site.config.json")
        return None
    with open(p, encoding="utf-8") as f:
        conf = json.load(f)
    s = conf.get("site", {})
    if "example.com" in s.get("domain", ""):
        err("site.domain 还是 example.com —— canonical/sitemap/llms.txt 全部指向错误地址")
    if any_blank(s.get("description")):
        err("site.description 为空（或缺某门语言）—— 这是 AI 摘要你的主要素材")
    for i, f in enumerate(conf.get("faq", [])):
        if f.get("q") and any_blank(f.get("a")):
            err(f"faq[{i}] 「{vals(f['q'])[0] if vals(f['q']) else i}」缺答案"
                f"（或缺某门语言）—— 空答案会进 JSON-LD，是负面信号")
    kw = conf.get("keywords", [])
    kw_all = [k for v in kw.values() for k in v] if isinstance(kw, dict) else kw
    if any("关键词" in k for k in kw_all):
        warn("keywords 里还有占位文本")
    for f in conf.get("features", []):
        if f.get("name") and any_blank(f.get("detail")) and any_blank(f.get("summary")):
            warn(f"功能「{vals(f['name'])[0]}」没有描述，llms-full.txt 里会是空条目")
    return conf


def check_pages(conf):
    titles, descs = {}, {}
    for fn in html_files():
        h = read(fn)

        m = re.search(r"<title>(.*?)</title>", h, re.S)
        if not m or not m.group(1).strip():
            err(f"{fn}: 缺 <title>")
        else:
            titles.setdefault(m.group(1).strip(), []).append(fn)

        m = re.search(r'<meta\s+name="description"\s+content="(.*?)"', h, re.S)
        if not m or not m.group(1).strip():
            err(f"{fn}: 缺 meta description")
        else:
            descs.setdefault(m.group(1).strip(), []).append(fn)

        if not re.search(r'<link\s+rel="canonical"', h):
            err(f"{fn}: 缺 canonical")
        if not re.search(r'<link\s+rel="alternate"\s+hreflang=', h):
            warn(f"{fn}: 没有 hreflang（单语站可忽略）")
        if not re.search(r'<html[^>]+lang=', h):
            err(f"{fn}: <html> 缺 lang 属性")

        for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', h, re.S):
            try:
                data = json.loads(m.group(1))
            except json.JSONDecodeError as e:
                err(f"{fn}: JSON-LD 解析失败（{e}）—— 结构化数据完全无效")
                continue
            graph = data.get("@graph", [data])
            for node in graph:
                if not node.get("@type"):
                    err(f"{fn}: JSON-LD 有节点缺 @type")
                if node.get("@type") == "FAQPage":
                    for q in node.get("mainEntity", []):
                        if not q.get("acceptedAnswer", {}).get("text", "").strip():
                            err(f"{fn}: FAQ「{q.get('name','?')}」答案为空")

        if "GEO:AUTO START" not in h and not fn.startswith("devlog"):
            warn(f"{fn}: 没有 GEO:AUTO 标记，gen_geo.py 不会维护它的 head")

    for txt, files in titles.items():
        if len(files) > 1:
            warn(f"title 重复：{files} —— 各页 title 应当各不相同")
    for txt, files in descs.items():
        if len(files) > 1:
            warn(f"description 重复：{files}")


def check_link_files():
    for name in ("llms.txt", "llms-full.txt", "sitemap.xml", "robots.txt"):
        if not os.path.exists(os.path.join(ROOT, name)):
            err(f"缺 {name} —— 跑 make geo 生成")

    if os.path.exists(os.path.join(ROOT, "robots.txt")):
        r = read("robots.txt")
        for agent in ("GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"):
            if agent not in r:
                warn(f"robots.txt 没有显式规则：{agent}")
        if re.search(r"^Disallow:\s*/\s*$", r, re.M):
            err("robots.txt 里有 `Disallow: /` —— 整站被挡")
        if "Sitemap:" not in r:
            err("robots.txt 缺 Sitemap 指向")

    # llms.txt / sitemap 里指向本站的链接必须真实存在
    for name in ("llms.txt", "sitemap.xml"):
        p = os.path.join(ROOT, name)
        if not os.path.exists(p):
            continue
        for url in re.findall(r"https?://[^\s\)\"'<>]+", read(name)):
            fn = url.rstrip("/").split("/")[-1]
            if fn.endswith((".html", ".txt")) and not os.path.exists(os.path.join(ROOT, fn)):
                err(f"{name}: 指向不存在的文件 {fn}")


def check_pages_exist(conf):
    if not conf:
        return
    for page in conf.get("pages", []):
        found = [f"{page['file']}{l['suffix']}.html" for l in conf["locales"]["list"]
                 if os.path.exists(os.path.join(ROOT, f"{page['file']}{l['suffix']}.html"))]
        if not found:
            warn(f"配置里有页面 '{page['file']}' 但一个语言版本都不存在")


def main():
    conf = check_config()
    check_pages(conf)
    check_link_files()
    check_pages_exist(conf)

    for w in warns:
        print(f"  ⚠ {w}")
    for e in errors:
        print(f"  ✗ {e}")

    if errors:
        print(f"\n❌ {len(errors)} 个问题（{len(warns)} 个提示）")
        sys.exit(1)
    print(f"\n✅ GEO 体检通过" + (f"（{len(warns)} 个提示）" if warns else ""))


if __name__ == "__main__":
    main()

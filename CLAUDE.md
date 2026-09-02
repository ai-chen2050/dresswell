# CLAUDE.md

穿好衣 官网 —— GitHub Pages 托管的纯静态站点，内建 GEO（生成式引擎优化）。

## 核心约束：唯一真相源

`site.config.json` 是产品信息的唯一真相源。下面这些文件**全部是生成物，不要手改**：

```
llms.txt        llms-full.txt      sitemap.xml     robots.txt
各 *.html 中 <!-- GEO:AUTO START/END --> 之间的内容
devlog/*.html   devlog*.html（由 devlog/src/*.md 生成）
```

手改它们的后果不是报错，是**下次 `make build` 时被静默覆盖**，
而你以为改生效了。

## 常用命令

```bash
make build        # devlog + geo，全量重建
make geo          # 只重建 GEO 层
make geo-check    # 一致性体检（推送前必跑）
make devlog       # devlog/src/*.md → html
make serve        # 本地预览 http://localhost:4000
make deploy       # 体检通过后提交并推送
```

## 目录

```
site.config.json          唯一真相源
index.html / index.en.html    首页（各语言）
geo.html   / geo.en.html      AI 知识库 + FAQ（GEO 主战场）
privacy.html support.html     商店要求的两个 URL
devlog/src/*.md               开发日记源文件
tools/gen_geo.py              GEO 层生成器
tools/build_devlog.py         开发日记生成器
tools/geo_check.py            体检
.github/workflows/pages.yml   推送即发布；CI 会校验生成物是否最新
```

## 写作口径

- **事实密度 > 形容词密度**。模型引用可核实的陈述，不引用形容词。
- **页面可见文本必须与 JSON-LD 一致**。FAQ 尤其：结构化数据里有的，页面上要真的能看到。
- **诚实写边界**（"不适合谁""做不到什么"）。这会提高可信度，不是自曝其短。
- 英文版**重写**而不是直译 —— 中文的排比在英文里读起来很怪。
- 各页 title / description 必须各不相同（`geo-check` 会查重）。

## 与产品仓库的联动

**产品发版 = 官网必须同步。** 应用改了功能而官网没改，会让 AI 引用过时信息，
比没被引用更糟。发版流程里已经写了这一步（产品仓的 `release-check` 技能）。

同步内容：`site.config.json` 的 features / faq → 各页可见文本 → 写一篇开发日记 →
`make build && make geo-check && make deploy`。

## 部署

GitHub Pages + Actions。首次启用：仓库 Settings → Pages → Source 选 "GitHub Actions"。

CI 会重跑生成器并比对 —— 如果你改了 `site.config.json` 却没跑 `make build`，
CI 直接失败。这是刻意的：防止线上内容与配置脱节。

## 技能

- `.claude/skills/site-geo/` —— GEO 的完整方法论：什么有效、怎么验证、常见错误
- `.claude/skills/design-handoff/` —— 站点视觉改版走这个流程

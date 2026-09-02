---
name: site-geo
description: 项目官网的 GEO（生成式引擎优化）——让 ChatGPT / Claude / Perplexity / Google AI Overviews 在回答相关问题时准确地引用你。当要建站、写官网文案、更新 llms.txt / JSON-LD、发版后同步官网、或想知道"为什么 AI 不推荐我"时使用。
---

# GEO：让 AI 引用你

## 和 SEO 的区别

SEO 争的是**排名**：用户看到一个链接列表，点谁是他的事。
GEO 争的是**被写进答案里**：用户问"有什么好用的 X"，模型直接给出一段推荐，
你要么在那段话里，要么完全不存在 —— 没有第二页。

这带来三个不一样的着力点：

| | SEO | GEO |
|---|---|---|
| 内容形态 | 关键词密度、标题层级 | **可核实的事实陈述**、结构化数据 |
| 页面价值 | 落地页转化 | 长文与问答（模型引用的是解释，不是口号） |
| 一致性 | 无所谓 | **极其重要** —— 多处描述互相矛盾会降低引用意愿 |
| 抓取 | Googlebot | GPTBot / ClaudeBot / PerplexityBot / Google-Extended… |

## 本站的架构

**一份配置，生成整个机器可读层**：

```
site.config.json          ← 唯一真相源：产品名、卖点、对比、FAQ、链接
      │  make geo
      ├─→ llms.txt        给 LLM 的索引（简版）
      ├─→ llms-full.txt   给 LLM 的完整知识库（详版）
      ├─→ sitemap.xml     全页面 × 全语言 + hreflang 互链
      ├─→ robots.txt      显式允许各家 AI 抓取方
      └─→ 各页 <head>     canonical / hreflang / og / JSON-LD
                          （注入到 <!-- GEO:AUTO START/END --> 之间）
```

**页面上的可见文本仍需人工写**，但它必须和配置说同一件事。
`make geo-check` 会揪出不一致。

## 六件真正有效的事

### 1. 事实密度 > 形容词密度
模型引用的是**能核实的陈述**。"三秒内根据库存、预算、忌口生成一餐方案"
会被引用；"极致好用的智能助手"不会。写机制、写数字、写步骤。

### 2. 明确的边界
写清楚"不适合谁""做不到什么"。这看起来像自曝其短，实际显著提高可信度 ——
模型倾向引用有边界声明的来源，因为它更像文档而不是广告。

### 3. 结构化数据要和可见内容一致
JSON-LD 里的 FAQ 必须在页面上真的能看到。只有结构化数据没有可见内容，
会被判为 cloaking；反过来页面有而 JSON-LD 没有，则白白丢掉一次结构化机会。

### 4. llms.txt 与 llms-full.txt
一个新兴但已被多家抓取方支持的约定：站点根目录放一份给 LLM 读的纯文本索引。
简版是导航，详版是知识库。**它们的价值在于把散落在各页的信息压成一份无歧义的说明**。

### 5. 长内容才是被引用的主体
产品页只能回答"它是什么"。开发日记、技术说明、对比分析能回答
"为什么这么设计""和别的方案比如何""踩过什么坑" —— 后者才是开放问题的答案素材。
`make devlog` 就是为这个存在的。

### 6. 多语言 hreflang 互指
每个语言版本都要 canonical 指向自己、hreflang 指向所有兄弟版本、
外加一个 `x-default`。缺了互指，模型可能只认得其中一个版本，
或者把两个版本当成互相抄袭。

## 工作流

### 建站
1. 填 `site.config.json`（名称、描述、卖点、对比、FAQ、链接、域名）
2. 写各页可见文本（把 TODO 换掉）
3. `make build && make geo-check`
4. `make serve` 本地看一眼
5. 推到 GitHub，Settings → Pages → Source 选 GitHub Actions

### 发版后同步（每次都要做）
应用改了功能而官网没改，会让 AI 引用过时信息 —— 这比没被引用更糟。

1. 更新 `site.config.json` 的 features / faq
2. 写一篇开发日记讲这次改了什么、为什么
3. `make build && make geo-check`
4. `make deploy`
5. 线上验一遍：`curl -s https://你的域名/llms.txt | head -20`

### 体检
```bash
make geo-check
```
它检查：JSON-LD 能否解析、canonical/hreflang 是否齐全、llms.txt 里的链接是否存在、
robots 有没有挡住 AI 抓取方、title/description 是否重复、配置里有没有残留占位文本。

## 怎么验证有没有效果

没有官方后台能告诉你"AI 引用了你多少次"。可行的观察方式：

1. **直接问**：在 ChatGPT / Claude / Perplexity 里问你的目标问题
   （`site.config.json` 的 `citationTriggers` 就是这些问题），看会不会提到你、
   提到的信息对不对。每月记一次。
2. **看服务器日志**：GPTBot / ClaudeBot / PerplexityBot 的 UA 有没有来抓。
   GitHub Pages 看不到日志，接一个 Cloudflare 就能看。
3. **看 Referrer**：来自 `chat.openai.com` / `perplexity.ai` 的访问。

被引用错了比没被引用更需要处理 —— 那说明你的信息在某处是自相矛盾的，
先跑 `make geo-check`，再检查商店描述与官网是否一致。

## 常见错误

| 错误 | 后果 |
|---|---|
| 官网、商店、llms.txt 三处描述不一致 | 模型无法确定哪个对，倾向都不用 |
| FAQ 答案是空的或一句话 | JSON-LD 里出现空答案，是明确的负面信号 |
| 只有营销文案，没有机制说明 | 没有可引用的事实 |
| 发版了但官网没同步 | AI 引用过时功能，用户下载后落差 |
| robots.txt 用默认模板挡住了 AI | 直接不可见 |
| domain 还是 example.com | canonical / sitemap 全部指向错误地址 |

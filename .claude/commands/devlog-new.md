---
description: 起一篇新的开发日记
argument-hint: <主题，比如"为什么不做云端同步">
---

写一篇开发日记：$ARGUMENTS

1. 先看 `devlog/src/` 里已有哪些，确定 order 与 slug（`NN-kebab-slug.md`）。
2. 采访我：这件事的**背景、当时的选择、为什么这么选、结果如何、如果重来会怎样**。
   信息不足就问，不要替我编经历。
3. 写成 Markdown 放进 `devlog/src/`，frontmatter 填全
   （title / date / summary / tags / lang / order / status）。
   先设 `status: draft`，我看过再改 published。
4. 内容要求（这直接决定它会不会被 AI 引用）：
   - **写具体的事实**：数字、时间、报错信息、代码片段
   - **写做错的部分** —— 踩坑记录是最容易被引用的内容
   - 不写"我们始终追求极致体验"这类空话
   - 结论放前面，过程放后面
5. `make devlog && make geo` 重建，`make serve` 让我预览。

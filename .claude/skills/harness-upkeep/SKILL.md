---
name: harness-upkeep
description: 维护本仓库的 AI 协作上下文（CLAUDE.md / AGENTS.md / .claude/rules / docs）。当踩到一个坑并修好、当某条约定被违反了第二次、当有人问"这个规则该写哪"、或当 CLAUDE.md 与代码实际不符时使用。
---

# Harness 维护

上下文文档的价值 = **省掉的重复解释次数**。它不是项目介绍，是"不看就会写错的东西"。

## 决策表：一条知识该写到哪

| 知识形态 | 去处 |
|---|---|
| 全局背景、命令、架构骨架、平台坑 | `CLAUDE.md`（同步一份 `AGENTS.md`，内容一致） |
| 只在特定目录成立的写码约束 | `.claude/rules/<topic>.md`，带 frontmatter `paths:` |
| 需要多轮流程的操作（发版、导设计稿、编插件） | `.claude/skills/<name>/SKILL.md` |
| 一句话就能触发的固定动作 | `.claude/commands/<name>.md`（斜杠命令） |
| 长篇的一次性参考（上架手册、定价、法务口径） | `docs/*.md`，并在 CLAUDE.md 里留一行索引 |
| 为什么某个数值是这样 | `CHANGELOG.md`（带日期），CLAUDE.md 里指过去 |
| 跨项目通用的个人偏好 | 用户级 memory，不进仓库 |

## CLAUDE.md 的写法

好的条目长这样：

> `build-web` 直接写进 `build/`（不是 `build/web/`）—— `serve.py` 和 `build/vercel.json`
> 都按 `build/` 根找产物。改这个要同步改部署配置；曾经因两边不一致炸过（见 CHANGELOG 2026-04-16）。

它有：**事实 + 约束 + 违反的后果 + 溯源**。

坏的条目长这样：

> 本项目使用 Flutter 框架开发，代码结构清晰，遵循最佳实践。

删掉它——模型看得见 pubspec.yaml。

自检：
- 每一条都能回答"不写会出什么错"吗？答不上来就删。
- 有没有和代码矛盾的陈述？（改了架构却没改文档，比没有文档更糟）
- 超过 200 行了吗？超了就把长内容挪进 `docs/`，正文只留一行索引。

## 触发时机

**每次踩坑修复后**，问一句：这个坑下次还会踩吗？会 → 写进对应位置，并在提交信息里带上。
判断标准是"重复成本"：解释过两次的东西，第三次应该由文档承担。

**规则被违反第二次时**，说明它写得不够硬。加一个反例：

```markdown
**错误示范**（Web 下会静默冻结）：
\`\`\`gdscript
tween.tween_callback(func():
    await get_tree().create_timer(0.6).timeout   # 违规：Web GC 会丢掉 await
    _render()
)
\`\`\`
```

对照示例比抽象描述有效得多。

## rules 文件模板

```markdown
---
paths:
  - "lib/features/**"
---

# <领域> 代码规则

- 单条一行，祈使句，能被 grep 验证的优先
- 带上违反后果，或指向坏掉过的那次提交

## 示例
**正确**： ...
**错误**： ...
```

## 定期体检

发版前或每月跑一次：

1. `CLAUDE.md` 里提到的每个文件路径是否还存在？（路径漂移是最常见的腐坏）
2. 命令段落里的命令是否还能跑通？
3. agents / skills 列表与 `.claude/` 下实际文件是否一致？
4. 有没有哪条规则从来没被触发过——是没用，还是没写清？

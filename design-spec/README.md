# design-spec —— 设计的唯一真相源

```
html/            原始 HTML 设计稿，文件名带版本：v1-home.html、v2-home.html
tokens.json      机器可读令牌（颜色/字号/间距/圆角/投影/尺寸）—— 改设计从这里改
DESIGN_SPEC.md   人读规则：全局通则、逐屏结构、动效、大字模式
PATCH.md         本轮迭代的 diff；合入 SPEC 后归档到 history/
history/         历次 PATCH 存档
```

## 工作流

```bash
# 1) 把新设计稿放进 html/，然后在 Claude Code 里：
/design-import design-spec/html/v2-home.html

# 2) 确认令牌与计划后，让它实施；实施只允许读令牌，不允许写字面量色值

# 3) 令牌落到代码（Flutter）：
python3 tool/tokens_to_dart.py     # → lib/core/theme/design_tokens.dart（勿手改）
```

## 硬规矩

1. 代码里**不出现字面量色值**，一律走生成的令牌文件。
2. 每个主题的 `dark` 与 `light` **键集必须完全一致**。
3. 语义色（状态红黄绿、分类色）跨主题不变，放在 `tokens.semantic`。
4. 设计改动先落 tokens.json，再落代码；顺序反了就会出现"代码与设计稿不一致但没人知道哪个对"。

细节见 `.claude/skills/design-handoff/SKILL.md`。

# 第三方技能来源与适配说明

本目录下的这几个技能**不是本脚手架原创**，来自 [emilkowalski/skills](https://github.com/emilkowalski/skills)：

| 技能 | 装在哪 | 做什么 |
|---|---|---|
| `prototype/`（含 `PICKER.md`） | 两类工程 | 同一界面出 N 个方向不同的版本，放切换器里翻着选 |
| `animation-vocabulary/` | 两类工程 | 把"那个弹一下的效果"翻译成精确术语，好跟 AI/设计师沟通 |
| `review-animations/`（含 `STANDARDS.md`） | 两类工程 | 按严格标准审查动效：频次表、缓动、时长、可打断、无障碍 |
| `find-animation-opportunities/` | 两类工程 | 找出真正值得加动效的地方，**以及不该动的地方** |
| `apple-design/` | 仅 Flutter 应用 | Apple 的界面与动效原则（可打断性、弹簧、速度接力、橡皮筋） |

## 没有搬过来的，以及为什么

| 技能 | 原因 |
|---|---|
| `emil-design-eng/` | 674 行，深度绑定 CSS/React（`clip-path`、`@starting-style`、CSS transitions）。放进 Dart/GDScript 工程会主动误导。其中可移植的核心已经蒸馏进 `.claude/rules/ui-code.md` 的「动效手艺」小节 |
| `improve-animations/` | 与 `review-animations` 大幅重叠，且是 Web 代码库审计流程 |
| `pick-ui-library/` | 纯 React 生态选型（sonner / base-ui / vaul 之类），与本技术栈无关 |

想要完整包：`npx skills@latest add emilkowalski/skills`。
**装的时候别把整个 `.claude/` 变成它的 git 克隆** —— 那样你自己的 `agents/` `rules/`
`settings.json` 就没地方放了。放进 `.claude/skills/vendor-*/` 并在 `.gitignore` 里排除它。

## 适配对照（读那几个技能时按这张表翻译）

它们的原则是通用的，代码示例是 CSS/JS。对应关系：

| 原文（Web） | Flutter | Godot |
|---|---|---|
| `transition: transform 200ms ease-out` | `AnimatedContainer` / `TweenAnimationBuilder` + `Curves.easeOut` | `create_tween().set_ease(Tween.EASE_OUT)` |
| 只动 `transform` / `opacity` | 只动 `Transform` / `Opacity`，别用动画改 `width`/`padding`（触发 relayout） | 只动 `modulate` / `scale` / `position`，别动 `custom_minimum_size`（触发容器重排） |
| `transform-origin` | `Transform.scale(alignment:)` | `Control.pivot_offset` |
| spring / 物理动效 | `SpringSimulation`、`flutter_animate` 的 spring | `Tween.TRANS_ELASTIC` / `TRANS_BACK`，或自己积分 |
| 可打断（interruptibility） | 新动画要能从**当前值**接管，别从头播 | `tween.kill()` 后从当前 `modulate`/`scale` 起新 tween |
| `prefers-reduced-motion` | `MediaQuery.of(context).disableAnimations` | 自己提供「减少动态效果」开关并默认尊重系统设置 |
| `@starting-style` / 入场态 | `AnimatedSwitcher` / `initState` 里起首帧 | `_ready()` 里设初值再起 tween |
| 60fps / 掉帧 | `flutter run --profile` + DevTools Performance | 编辑器分析器；Web 端用浏览器 Performance 面板 |
| CSS 变量 / 设计令牌 | `lib/core/theme/design_tokens.dart`（生成物） | `design-spec/tokens.json` → `.tres` Theme |

`prototype/` 技能出的是自包含 HTML 原型 —— 这个**不需要翻译**，
因为本流程本来就用 HTML 当设计稿（见 `design-handoff` 技能的阶段 0）。

## 同步上游

这些文件是**逐字拷贝**的，只在正文顶部加了一行指向本文件的横幅。
要更新时重新拷贝一遍、再把那行横幅补回去即可。

## 许可证

```
MIT License

Copyright (c) 2026 Emil Kowalski

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

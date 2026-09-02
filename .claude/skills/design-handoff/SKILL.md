---
name: design-handoff
description: 把 HTML 设计稿变成可执行的规范与代码。当用户提供 .html 设计稿、要求"按设计稿实现/调整 UI"、要抽取设计令牌（颜色/字号/圆角/间距/投影）、要做多主题或明暗适配、或抱怨"UI 来回改了很多轮"时使用。
---

# 设计稿 → 令牌 → 代码

**这个技能存在的理由**：直接看着 HTML 写 UI 代码，会产生大量"拍脑袋色值"——
同一个绿在五个文件里写成五个近似值，改一次主题要全局搜索。来回迭代的成本
几乎全部来自这里。解法是在设计稿和代码之间强插一层**机器可读的令牌**，
让"改设计"永远是改一个 JSON，而不是改二十个 widget。

## 目录约定

```
design-spec/
├── html/                 # 原始设计稿（AI 生成或手写的 HTML）
│   └── v1-home.html      # 一个文件一屏或一组；文件名带版本号
├── tokens.json           # 唯一真相源：颜色/字号/圆角/间距/投影/尺寸
├── DESIGN_SPEC.md        # 人读的规则：全局通则 + 逐屏结构 + 动效
└── PATCH.md              # 本轮迭代要改什么（改完即清空/归档）
```

代码里生成的令牌文件（`lib/core/theme/design_tokens.*` 或 `assets/theme/*.tres`）
**永远是 tokens.json 的产物，不手改**。

## 五个阶段

### 阶段 0 · 出稿（还没有设计稿时）

**别让"第一版稿"直接变成"唯一的稿"。** 一上来只画一个方向，等实现完才发现方向不对，
返工的是代码而不是 HTML —— 这是来回改的另一个大头。

做法：同一个界面**出 3 个真正不同方向的 HTML 版本**，放在一个自包含的 HTML 文件里
用切换器翻着看，选定一个再往下走。

- 三版必须差在**说得出名字的轴**上（布局 / 信息密度 / 性格 / 交互模型），
  只差配色的三版等于一版，翻着看学不到任何东西。
- 每版都要能真的用（真实交互、真实内容），不要 lorem ipsum 和死按钮。
- 用产品真实文案：真实的人名、金额、长度。中文最长的那条标签决定布局成败。
- 选定后**只保留胜出的那版**进 `design-spec/html/v1.html`，其余归档到 `history/`。

> **工程里已经带了 `/prototype` 技能**（来自 emilkowalski/skills，MIT，
> 见 `.claude/skills/THIRD-PARTY-NOTICES.md`）：它把 N 个版本渲染进一个自包含 HTML，
> 配键盘可切的选择器。直接 `/prototype <描述>`，要五版就 `/prototype <描述> x5`。
> 它出的就是 HTML 原型 —— 对本流程正好，不用再转成别的形态。

动效相关的判断交给配套的两个技能，比自己拍脑袋准：

- `find-animation-opportunities` —— 哪里值得加动效，**以及哪里不该加**
- `animation-vocabulary` —— 把"那个弹一下的效果"翻译成精确术语，好写进 DESIGN_SPEC

### 阶段 1 · 读稿（不写代码）

拿到 HTML 后先回答这些问题，答不上来就问用户，别猜：

- 目标视口是多少？（移动端一般 390×844；游戏一般 1280×720）设计稿里的 px 是否 1:1 映射到实现单位？
- 有几套主题 / 明暗？有没有"长辈模式 / 大字模式"这类全局缩放？
- 哪些是**语义色**（状态色，跨主题不变，如 新鲜/临期/过期 绿黄红），哪些是**主题色**（随主题变）？语义色写死在 tokens 顶层，不进主题分支。
- 装饰性元素（大 emoji、硬投影、渐变）是这套主题独有还是全局？

### 阶段 2 · 抽令牌（产出 tokens.json）

从 HTML 里把每个重复出现的值收敛成命名令牌。判断标准：**出现 2 次以上，或语义明确的，都必须成为令牌**。

```jsonc
{
  "meta":     { "viewport": [390, 844], "source": "design-spec/html/v1-home.html", "updated": "2026-08-04" },
  "semantic": { "fresh": "#2EBD85", "soon": "#F5A524", "expired": "#FF5A5F" },
  "scale":    { "elderTextScale": 1.18, "minTapTarget": 44 },
  "type": {
    "pageTitle":  { "size": 25,   "weight": 800, "letterSpacing": 0.5 },
    "cardTitle":  { "size": 16,   "weight": 800 },
    "body":       { "size": 13.5, "weight": 600 },
    "hintWeak":   { "size": 10.5, "weight": 500 }
  },
  "space":  { "page": 16, "cardPad": 16, "cardGap": 11, "inline": 8, "tile": 7 },
  "size":   { "ctaHeight": 50, "iconButton": 38, "tile": 56, "fabHeight": 48 },
  "radius": { "card": 20, "cta": 15, "tile": 13, "pill": 999 },
  "themes": {
    "A_fresh": {
      "light": {
        "bg": "#F4F6F5", "card": "#FFFFFF",
        "text":  { "primary": "#172821", "body": "#2A3B34", "sub": "#7A8B84", "weak": "#96A49D" },
        "shadow": { "card": "0 4px 16px rgba(26,43,36,.06)" },
        "cta":    { "gradient": ["#2EBD85", "#1B9E86"], "shadow": "0 8px 20px rgba(46,189,133,.32)" }
      },
      "dark": { "bg": "#121418", "card": "#1E2228", "…": "严格逐键映射，不留空" }
    }
  }
}
```

规则：
1. **每个主题的 dark 必须和 light 键集完全一致**，缺一个键就会在暗色下露出白块。写完跑一次键集比对。
2. 颜色一律 `#RRGGBB` 或 `rgba()` 字符串；不要写 `green`、不要写运算式。
3. 投影/渐变按平台可解析的结构存（Flutter 用数组 + 数值，别存 CSS 字符串给自己找麻烦——除非配了解析器）。
4. 文案基调（口语化 vs 克制）若随主题变，存 `copyTone` 字段，别散落在代码里。

### 阶段 3 · 写规范（DESIGN_SPEC.md）

tokens.json 说"值是多少"，DESIGN_SPEC.md 说"什么时候用哪个、怎么排"。结构固定为：

```
0. 全局通则        字体 / 字号阶梯 / 间距 / 触控目标 / 语义色 / 禁令（如"CJK 标签禁止折行"）
1..N. 各主题       该主题的令牌表 + 与默认主题的结构差异（只写差异，别复述）
N+1. 逐屏结构      每屏从上到下的模块清单，带精确尺寸；隐藏交互也写（长按/空白点击）
N+2. 无障碍/大字模式
N+3. 动效规范      入场 / 数值补间 / 折叠展开的时长与曲线
```

写"逐屏结构"时按**从上到下、从外到内**编号，实现时可以逐条打勾。

### 阶段 4 · 实施与验收

实施前先输出**文件清单 + 每个文件改什么**，等确认再动手。硬性约束（写进任务里）：

- 只改 UI / 主题层，不碰数据模型、业务方法、持久化 key。
- 颜色 / 字号 / 圆角一律来自生成的令牌文件，**不允许出现新的字面量色值**。
- 每完成一屏跑一次静态检查 + 测试（Flutter: `flutter analyze && flutter test`；Godot: 跑 headless 测试场景）。
- 暗色不写死浅色值；所有取色经主题/令牌解析函数。

验收清单（逐条勾，不勾完不算完成）：

- [ ] 主题 × 明暗的所有组合，每屏无溢出、无折行、无暗色白块
- [ ] 全局搜索确认没有游离色值（Flutter: `grep -rnE "Color\(0x|#[0-9A-Fa-f]{6}" lib/ --include=*.dart | grep -v design_tokens`）
- [ ] 触控目标 ≥ 令牌里的 `minTapTarget`
- [ ] 大字/长辈模式下仍不溢出
- [ ] 与设计稿并排截图比对（差异 > 2px 的地方要么改代码要么改 tokens，不要口头放过）
- [ ] 动效过一遍 `review-animations` 的标准（缓动方向、时长与频次是否匹配、可打断、无障碍）

## 迭代协议（第 2 轮以后）

来回改的代价主要在"哪些是新要求、哪些是既有规范"分不清。所以每轮迭代**必须**先写 `design-spec/PATCH.md`：

```markdown
# PATCH · 2026-08-04

## 变更
1. 卡片圆角 20 → 18            tokens.radius.card
2. 冰箱页顶部渐变去掉           DESIGN_SPEC §4.1 第 1 条
3. 新增"清仓"入口              DESIGN_SPEC §4.1 第 4 条（新增）

## 不变（防止顺手改坏）
- 语义三色、Tab 结构、动效参数

## 影响文件
- design-spec/tokens.json
- lib/features/fridge/fridge_page.dart
```

改完把 PATCH 的内容合进 DESIGN_SPEC.md / tokens.json，PATCH.md 归档到 `design-spec/history/`。
**规范文件永远代表现状，PATCH 只代表这一轮的 diff。**

## 常见坑

| 坑 | 后果 | 做法 |
|---|---|---|
| 直接照着 HTML 写 widget | 三轮之后没人知道哪个绿是对的 | 强制过 tokens.json |
| dark 节点偷懒只写几个键 | 暗色下大面积白块 | 键集比对当作 CI 检查 |
| 把 CSS 投影字符串原样塞进代码 | 每处手工翻译，值会漂移 | 存结构化数值，或写一个解析函数只写一次 |
| 三主题用 if/else 散落各页 | 加第四主题时全量返工 | 建一个 `StyleTokens.of(context)` 解析层，页面只问它要值 |
| 设计稿版本没号 | "按最新稿改"指向不明 | `html/v3-home.html`，DESIGN_SPEC 顶部写清当前基线 |
| 只出一版稿就开做 | 方向错了返工的是代码 | 阶段 0 出三版发散稿，选定再实现 |

## 与项目 harness 共存（装第三方技能包时）

`npx skills@latest add <repo>` 这类命令会往 `.claude/skills/` 里放东西。
有的技能包本身是一个 git 仓库，直接把 `.claude/` 整个变成它的克隆 ——
那样**你自己的 `agents/` `rules/` `settings.json` 就没地方放了**（放进去等于污染别人的仓库，
而且会被下次更新冲掉）。

正确姿势：`.claude/` 归项目自己，第三方技能包放进 `.claude/skills/<pack>/` 子目录，
并在项目 `.gitignore` 里排除它（它有自己的 upstream，不需要进你的仓库历史）：

```gitignore
.claude/skills/vendor-*/
```

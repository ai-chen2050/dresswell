# CHANGELOG

> 记「改了什么 + 为什么」。数值调整必须写出 旧值 → 新值。
> 这份文件是解释"某个数字为什么长这样"的第一去处，CLAUDE.md 会指向它。
> 用 `/devlog` 让 Claude 自动追加。

## 2026-10-29

- **上线中英双语 88 秒产品功能全景宣发视频与智能时间戳剧场**：
  - `promo.mp4`, `cover.png`, `promo-en.mp4`, `cover-en.png`: 引入 1080P 60fps 高清宣发片及视频海报（含新添 3D 百变站姿展示、双人折叠秀场、希腊女神裙拍照上身等 8 大核心功能场景）。
  - `style.css`: 新增 Mac 窗口剧场样式 `.video-stage`、三色视窗圆点 `.pg-dots`、胶囊章节按钮 `.chapter-pill` 及响应式断点适配。
  - `index.html` & `index.en.html`: 在 Hero 首屏增加 `▶ 88秒宣传片` / `▶ 88s Film` 锚点直达，并在首屏下方嵌入视频播放器组件，支持 8 大章节时间戳（00:00 3D试衣间、00:10 百变站姿、00:20 折叠秀场、00:30 拍照上身、00:40 真实身材、00:50 穿搭海报、01:00 AI搭配师、01:10 本地隐私、01:20 品牌终章）点击快速跳转及播放进度联动高亮。

## 2026-10-20

- **接入 Google Analytics 4 (`G-1CQNQNPK1Y`) + 百度统计 (`b3a7b6fedcba22d39897693d6f716035`) 全站追踪与 SPA 路由切换上报**：
  - `site.config.json`: 新增 `site.ga4: "G-1CQNQNPK1Y"` 与 `site.baidu: "b3a7b6fedcba22d39897693d6f716035"`（与 `ai-chen2050.github.io` 主站共用同一统计 ID，解决 GitHub Pages 子项目仓库独立 HTML 不继承主站统计代码的问题）。
  - `tools/gen_geo.py` & `tools/build_devlog.py`: 新增双引擎 `build_ga4()`，向全站 16 个 HTML 页面（含中英双语、华为渠道合规页、开发日记列表及详情页）注入 `gtag.js`、`hm.baidu.com/hm.js` 与 History API / Hash 路由切换 `page_view` + `_trackPageview` 监听；并自动清理已删除源码的残留生成物 `devlog/01-example.html`。
  - `tools/geo_check.py`: 增加全站（含 `devlog/*.html`）GA4、百度统计代码与 SPA 路由追踪一致性校验。

## 2026-09-03

- **同步主 App 正式 LOGO**：从 `ai-dress/DressWell-APP-Logo.png` 同步最新 AI 原生以图生图重绘版全出血母版至 `logo_master.png`，重跑 `tools/make_site_icon.py` 刷新全站图标 `icon.png`（512×512）与 Open Graph 社交卡 `og.png`（1200×630）。

## 2026-09-02

- 工程初始化（aic 脚手架生成）

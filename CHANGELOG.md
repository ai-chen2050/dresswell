# CHANGELOG

> 记「改了什么 + 为什么」。数值调整必须写出 旧值 → 新值。
> 这份文件是解释"某个数字为什么长这样"的第一去处，CLAUDE.md 会指向它。
> 用 `/devlog` 让 Claude 自动追加。

## 2026-11-24

- **上线 WebGPU 4DGS 内置默认形象互动走秀体验页 (`runway4d.html`, `runway4d.en.html`, `runway4d/`, `site.config.json`, `index.html`, `index.en.html`)**:
  - 使用 App 内置「亚洲」默认高定形象（`base.glb` + 银白丸子头 `part_hair_bun_ccby` `[0.86, 0.84, 0.82]` + 碎花层叠裙 `part_dress_tierskirt` + 高跟凉鞋 `part_shoes_heels` + 肤色妆容合成 `SkinTexture.compose`/`retone(0.25, 0.50)` + `lowlip: -0.35`），经 MIT 开源 `Faltwerk` 管线按面部 `2.2mm` / 发丝 `4.2mm` / 服饰 `5.2mm` 分层采样并启用 `--look lit` 工作室三点柔光烘焙，将 64 帧转身走秀动画压缩为 `6.60 MB`（`6.30 MiB`：`s0000.falt` `3,470,689 B` + `s0001.falt` `3,133,761 B`，`93,854` 粒子，`24 fps` 下 `19.81 Mbit/s`，`roundtrip_all_ok: true`），较 64 帧未压缩 float32 SH0 PLY（`336.37 MB`）缩减 `98.0%`（`50.9×`）；
  - 通过 `navigator.gpu.requestAdapter()` 自动探测浏览器 WebGPU 支持，可用时在 `runway4d/viewer.html` 中 360° 轨道交互与播放/暂停播控并在加载就绪后隐藏静态海报，不支持 WebGPU 的环境优雅回退为 Blender EEVEE 工作室海报 `runway4d/poster.jpg`；
  - 在中文/英文首页导航、Hero CTA 与页脚加入直达入口，并按 `ai-dress-site` GEO 规范注册至 `site.config.json`（含中英双语隔离校验与 Faltwerk MIT 署名）。
- **修复 GitHub Pages 工作流部署失败（`.github/workflows/pages.yml`）**：
  - 将官方 Actions 升级至 Node 24 支持版本（`actions/checkout@v4 → v7`、`actions/setup-python@v5 → v7`、`actions/configure-pages@v5 → v6`、`actions/upload-pages-artifact@v3 → v5`、`actions/deploy-pages@v4 → v5`），并将 `configure-pages` 与 `upload-pages-artifact` 前置到 `check` job、确保 `github-pages` 工件提交就绪后再由独立的 `deploy` job 执行发布，解决 `No artifacts named "github-pages" were found` 报错并消除 Node.js 20 弃用告警。

## 2026-11-18

- **接入海内外双轨售后用户社群闭环 (`site.config.json`, `index.html`, `index.en.html`, `support.html`, `support.en.html`, `style.css`, `Makefile`, `tools/{qr_svg.py,setup_community.py,gen_geo.py,geo_check.py}`)**:
  - 中文站展示开发者个人微信永久名片码（`wechat-qr.png`）与一键复制微信号 `ai-chen2050`（提示备注「穿好衣」入群），并受 `geo_check.py` 硬门禁保护杜绝混入境外 `t.me/` 死链；
  - 英文站接入在 BK Labs 超级群通过官方 Bot API 自动创建的纯英文专属 Topic **`DressWell`**、永久邀请链接与圆角矢量 `telegram-qr.svg`，并为 Topic 绑定官方 3D 图标 `🛍` (`iconCustomEmojiId: 5350699789551935589`)；
  - 将全站 `#community` 模块重设计为融合 Didot 衬线标题、`in oklab` 环境光晕、点阵肌理与右侧 Scan Pass 取景框的高质感 Bento 社群展示舱，采用 `container-type: inline-size` 适配宽窄容器并升级微信复制交互为不禁用按钮的无障碍状态提示。

## 2026-10-29

- **新增会员与自动续费服务协议及解除自动续费流程（华为合规与多渠道支持）**：
  - 新增 `subscription.html`、`subscription.en.html`、`subscription.huawei.html`、`subscription.huawei.en.html`，明确界定会员特权、自动续费扣款规则（周期、扣费时间、到期前 24 小时扣款），并详述华为手机系统设置与应用市场中的退订/解除自动续费操作路径及 iOS/Google Play 退订指引；
  - `terms.html` 与 `terms.huawei.html`（含中英文）：更新第 3 节付费条款，加入连续包月/包年订阅的自动续费扣款说明及取消续订指引，并建立直链互通；
  - `tools/make_huawei_legal.py` & `site.config.json`：注册 `subscription` 与 `subscription.huawei` 路由规则并自动生成无 AI 华为渠道合规政策页。

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

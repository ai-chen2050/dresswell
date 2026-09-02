# SITE_NEXT_STEPS · 穿好衣 官网

生成于 2026-09-02。做完划掉，全清空后删掉本文件。

## 1. 配置（先做这个，其它都从它生成）

- [ ] `site.config.json` → `site.domain` 换成真实域名
      （**还是 example.com 的话 canonical / sitemap / llms.txt 全指向错地址**）
- [ ] `site.type`：应用填 `SoftwareApplication`，游戏填 `VideoGame`
- [ ] `site.description` —— 两三句，写给人也写给 AI，要和商店描述口径一致
- [ ] `features` —— 每条都要有 `detail`，空条目会进 llms-full.txt
- [ ] `faq` —— **每个问题都要有完整答案**，空答案是明确的负面信号
- [ ] `differentiators` —— 对比表，AI 回答"X 和 Y 的区别"时直接引用
- [ ] `citationTriggers` —— 你希望在哪些提问下被推荐（写用户真会问的原话）
- [ ] `links` —— 上架后填各渠道地址，没有的留空字符串

## 2. 页面文本

- [ ] `index.html` 的 TODO 全部换掉
- [ ] `geo.html` —— 这是 GEO 主战场，把机制写具体（步骤、优先级、数字）
- [ ] `privacy.html` —— 必须与代码事实一致，商店会核对
- [ ] `support.html` —— 邮箱、常见问题
- [ ] 英文版 `index.en.html` / `geo.en.html` —— **重写而非直译**
- [ ] 各页 title / description 各不相同

## 3. 资源

- [ ] `icon.png`（512×512 起）
- [ ] 截图放 `shots/`，在首页引用
- [ ] og 图（社交分享缩略图，建议 1200×630）

## 4. 生成与体检

```bash
make build        # devlog + geo
make geo-check    # 必须全绿
make serve        # http://localhost:4000 看一眼
```

- [ ] `geo-check` 无 error
- [ ] 明暗两色都看过
- [ ] 手机宽度下不横向滚动

## 5. 部署

- [ ] 推到 GitHub
- [ ] 仓库 Settings → Pages → Source 选 **GitHub Actions**
- [ ] 自定义域名：Settings → Pages → Custom domain，并在 DNS 加 CNAME
- [ ] 部署后线上验：
      ```bash
      curl -s https://你的域名/llms.txt | head -20
      curl -sI https://你的域名/ | head -5
      ```

## 6. 接进发版流程

- [ ] 在产品仓库的发版清单里确认有"同步官网"这一步
- [ ] 每次发版跑 `/geo-refresh <产品仓路径>`

## 7. 持续

- [ ] 每月在 ChatGPT / Claude / Perplexity 里问一遍 `citationTriggers` 里的问题，
      记录会不会提到你、信息对不对
- [ ] 每次有值得讲的技术决策就写一篇开发日记（`/devlog-new`）——
      长内容才是被 AI 引用的主体

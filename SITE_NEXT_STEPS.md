# 还差什么

脚手架的初始待办已经做完（配置、六个页面 × 两门语言、图标、og 图、GEO 层）。
`make geo-check` 目前通过，只剩一个可忽略的提示（开发日记只有中文，没有 hreflang）。

下面是**真正还没做**的。

## 1. 上线前必须做

- [ ] **域名解析。** `site.config.json` 里写的是 `https://chuanhaoyi.top`，
      canonical、sitemap、llms.txt 全按它生成。域名要真的指到这个站，
      否则那些绝对地址全是错的。
- [ ] **GitHub Pages 用自定义域名要加 `CNAME` 文件**（内容就一行域名，无协议）。
      仓库 Settings → Pages → Source 选 “GitHub Actions”，工作流已就位。
- [ ] **首页缺产品图。** 现在整站是纯排版，没有一张 3D 试穿画面 ——
      对一个卖“看得见的效果”的产品，这是最大的短板。
      ⚠️ 别直接用现有的真机截图：左下角有 `FPS / ISO` 调试浮层，
      而且抓到的帧率是个位数，放出去是负面素材。需要的是：
      关掉调试浮层、正常帧率下重新抓一组（正面 / 背面 / 拉近细节），
      以及 `docs/MARKETING.md` 里点名的那段**一镜到底转体视频** ——
      那是 2D 竞品做不出来的素材，也是这个站最该有的东西。
      放进 `shots/`，在首页 hero 和「核心能力」之间引用。
- [ ] **商店链接。** 上架后把 `links.appStore` / `googlePlay` / `huawei` 填上，
      跑 `make geo` 同步。首页那两颗 CTA 现在写的是「即将上架」且不可点，
      填了链接之后要把 `aria-disabled` 去掉并指向真实地址。

## 2. 内容还可以加

- [ ] 开发日记只有一篇中文。英文站现在指向的是同一个中文索引 ——
      写一篇 `lang: en` 的进 `devlog/src/`，索引会自动分语言出页。
- [ ] `citationTriggers` 建议上线后按真实搜索词回填（能拿到搜索来源数据的话）。

## 3. 长期维护的规矩

- **改文案先改 `site.config.json`，再 `make build`。** llms.txt / llms-full.txt /
  sitemap.xml / robots.txt / 各页 `<head>` 都是生成物，手改会在下次生成时被覆盖。
- **页面正文里的 FAQ 要和配置里的 `faq` 一致。** 结构化数据和可见文本不一致
  会被判为不一致内容。改答案时两边一起改。
- **和 App 仓库对齐口径。** 这个站的卖点、定价、隐私说法要和
  `ai-dress/doc/APP_STORE_SUBMISSION.md`、`ai-dress/docs/IAP.md` 一致。
  三处说法不一致，AI 会降低引用意愿，商店审核也会挑。
- ⚠️ **华为渠道的商店页文案不能出现 AI / IA 字样**（缺算法备案资质，
  见 `ai-dress/docs/HUAWEI_LAUNCH.md` 第 8 节）。这个站是给 App Store /
  Google Play 和自然搜索看的，可以正常提 AI；**别把这里的文案直接搬去华为后台。**

## 4. 这个站在脚手架之外改了什么

`app-ai-creator` 的 site 模板原本只把**页面标题**分语言，其余（描述、卖点、FAQ、
关键词、产品名）都是单语字符串，于是英文页会拿到中文的 meta description 和
中文的 FAQ 结构化数据。这个站把三个工具都改成了语言感知：

- `tools/gen_geo.py`：面向用户的字段都过 `t()`（写成 `{lang: text}` 或裸字符串都行）；
  `llms.txt` / `llms-full.txt` **每门语言各出一份**（`llms.en.txt`），
  连章节标签也跟着换语言；新增 `pages[].description` 支持逐页描述。
- `tools/build_devlog.py`：同样支持 `{lang: text}`。
- `tools/geo_check.py`：改成逐门语言检查，缺某一门也会报出来。

这几处改动值得回流到 `app-ai-creator/templates/site/`，那边还是单语版本。

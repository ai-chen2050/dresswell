#!/usr/bin/env python3
"""从 privacy / terms 生成**华为渠道版**：去掉所有 AI 相关段落。

    python3 tools/make_huawei_legal.py     # → privacy.huawei.html / privacy.huawei.en.html
                                           #   terms.huawei.html   / terms.huawei.en.html

为什么要有这一版：华为 AppGallery 渠道包没有算法备案资质，App 里 AI 功能整体关闭
（产品仓 `StoreChannel.aiEnabled = !isHuawei`），配不了 Key、没有任何请求出设备。
如果商店页和 App 内仍挂着讲 BYOK 的政策，就是**不实陈述**（产品仓 docs/HUAWEI_LAUNCH.md 一·4）。

做法：基础页里所有 AI 相关块都用 `<!-- AI-ONLY --> … <!-- /AI-ONLY -->` 包着
（表格行、列表项、整节），这里原样删掉；然后把 `<h2>N. ` 重新编号。
**基础页是唯一真相源** —— 改政策改基础页，再跑一次这里；别手改 *.huawei*.html。
GEO 头（canonical / hreflang / JSON-LD）由 tools/gen_geo.py 按 site.config.json 里的
`privacy.huawei` / `terms.huawei` 两个 page 条目维护，所以跑完要 `make build`。
"""
import re

PAIRS = [
    ('privacy.html', 'privacy.huawei.html'),
    ('privacy.en.html', 'privacy.huawei.en.html'),
    ('terms.html', 'terms.huawei.html'),
    ('terms.en.html', 'terms.huawei.en.html'),
]
NOTE = {
    # ⚠️ 这句话里也别出现 "AI" 两个字母 —— 华为审核是关键词式的，连"不含 AI"都可能被挑。
    False: '<p class="updated">本页是华为应用市场渠道版：该版本没有任何联网分析功能，'
           '没有任何数据会离开你的设备。</p>',
    True: '<p class="updated">This is the Huawei AppGallery edition: that build has no '
          'cloud-connected analysis features, and no data ever leaves your device.</p>',
}


def strip_ai(s):
    s, n = re.subn(r'\s*<!-- AI-ONLY -->.*?<!-- /AI-ONLY -->', '', s, flags=re.S)
    assert n >= 1, '基础页里没有 AI-ONLY 标记'
    return s


def renumber(s):
    i = [0]
    def rep(m):
        i[0] += 1
        return f'{m.group(1)}{i[0]}. '
    return re.sub(r'(<h2>)\d+\. ', rep, s)


def relink(s, en):
    # 页内互链也指到华为版（隐私 ↔ 条款）
    for a, b in (('privacy', 'privacy.huawei'), ('terms', 'terms.huawei')):
        s = s.replace(f'href="{a}{".en" if en else ""}.html"', f'href="{b}{".en" if en else ""}.html"')
    return s


def main():
    for src, dst in PAIRS:
        en = src.endswith('.en.html')
        s = open(src, encoding='utf-8').read()
        s = renumber(relink(strip_ai(s), en))
        # 生效日期那行后面加一句渠道说明
        s = re.sub(r'(<p class="updated">.*?</p>)', lambda m: m.group(1) + '\n      ' + NOTE[en], s, count=1, flags=re.S)
        s = '<!-- 生成物：tools/make_huawei_legal.py 由 ' + src + ' 生成，不要手改 -->\n' + s
        open(dst, 'w', encoding='utf-8').write(s)
        print(f'{src} → {dst}')


if __name__ == '__main__':
    main()

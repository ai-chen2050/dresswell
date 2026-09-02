#!/usr/bin/env python3
"""从 logo_master.png 生成官网用的 icon.png 与 og.png（社交分享卡）。

母版来自 App 仓库：ai-dress/design-spec/logo/fullbleed_master.png
（那边由 tool/make_icons.py 从设计稿处理出来：裁掉透明留白、补掉圆角、
去掉投影，全出血不透明）。换 logo 时把新的母版拷过来再跑这个脚本。

    python3 tools/make_site_icon.py
"""
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.path.join(ROOT, 'logo_master.png')

IVORY = (251, 248, 244)
INK = (23, 20, 15)
SUB = (110, 103, 93)
MINT = (46, 189, 133)
ROSE = (184, 70, 95)

# 只用系统字体：Google Fonts 在大陆访问不稳，而这个站是中英双语双市场
SONGTI = '/System/Library/Fonts/Supplemental/Songti.ttc'
DIDOT = '/System/Library/Fonts/Supplemental/Didot.ttc'


def font(path, size, index=0):
    try:
        return ImageFont.truetype(path, size, index=index)
    except OSError:
        return ImageFont.load_default()


def main():
    master = Image.open(MASTER).convert('RGB')

    # ── 站点图标：全出血。浏览器不会加遮罩，但 16px 的标签页图标里
    #    留白就是浪费像素，所以不用带圆角留白的那一版。
    master.resize((512, 512), Image.LANCZOS).save(
        os.path.join(ROOT, 'icon.png'), optimize=True)
    print('  ✎ icon.png 512×512')

    # ── 社交卡 1200×630：左边 logo，右边字 ─────────────────────────
    W, H = 1200, 630
    og = Image.new('RGB', (W, H), IVORY)
    side = 380
    logo = master.resize((side, side), Image.LANCZOS)
    # 自己画一个圆角遮罩，让 logo 在卡片上看起来是一枚 App 图标
    mask = Image.new('L', (side, side), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, side - 1, side - 1], radius=int(side * 0.22), fill=255)
    og.paste(logo, (86, (H - side) // 2), mask)

    d = ImageDraw.Draw(og)
    x = 86 + side + 74
    d.rectangle([x, 176, x + 150, 180], fill=MINT)
    d.text((x, 206), '穿好衣', font=font(SONGTI, 92, 1), fill=INK)
    d.text((x + 4, 326), 'DressWell', font=font(DIDOT, 58), fill=ROSE)
    d.text((x, 424), '住在你手机里的 3D 试衣间', font=font(SONGTI, 32), fill=INK)
    d.text((x, 474), '衣柜和身材数据不出手机', font=font(SONGTI, 32), fill=SUB)
    og.save(os.path.join(ROOT, 'og.png'), optimize=True)
    print('  ✎ og.png 1200×630')


if __name__ == '__main__':
    main()

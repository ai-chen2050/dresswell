#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""零第三方依赖纯 Python SVG 二维码生成器（ISO/IEC 18004 Byte 模式，Version 1–6，Level L）。

用途：
    为官网的 Telegram 社群邀请链接生成本地高清矢量二维码 `telegram-qr.svg`，
    无需安装 Pillow / qrcode 等外部依赖。

用法：
    python3 tools/qr_svg.py "https://t.me/+ExampleInvite" telegram-qr.svg
    python3 tools/qr_svg.py --self-test
"""

from __future__ import annotations

import argparse
import os
import sys

# (version, size, total_codewords, data_codewords, ec_per_block, num_blocks, align_coords)
# 全部采用纠错等级 L（formatbits = 0b01），最大可编码 134 字节 UTF-8 URL
VERSIONS = [
    (1, 21, 26, 19, 7, 1, []),
    (2, 25, 44, 34, 10, 1, [6, 18]),
    (3, 29, 70, 55, 15, 1, [6, 22]),
    (4, 33, 100, 80, 20, 1, [6, 26]),
    (5, 37, 134, 108, 26, 1, [6, 30]),
    (6, 41, 172, 136, 18, 2, [6, 34]),
]

ECC_FORMAT_BITS_L = 0b01


def _gf_mul(a: int, b: int) -> int:
    """GF(256) 乘法（本原多项式 0x11D）。"""
    res = 0
    for _ in range(8):
        if b & 1:
            res ^= a
        hi = a & 0x80
        a = (a << 1) & 0xFF
        if hi:
            a ^= 0x1D
        b >>= 1
    return res


def _rs_generator(degree: int) -> list[int]:
    """生成 Reed-Solomon 生成多项式（最高次幂在前，首项系数恒为 1）。"""
    poly = [1]
    root = 1
    for _ in range(degree):
        nxt = [0] * (len(poly) + 1)
        for j, coef in enumerate(poly):
            nxt[j] ^= coef
            nxt[j + 1] ^= _gf_mul(coef, root)
        poly = nxt
        root = _gf_mul(root, 2)
    return poly


def _rs_remainder(data: list[int], ec_len: int) -> list[int]:
    """计算 data 的 Reed-Solomon 纠错码字。"""
    gen = _rs_generator(ec_len)
    buf = list(data) + [0] * ec_len
    for i in range(len(data)):
        factor = buf[i]
        if factor != 0:
            for j in range(1, len(gen)):
                buf[i + j] ^= _gf_mul(gen[j], factor)
    return buf[len(data):]


def _pick_version(byte_len: int) -> tuple[int, int, int, int, int, int, list[int]]:
    """选择可容纳给定字节长度的最小 Version（1–6）。"""
    # Byte 模式头部开销：4 位模式指示 (0100) + 8 位字符计数 = 12 位
    needed_bits = 12 + byte_len * 8
    for v in VERSIONS:
        if v[3] * 8 >= needed_bits:
            return v
    raise ValueError(
        f"二维码内容过长（{byte_len} 字节），当前内置 V1–V6 Level L 最大支持 134 字节"
    )


def _encode_data_codewords(raw: bytes, data_codewords: int) -> list[int]:
    """将原始字节编码为 Byte 模式数据码字序列（含终止符与交替填充字节）。"""
    bits: list[int] = []

    def push(val: int, width: int) -> None:
        for shift in range(width - 1, -1, -1):
            bits.append((val >> shift) & 1)

    push(0b0100, 4)          # Byte 模式标识
    push(len(raw), 8)        # V1–V6 字符计数固定为 8 位
    for b in raw:
        push(b, 8)

    cap_bits = data_codewords * 8
    term_len = min(4, cap_bits - len(bits))
    bits.extend([0] * term_len)
    while len(bits) % 8 != 0:
        bits.append(0)

    out: list[int] = []
    for i in range(0, len(bits), 8):
        byte = 0
        for b in bits[i:i + 8]:
            byte = (byte << 1) | b
        out.append(byte)

    pad_bytes = (0xEC, 0x11)
    idx = 0
    while len(out) < data_codewords:
        out.append(pad_bytes[idx & 1])
        idx += 1
    return out


def _interleave_blocks(
    data: list[int], num_blocks: int, ec_per_block: int
) -> list[int]:
    """分块计算 RS 纠错码并交织数据块与纠错块（V1–V6 Level L 各块等长）。"""
    assert len(data) % num_blocks == 0
    block_len = len(data) // num_blocks
    data_blocks = [
        data[i * block_len:(i + 1) * block_len] for i in range(num_blocks)
    ]
    ec_blocks = [_rs_remainder(b, ec_per_block) for b in data_blocks]

    result: list[int] = []
    for i in range(block_len):
        for b in data_blocks:
            result.append(b[i])
    for i in range(ec_per_block):
        for ec in ec_blocks:
            result.append(ec[i])
    return result


def _format_bits(mask: int) -> int:
    """计算 15 位格式信息（Level L + mask + BCH + 0x5412 异或掩码）。"""
    data = (ECC_FORMAT_BITS_L << 3) | mask
    rem = data
    for _ in range(10):
        rem = (rem << 1) ^ ((rem >> 9) * 0x537)
    return ((data << 10) | rem) ^ 0x5412


def _mask_fn(mask: int, row: int, col: int) -> bool:
    if mask == 0:
        return (row + col) % 2 == 0
    if mask == 1:
        return row % 2 == 0
    if mask == 2:
        return col % 3 == 0
    if mask == 3:
        return (row + col) % 3 == 0
    if mask == 4:
        return (row // 2 + col // 3) % 2 == 0
    if mask == 5:
        return ((row * col) % 2) + ((row * col) % 3) == 0
    if mask == 6:
        return (((row * col) % 2) + ((row * col) % 3)) % 2 == 0
    return (((row + col) % 2) + ((row * col) % 3)) % 2 == 0


def _penalty_score(modules: list[list[bool]]) -> int:
    """计算 ISO/IEC 18004 掩码惩罚总分（N1 + N2 + N3 + N4）。"""
    n = len(modules)
    score = 0

    # N1: 同色连续 5 个及以上
    for r in range(n):
        run_color = modules[r][0]
        run_len = 1
        for c in range(1, n):
            if modules[r][c] == run_color:
                run_len += 1
            else:
                if run_len >= 5:
                    score += 3 + (run_len - 5)
                run_color = modules[r][c]
                run_len = 1
        if run_len >= 5:
            score += 3 + (run_len - 5)

    for c in range(n):
        run_color = modules[0][c]
        run_len = 1
        for r in range(1, n):
            if modules[r][c] == run_color:
                run_len += 1
            else:
                if run_len >= 5:
                    score += 3 + (run_len - 5)
                run_color = modules[r][c]
                run_len = 1
        if run_len >= 5:
            score += 3 + (run_len - 5)

    # N2: 2x2 同色块
    for r in range(n - 1):
        row0, row1 = modules[r], modules[r + 1]
        for c in range(n - 1):
            v = row0[c]
            if v == row0[c + 1] == row1[c] == row1[c + 1]:
                score += 3

    # N3: 1:1:3:1:1 伪定位图样（前后含 4 个白块）
    pat_a = [True, False, True, True, True, False, True, False, False, False, False]
    pat_b = [False, False, False, False, True, False, True, True, True, False, True]
    for r in range(n):
        row = modules[r]
        for c in range(n - 10):
            seg = row[c:c + 11]
            if seg == pat_a or seg == pat_b:
                score += 40
    for c in range(n):
        col = [modules[r][c] for r in range(n)]
        for r in range(n - 10):
            seg = col[r:r + 11]
            if seg == pat_a or seg == pat_b:
                score += 40

    # N4: 深色模块占比偏离 50%
    dark = sum(1 for row in modules for cell in row if cell)
    pct = dark * 100 // (n * n)
    prev5 = abs(pct - pct % 5 - 50) // 5
    next5 = abs(pct - pct % 5 + 5 - 50) // 5
    score += min(prev5, next5) * 10

    return score


def encode_qr_matrix(text: str) -> list[list[bool]]:
    """生成二维布尔矩阵（True=黑块，False=白块）。"""
    raw = text.encode("utf-8")
    ver, size, _total_cw, data_cw, ec_per_blk, num_blks, align = _pick_version(len(raw))
    codewords = _interleave_blocks(
        _encode_data_codewords(raw, data_cw), num_blks, ec_per_blk
    )

    modules = [[False] * size for _ in range(size)]
    is_func = [[False] * size for _ in range(size)]

    def set_func(col: int, row: int, val: bool) -> None:
        modules[row][col] = val
        is_func[row][col] = True

    # 1. 三个角 7x7 定位图案 + 1 模块白色分隔符
    for fx, fy in ((0, 0), (size - 7, 0), (0, size - 7)):
        for dy in range(-1, 8):
            for dx in range(-1, 8):
                x, y = fx + dx, fy + dy
                if 0 <= x < size and 0 <= y < size:
                    dist = max(abs(dx - 3), abs(dy - 3))
                    set_func(x, y, dist in (0, 1, 3))

    # 2. 定时图案（第 6 行与第 6 列）
    for i in range(8, size - 8):
        dark = i % 2 == 0
        set_func(i, 6, dark)
        set_func(6, i, dark)

    # 3. 对齐图案（V2–V6）
    for cy in align:
        for cx in align:
            if is_func[cy][cx]:
                continue
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    dist = max(abs(dx), abs(dy))
                    set_func(cx + dx, cy + dy, dist != 1)

    # 4. 固定暗模块 (col=8, row=4*V+9)
    set_func(8, 4 * ver + 9, True)

    # 5. 预留 15 位格式信息槽位（两份副本）
    def write_format_bits(mask: int) -> None:
        bits = _format_bits(mask)
        # 副本 1（左上定位符周边）
        for i in range(15):
            mod = ((bits >> i) & 1) != 0
            if i <= 5:
                set_func(8, i, mod)
            elif i == 6:
                set_func(8, 7, mod)
            elif i == 7:
                set_func(8, 8, mod)
            elif i == 8:
                set_func(7, 8, mod)
            else:
                set_func(14 - i, 8, mod)
        # 副本 2（右上 + 左下）
        for i in range(15):
            mod = ((bits >> i) & 1) != 0
            if i < 8:
                set_func(size - 1 - i, 8, mod)
            else:
                set_func(8, size - 15 + i, mod)

    write_format_bits(0)  # 先占位，确保 Zigzag 跳过格式区

    # 6. Zigzag 数据与纠错比特填充
    total_bits = len(codewords) * 8
    bit_idx = 0
    right = size - 1
    upward = True
    while right >= 1:
        if right == 6:
            right -= 1
        rows = range(size - 1, -1, -1) if upward else range(size)
        for row in rows:
            for col in (right, right - 1):
                if not is_func[row][col]:
                    val = False
                    if bit_idx < total_bits:
                        val = ((codewords[bit_idx >> 3] >> (7 - (bit_idx & 7))) & 1) != 0
                        bit_idx += 1
                    modules[row][col] = val
        upward = not upward
        right -= 2

    # 7. 选择惩罚分最低的最优掩码
    best_mask = 0
    best_score = 1 << 30
    best_matrix: list[list[bool]] = modules
    for mask in range(8):
        cand = [row[:] for row in modules]
        for r in range(size):
            for c in range(size):
                if not is_func[r][c] and _mask_fn(mask, r, c):
                    cand[r][c] = not cand[r][c]
        # 临时写入格式位以保证 N1/N3 评分准确
        bits = _format_bits(mask)
        for i in range(15):
            mod = ((bits >> i) & 1) != 0
            if i <= 5:
                cand[i][8] = mod
            elif i == 6:
                cand[7][8] = mod
            elif i == 7:
                cand[8][8] = mod
            elif i == 8:
                cand[8][7] = mod
            else:
                cand[8][14 - i] = mod
            if i < 8:
                cand[8][size - 1 - i] = mod
            else:
                cand[size - 15 + i][8] = mod
        sc = _penalty_score(cand)
        if sc < best_score:
            best_score = sc
            best_mask = mask
            best_matrix = cand

    _ = best_mask  # 格式位已在 cand 中写入
    return best_matrix


def render_qr_svg(text: str, quiet: int = 3, fg: str = "#0B1520", bg: str = "#FFFFFF") -> str:
    """将矩阵渲染为高质感圆角 Finder + 圆角 Squircle 模块矢量 SVG 字符串。"""
    matrix = encode_qr_matrix(text)
    size = len(matrix)
    vb = size + quiet * 2

    def _in_finder(r: int, c: int) -> bool:
        return (
            (r < 7 and c < 7)
            or (r < 7 and c >= size - 7)
            or (r >= size - 7 and c < 7)
        )

    finders: list[str] = []
    for fr, fc in ((0, 0), (0, size - 7), (size - 7, 0)):
        x0, y0 = fc + quiet, fr + quiet
        finders.append(
            f'  <rect x="{x0}" y="{y0}" width="7" height="7" rx="2.0" fill="{fg}"/>\n'
            f'  <rect x="{x0 + 1}" y="{y0 + 1}" width="5" height="5" rx="1.25" fill="{bg}"/>\n'
            f'  <rect x="{x0 + 2}" y="{y0 + 2}" width="3" height="3" rx="0.75" fill="{fg}"/>'
        )

    dots: list[str] = []
    for r, row in enumerate(matrix):
        for c, val in enumerate(row):
            if not val or _in_finder(r, c):
                continue
            dots.append(
                f'    <rect x="{c + quiet + 0.06:.2f}" y="{r + quiet + 0.06:.2f}" '
                f'width="0.88" height="0.88" rx="0.30"/>'
            )

    finders_block = "\n".join(finders)
    dots_block = "\n".join(dots)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb} {vb}" '
        f'width="{vb * 8}" height="{vb * 8}" role="img" '
        f'aria-label="QR Code">\n'
        f'  <rect width="{vb}" height="{vb}" fill="{bg}"/>\n'
        f'{finders_block}\n'
        f'  <g fill="{fg}">\n'
        f'{dots_block}\n'
        f'  </g>\n'
        f'</svg>\n'
    )


def generate_qr_svg(text: str, out_path: str | None = None) -> str:
    """生成 QR SVG，若指定 out_path 则写入磁盘并返回 SVG 内容。"""
    svg = render_qr_svg(text)
    if out_path:
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(svg)
    return svg


def _self_test() -> None:
    """自检：校验 V1–V6 尺寸、定位角不变性、格式位 BCH 编码及典型 TG 链接生成。"""
    assert _format_bits(0) == 0x77C4, f"unexpected format bits: {hex(_format_bits(0))}"
    samples = [
        ("hi", 21),
        ("https://t.me/+AbCdEfGhIjKlMnOp", 25),
        ("https://t.me/+TestInviteLink2026_Community_Invite_Long", 33),
        ("https://example.com/" + "a" * 95, 41),
    ]
    for payload, expected_size in samples:
        mat = encode_qr_matrix(payload)
        n = len(mat)
        assert n == expected_size, f"{payload}: got {n}, expect {expected_size}"
        assert all(len(row) == n for row in mat)
        # 三个定位角中心 3x3 与外框角点必须为 True，分隔符外环角为 False
        assert mat[3][3] is True and mat[0][0] is True and mat[0][7] is False
        assert mat[3][n - 4] is True and mat[0][n - 1] is True and mat[7][n - 8] is False
        assert mat[n - 4][3] is True and mat[n - 1][0] is True and mat[n - 8][7] is False
        # 固定暗模块 (col=8, row=n-8)
        assert mat[n - 8][8] is True
        svg = render_qr_svg(payload)
        assert "<svg " in svg and "<rect " in svg and "</svg>" in svg
    print("✅ qr_svg self-test passed (V1–V6, BCH, Finder/Dark invariants)")


def main() -> None:
    ap = argparse.ArgumentParser(description="纯 Python 零依赖 SVG 二维码生成器")
    ap.add_argument("text", nargs="?", help="要编码的文本或 URL")
    ap.add_argument("output", nargs="?", help="输出 .svg 路径（不传则打印到标准输出）")
    ap.add_argument("--self-test", action="store_true", help="运行内置编码自检")
    args = ap.parse_args()

    if args.self_test:
        _self_test()
        return

    if not args.text:
        ap.error("请提供要编码的文本或使用 --self-test")

    svg = generate_qr_svg(args.text, args.output)
    if args.output:
        print(f"✓ 已生成二维码 {args.output}")
    else:
        sys.stdout.write(svg)


if __name__ == "__main__":
    main()

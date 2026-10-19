#!/usr/bin/env python3
"""生成 MSI（WiX）安装器定制位图：wix-banner.bmp / wix-dialog.bmp。

尺寸规范（WiX 3 文档）
- banner：493 x 58 px，贴在 InstallDirDlg / ProgressDlg 顶部（控件 370x44 dlu）
- dialog：493 x 312 px，铺满 WelcomeDlg / ExitDialog（控件 370x234 dlu）
- dlu -> px 换算为 4/3，故 370 dlu = 493 px

关键：WiX 会在位图之上叠加自己的文字控件，画图时必须避开这些区域，
否则文字压在图形上就是"图标错位"。实测 WixUI_InstallDir（WiX 3.14）布局：

banner（InstallDirDlg / ProgressDlg，窗口 493x360 px）：
  - 标题文字     x 20-287, y 8-28
  - 描述文字     x 33-406, y 31-51
  - => 安全区：x > 290 任意 y；或 y > 52 全宽（底部条带）

dialog（WelcomeDlg / ExitDialog，窗口 493x360 px，位图占上 312 px）：
  - 标题文字     x 180-473, y 27-107
  - 描述文字     x 180-473, y 107-187
  - 底部按钮在 y 324 起（位图之外）
  - => 安全区：x < 180 任意 y；或 y > 190 全宽

用法：python scripts/gen-installer-bitmaps.py
依赖：pip install pillow
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT_DIR = Path(__file__).resolve().parent.parent / "src-tauri" / "installer"

# 与应用视觉保持一致（见 src/index.css 的 data-accent 变量）
ACCENT = (108, 92, 231)  # violet
INK = (26, 26, 30)  # 图标底色
BG = (251, 251, 253)  # 对话框背景
GRID = (236, 236, 243)  # 点阵
MUTED = (120, 120, 132)  # 次要文字


def load_font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    candidates = (
        ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/seguisb.ttf"]
        if bold
        else ["C:/Windows/Fonts/segoeui.ttf"]
    )
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def draw_ts_icon(draw: ImageDraw.ImageDraw, box, font: ImageFont.FreeTypeFont) -> None:
    """在 box=(x, y, size) 处画圆角方块 + 居中 TS 字样。"""
    x, y, size = box
    draw.rounded_rectangle([x, y, x + size, y + size], radius=size // 5, fill=INK)
    text = "TS"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(
        (x + (size - tw) / 2 - bbox[0], y + (size - th) / 2 - bbox[1]),
        text,
        font=font,
        fill=(255, 255, 255),
    )


def draw_dotted_grid(draw: ImageDraw.ImageDraw, w: int, h: int, spacing: int = 18) -> None:
    for gy in range(spacing // 2, h, spacing):
        for gx in range(spacing // 2, w, spacing):
            draw.ellipse([gx - 1, gy - 1, gx + 1, gy + 1], fill=GRID)


def gen_banner() -> None:
    """493x58：右下放图标，底部一条强调线；左上留给 WiX 标题/描述文字。"""
    w, h = 493, 58
    img = Image.new("RGB", (w, h), (255, 255, 255))
    draw = ImageDraw.Draw(img)

    # 右侧安全区（x > 290）放品牌图标
    draw_ts_icon(draw, (447, 13, 32), load_font(15))

    # 底部强调线（y > 52 安全）
    draw.rectangle([0, 55, w, 57], fill=ACCENT)

    img.save(OUT_DIR / "wix-banner.bmp")


def gen_dialog() -> None:
    """493x312：左侧放主视觉，右侧（文字区）保持干净，底部放产品名。"""
    w, h = 493, 312
    img = Image.new("RGB", (w, h), BG)
    draw = ImageDraw.Draw(img)
    draw_dotted_grid(draw, w, h)

    # 左侧安全区（x < 180）放主图标
    draw_ts_icon(draw, (52, 96, 128), load_font(62))

    # 图标下方强调短线
    draw.rectangle([52, 244, 180, 248], fill=ACCENT)

    # 底部（y > 190 安全）放产品名， Welcome / Exit 两个对话框复用
    draw.text((52, 262), "Tauri Desktop Starter", font=load_font(17), fill=INK)
    draw.text((52, 286), "v0.1.0", font=load_font(13, bold=False), fill=MUTED)

    # 底部强调线
    draw.rectangle([0, 307, w, 309], fill=ACCENT)

    img.save(OUT_DIR / "wix-dialog.bmp")


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    gen_banner()
    gen_dialog()
    print(f"已生成：{OUT_DIR / 'wix-banner.bmp'}")
    print(f"已生成：{OUT_DIR / 'wix-dialog.bmp'}")

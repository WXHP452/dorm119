#!/usr/bin/env python3
"""
把手机拍的照片批量压缩成适合放网页的大小。

用法（在 dorm-site 目录下）：
    pip install pillow
    python tools/compress.py 原图文件夹 images

它会做这些事：
  · 按 EXIF 方向把照片摆正
  · 长边压到 1600px（手机上看足够清晰）
  · 质量 82，顺手去掉 EXIF（包括 GPS 定位）
  · 输出 01.jpg、02.jpg……并打印可直接粘贴进 photos.js 的代码行
"""

import argparse
import os
import sys

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("缺少 Pillow，请先运行：pip install pillow")

SUPPORTED = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".bmp", ".tif", ".tiff"}


def collect(folder):
    paths = []
    for root, _dirs, files in os.walk(folder):
        for name in files:
            if os.path.splitext(name)[1].lower() in SUPPORTED:
                paths.append(os.path.join(root, name))
    return sorted(paths)


def main():
    ap = argparse.ArgumentParser(description="批量压缩照片，输出到 images/ 目录")
    ap.add_argument("source", help="原图所在文件夹")
    ap.add_argument("out", nargs="?", default="images", help="输出文件夹（默认 images）")
    ap.add_argument("--width", type=int, default=1600, help="长边最大像素（默认 1600）")
    ap.add_argument("--quality", type=int, default=82, help="JPEG 质量 1-100（默认 82）")
    ap.add_argument("--start", type=int, default=1, help="起始编号（默认 1，已有照片时改成 10 就不会覆盖）")
    args = ap.parse_args()

    if not os.path.isdir(args.source):
        sys.exit(f"找不到文件夹：{args.source}")

    files = collect(args.source)
    if not files:
        sys.exit(f"{args.source} 里没有找到图片")

    os.makedirs(args.out, exist_ok=True)

    print(f"共 {len(files)} 张，输出到 {args.out}/ ，长边 {args.width}px，质量 {args.quality}\n")

    before = after = 0
    lines = []

    for i, path in enumerate(files, start=args.start):
        name = f"{i:02d}.jpg"
        dest = os.path.join(args.out, name)
        try:
            with Image.open(path) as im:
                im = ImageOps.exif_transpose(im)          # 按方向信息摆正
                if im.mode in ("RGBA", "LA", "P"):
                    im = im.convert("RGBA")
                    bg = Image.new("RGB", im.size, (255, 255, 255))
                    bg.paste(im, mask=im.split()[-1])
                    im = bg
                else:
                    im = im.convert("RGB")
                im.thumbnail((args.width, args.width), Image.LANCZOS)
                im.save(dest, "JPEG", quality=args.quality, optimize=True, progressive=True)
        except Exception as exc:                          # 单张失败不影响其他
            print(f"  ✗ {os.path.basename(path)}：{exc}")
            continue

        src_size = os.path.getsize(path)
        dst_size = os.path.getsize(dest)
        before += src_size
        after += dst_size
        lines.append(f'  {{ src: "images/{name}", title: "" }},')
        print(f"  ✓ {os.path.basename(path)} → {name}   "
              f"{src_size / 1024 / 1024:.1f}MB → {dst_size / 1024:.0f}KB")

    print(f"\n合计 {before / 1024 / 1024:.1f}MB → {after / 1024 / 1024:.1f}MB")

    print("\n--- 把下面这些行粘贴进 photos.js 的 PHOTOS 列表（记得填 title）---\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()

"""Draws the app + extension icons. Run: uv run --with pillow python3 scripts/make_icons.py"""
import subprocess, shutil, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
S = 4096  # supersampled canvas; downscaled for smooth edges


def draw(size_px: int, margin_ratio: float = 0.1, shadow: bool = True) -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    m = int(S * margin_ratio)
    box = (m, m, S - m, S - m)
    r = int((S - 2 * m) * 0.225)
    if shadow:
        sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle((box[0], box[1] + S * 0.015, box[2], box[3] + S * 0.015), r, fill=(0, 0, 0, 110))
        img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(S * 0.02)))
    # Vertical emerald gradient inside a rounded square.
    grad = Image.new("RGBA", (S, S))
    top, bot = (16, 185, 129), (4, 120, 87)
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / S
        gd.line([(0, y), (S, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, r, fill=255)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    W = S - 2 * m
    cx = S / 2
    white = (255, 255, 255, 255)
    green = (5, 150, 105, 255)
    # Archive box: lid + body + handle slot.
    lid_w, lid_h = W * 0.62, W * 0.14
    lid_top = m + W * 0.30
    d.rounded_rectangle((cx - lid_w / 2, lid_top, cx + lid_w / 2, lid_top + lid_h), W * 0.035, fill=white)
    body_w = W * 0.54
    body_top = lid_top + lid_h + W * 0.03
    body_bot = m + W * 0.80
    d.rounded_rectangle((cx - body_w / 2, body_top, cx + body_w / 2, body_bot), W * 0.05, fill=white)
    slot_w, slot_h = W * 0.18, W * 0.05
    sy = body_top + W * 0.08
    d.rounded_rectangle((cx - slot_w / 2, sy, cx + slot_w / 2, sy + slot_h), slot_h / 2, fill=green)
    # Chat bubble peeking out of the box.
    bw, bh = W * 0.34, W * 0.20
    bx, by = cx + W * 0.05, m + W * 0.10
    d.rounded_rectangle((bx - bw / 2, by, bx + bw / 2, by + bh), bh * 0.42, fill=(209, 250, 229, 255))
    d.polygon([(bx - bw * 0.22, by + bh - 2), (bx - bw * 0.34, by + bh + W * 0.07), (bx - bw * 0.02, by + bh - 2)], fill=(209, 250, 229, 255))
    for i in (-1, 0, 1):
        rr = W * 0.022
        px, py = bx + i * W * 0.075, by + bh / 2
        d.ellipse((px - rr, py - rr, px + rr, py + rr), fill=green)
    return img.resize((size_px, size_px), Image.LANCZOS)


def main():
    # macOS app icon (.icns): icon content sits inside a ~10% margin, like Apple's template.
    iconset = ROOT / "build" / "icon.iconset"
    shutil.rmtree(iconset, ignore_errors=True)
    iconset.mkdir(parents=True)
    master = draw(1024)
    master.save(ROOT / "build" / "icon.png")
    for base in (16, 32, 128, 256, 512):
        master.resize((base, base), Image.LANCZOS).save(iconset / f"icon_{base}x{base}.png")
        master.resize((base * 2, base * 2), Image.LANCZOS).save(iconset / f"icon_{base}x{base}@2x.png")
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(ROOT / "build" / "icon.icns")], check=True)
    shutil.rmtree(iconset)
    # Chrome extension icons: fill the square, no shadow.
    ext = draw(512, margin_ratio=0.02, shadow=False)
    for n in (16, 48, 128):
        ext.resize((n, n), Image.LANCZOS).save(ROOT / "extension" / "icons" / f"icon{n}.png")
    print("icons written")


if __name__ == "__main__":
    sys.exit(main())

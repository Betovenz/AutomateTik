"""Flat extension icons derived from the app logo (bolt + open arc on a rounded
square). Main = blue, Support/TikTok = orange. Rendered at 1024 and downsampled
so the 16 px toolbar icon stays crisp."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent  # repo root
S = 1024


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient_square(c1, c2, radius):
    """Diagonal gradient clipped to a rounded square."""
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    grad = Image.new("RGB", (S, S))
    px = grad.load()
    for y in range(S):
        for x in range(S):
            px[x, y] = lerp(c1, c2, (x + y) / (2 * S))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)
    return img


def draw_mark(img):
    d = ImageDraw.Draw(img)
    cx = cy = S / 2
    # Open arc ring (like the app logo): two gaps, white at 82% opacity
    r_out, w = 330, 58
    box = (cx - r_out, cy - r_out, cx + r_out, cy + r_out)
    for start, end in ((150, 335), (20, 95)):
        d.arc(box, start=start, end=end, fill=(255, 255, 255, 210), width=w)
    # Lightning bolt (the app's shape, simplified)
    raw = [
        (600, 205), (330, 560), (500, 560),
        (430, 830), (700, 470), (530, 470),
    ]
    # a touch larger than the arc's inner radius so it still reads at 16 px
    bolt = [(cx + (x - cx) * 1.18, cy + (y - cy) * 1.18) for x, y in raw]
    # soft shadow under the bolt for depth
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).polygon([(x + 10, y + 18) for x, y in bolt], fill=(0, 0, 0, 90))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    img.alpha_composite(shadow)
    ImageDraw.Draw(img).polygon(bolt, fill=(255, 255, 255, 255))
    return img


def build(name, c1, c2, out_dir):
    img = gradient_square(c1, c2, radius=230)
    img = draw_mark(img)
    out_dir.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        img.resize((size, size), Image.LANCZOS).save(out_dir / f"icon{size}.png")
    img.resize((512, 512), Image.LANCZOS).save(out_dir / "icon512.png")
    print(name, "->", out_dir)


# Main: blue. Support (TikTok): orange — the app's peach accent pushed to a true orange.
build("main", (37, 99, 235), (30, 64, 175), ROOT / "ai_studio_extension_main" / "icons")
build("support", (251, 146, 60), (234, 88, 12), ROOT / "ai_studio_extension" / "icons")

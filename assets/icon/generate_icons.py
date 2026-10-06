"""
The app icon, drawn in code (PO: "Design me a really nice icon that fits the
spirit of what we have been creating together ... grass roots football and
coaching passion. Color it and beta it as appropriate.", 2026-10-04).

The whistle's cord tied into a heart around the ball, on a mown pitch with
chalk lines: coaching and passion as one line, grassroots football at the
centre. Heart FC Beta Coach is the same picture on orange-mown grass with a BETA
tag — orange has meant "beta" since #91.

    python3 assets/icon/generate_icons.py      # rewrites assets/images/*icon*.png

Needs Pillow. Not part of the app build: the PNGs it writes are committed.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, '..', 'fonts', 'Barlow-Bold.ttf')
SS = 4                      # supersample for smooth edges
S = 1024 * SS
GRASS_A = (36, 122, 62)     # mown stripes: two greens
GRASS_B = (45, 140, 72)
CHALK = (244, 246, 240)
INK = (24, 32, 28)
HEART = (232, 72, 60)
BETA_GRASS = ((214, 96, 18), (232, 112, 28))   # orange mown grass: Heart FC Beta Coach (#91)       # passion: warm red, also the lanyard
METAL_HI, METAL_LO = (236, 240, 244), (150, 160, 170)

def stripes(img, n=7, angle=-28, colours=(GRASS_A, GRASS_B)):
    d = ImageDraw.Draw(img)
    w = S / n
    # diagonal mowing stripes
    for i in range(-n, 2 * n):
        x0 = i * w
        poly = [(x0, 0), (x0 + w, 0), (x0 + w - S * math.tan(math.radians(angle)), S),
                (x0 - S * math.tan(math.radians(angle)), S)]
        d.polygon(poly, fill=colours[0] if i % 2 else colours[1])

def chalk_lines(img):
    d = ImageDraw.Draw(img)
    lw = int(0.018 * S)
    # halfway line and centre circle, low and off-centre: the pitch at a grassroots ground
    cy = int(0.80 * S)
    d.line([(0, cy), (S, cy)], fill=CHALK, width=lw)
    r = int(0.30 * S)
    cx = int(0.5 * S)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=CHALK, width=lw)

def pentagon(cx, cy, r, rot):
    return [(cx + r * math.cos(rot + k * 2 * math.pi / 5), cy + r * math.sin(rot + k * 2 * math.pi / 5)) for k in range(5)]

def ball(img, cx, cy, R):
    # soft shadow on the grass
    sh = Image.new('L', img.size, 0)
    ImageDraw.Draw(sh).ellipse([cx - R * 0.95, cy + R * 0.78, cx + R * 0.95, cy + R * 1.08], fill=110)
    sh = sh.filter(ImageFilter.GaussianBlur(R * 0.12))
    img.paste((10, 40, 20), (0, 0), sh)
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(250, 250, 248, 255))
    rot = -math.pi / 2
    p0 = pentagon(cx, cy, R * 0.32, rot)
    d.polygon(p0, fill=INK + (255,))
    lw = max(2, int(R * 0.05))
    outer = []
    for k in range(5):
        b = rot + (k + 0.5) * 2 * math.pi / 5      # between two seams
        pc = pentagon(cx + R * 1.00 * math.cos(b), cy + R * 1.00 * math.sin(b), R * 0.36, b)
        outer.append(pc)
        d.polygon(pc, fill=INK + (255,))
    for k in range(5):
        a = rot + k * 2 * math.pi / 5
        vx, vy = p0[k]
        jx, jy = cx + R * 0.60 * math.cos(a), cy + R * 0.60 * math.sin(a)
        d.line([(vx, vy), (jx, jy)], fill=INK + (255,), width=lw)
        for pc in (outer[k], outer[(k - 1) % 5]):
            nx, ny = min(pc, key=lambda p: (p[0] - jx) ** 2 + (p[1] - jy) ** 2)
            d.line([(jx, jy), (nx, ny)], fill=INK + (255,), width=lw)
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).ellipse([cx - R, cy - R, cx + R, cy + R], fill=255)
    layer.putalpha(Image.composite(layer.getchannel('A'), Image.new('L', img.size, 0), mask))
    img.alpha_composite(layer)
    # subtle shading and a highlight, so it reads as a ball, not a badge
    shade = Image.new('L', img.size, 0)
    ImageDraw.Draw(shade).ellipse([cx - R * 0.55, cy - R * 0.25, cx + R * 1.35, cy + R * 1.65], fill=70)
    shade = Image.composite(shade.filter(ImageFilter.GaussianBlur(R * 0.25)), Image.new('L', img.size, 0), mask)
    img.paste((0, 0, 0), (0, 0), shade)
    hl = Image.new('L', img.size, 0)
    ImageDraw.Draw(hl).ellipse([cx - R * 0.70, cy - R * 0.55, cx - R * 0.30, cy - R * 0.20], fill=90)
    hl = Image.composite(hl.filter(ImageFilter.GaussianBlur(R * 0.08)), Image.new('L', img.size, 0), mask)
    img.paste((255, 255, 255), (0, 0), hl)
    ImageDraw.Draw(img).ellipse([cx - R, cy - R, cx + R, cy + R], outline=INK, width=max(2, int(R * 0.035)))

def heart(d, cx, cy, s, fill):
    # two circles and a point: a heart, the coaching passion
    r = s * 0.30
    d.ellipse([cx - 2 * r, cy - r, cx, cy + r], fill=fill)
    d.ellipse([cx, cy - r, cx + 2 * r, cy + r], fill=fill)
    d.polygon([(cx - 2 * r + r * 0.12, cy + r * 0.35), (cx + 2 * r - r * 0.12, cy + r * 0.35), (cx, cy + s * 0.78)], fill=fill)

def heart_cord(img, cx, cy, w, lw):
    # the whistle's lanyard, drawn as a heart: coaching and passion, one line
    pts = []
    for i in range(0, 721):
        t = 2 * math.pi * i / 720
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * w / 34, cy - y * w / 34))
    d = ImageDraw.Draw(img)
    # stroke by stamping discs: no joint artefacts at any size
    for (x, y), rr, col in [(p, lw * 0.62, (140, 28, 28)) for p in pts] + [(p, lw * 0.5, HEART) for p in pts]:
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=col)
    # a highlight along the cord
    for (x, y) in pts:
        rr = lw * 0.14
        d.ellipse([x - rr - lw * 0.18, y - rr - lw * 0.18, x + rr - lw * 0.18, y + rr - lw * 0.18], fill=(246, 130, 118))

def whistle(img, cx, cy, s):
    # whistle body: barrel and mouthpiece, brushed metal
    body = Image.new('RGBA', img.size, (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    r = s * 0.42
    bd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=METAL_LO + (255,))
    bd.rounded_rectangle([cx - s * 0.05, cy - r, cx + s * 1.05, cy - r + s * 0.36], radius=s * 0.08, fill=METAL_LO + (255,))
    bd.ellipse([cx - r * 0.86, cy - r * 0.86, cx + r * 0.80, cy + r * 0.80], fill=METAL_HI + (255,))
    bd.rounded_rectangle([cx + s * 0.05, cy - r + s * 0.04, cx + s * 0.99, cy - r + s * 0.26], radius=s * 0.06, fill=METAL_HI + (255,))
    bd.ellipse([cx - r * 0.30, cy - r * 0.30, cx + r * 0.30, cy + r * 0.30], fill=(120, 130, 140, 255))
    bd.ellipse([cx - s * 0.62, cy - s * 0.10, cx - s * 0.42, cy + s * 0.10], outline=METAL_LO + (255,), width=int(s * 0.05))
    img.alpha_composite(body)
    ImageDraw.Draw(img).ellipse([cx - r, cy - r, cx + r, cy + r], outline=INK, width=int(s * 0.03))

def render(beta=False, size=1024, safe=1.0, background=True):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    if background:
        stripes(img, colours=BETA_GRASS if beta else (GRASS_A, GRASS_B))
        chalk_lines(img)
    k = safe
    c = S / 2
    def at(fx, fy):
        return c + (fx - 0.5) * S * k, c + (fy - 0.5) * S * k
    hx, hy = at(0.5, 0.47)
    heart_cord(img, hx, hy, S * 0.78 * k, int(S * 0.034 * k))
    bx, by = at(0.5, 0.45)
    ball(img, bx, by, S * 0.235 * k)
    # the whistle hangs from the heart's point by its ring
    ws = S * 0.15 * k
    tipx, tipy = at(0.5, 0.47 + 0.78 / 2)
    whistle(img, tipx + ws * 0.52, tipy + ws * 0.05, ws)
    if beta:
        # BETA tag in the free space between the heart's lobes, inside every mask
        d = ImageDraw.Draw(img)
        px, py = at(0.5, 0.115)
        w, h = S * 0.30 * k, S * 0.105 * k
        d.rounded_rectangle([px - w / 2, py - h / 2, px + w / 2, py + h / 2], radius=h / 2, fill=(255, 255, 255))
        font = ImageFont.truetype(FONT, int(h * 0.72))
        d.text((px, py), 'BETA', font=font, fill=(200, 80, 10), anchor='mm')
    return img.resize((size, size), Image.LANCZOS)

def write_all(out_dir):
    """Every icon file the app config names, for Heart FC Coach and Heart FC Beta Coach."""
    for beta in (False, True):
        tag = 'beta-' if beta else ''
        render(beta=beta).convert('RGB').save(os.path.join(out_dir, f'{tag}icon.png'))
        render(beta=beta, safe=0.62, background=False).save(os.path.join(out_dir, f'{tag}adaptive-icon.png'))
        bg = Image.new('RGBA', (S, S))
        stripes(bg, colours=BETA_GRASS if beta else (GRASS_A, GRASS_B))
        chalk_lines(bg)
        bg.resize((1024, 1024), Image.LANCZOS).convert('RGB').save(os.path.join(out_dir, f'{tag}adaptive-background.png'))


if __name__ == '__main__':
    write_all(os.path.join(HERE, '..', 'images'))

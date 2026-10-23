#!/usr/bin/env python3
"""Caption and frame the raw App Store screenshots, to Dee's design (#226).

    composite_shots.py compose RAW_DIR OUT_DIR iphone|ipad CAPTIONS
        Every NN-name.png in RAW_DIR, drawn in a device frame under its
        caption, at Apple's exact size (iPhone 6.9" 1320x2868, iPad 13"
        2064x2752), RGB with no alpha, to OUT_DIR/NN-name.png. Refuses a raw
        shot with no caption, a caption with no raw shot, a raw shot of the
        wrong shape, and a headline that runs to three lines.
    composite_shots.py on-black PICTURE OUT WIDTH HEIGHT
        Shot 3: the plan picture the app makes, fitted on a black screen of
        WIDTH x HEIGHT (a raw shot's size), so it frames like the others.
    composite_shots.py check-captions CAPTIONS
        Every caption parses and fits two lines on both displays.
    composite_shots.py --self-test
        Composites synthetic raw shots and checks size, mode and that the
        caption is drawn; healthy cases first.

Captions: store/app-store/en-GB/screenshot_captions.txt, one
`NN-name: KICKER | Headline` per shot. Fonts: assets/fonts/Barlow-SemiBold.ttf
and Barlow-Bold.ttf (OFL). Colours: the app's theme. The frame is drawn, not
an Apple bezel image. Pillow is pinned with hashes in requirements-media.txt.
"""

import os
import re
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_store_media import png_header, shot_problems  # noqa: E402 — beside this script
from check_store_media import read_captions as parse_captions  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
FONTS = os.path.join(ROOT, "assets", "fonts")
CAPTIONS = os.path.join(ROOT, "store", "app-store", "en-GB", "screenshot_captions.txt")

TOP, BOTTOM = (0x0F, 0x4A, 0x38), (0x0B, 0x3D, 0x2E)   # pitch-raised -> pitch, at 55%
GOLD, WHITE = (0xFF, 0xD1, 0x66), (0xFF, 0xFF, 0xFF)
BEZEL, OUTLINE = (0x06, 0x14, 0x0F), (0x1C, 0x63, 0x49)

# Dee's table (#226, 23 Oct). Boxes are (x, y, width, height).
SPEC = {
    "iphone": {"canvas": (1320, 2868), "kicker": (46, 200), "headline": (112, 118, 1160, 268),
               "screen": (160, 622, 1000, 2173), "screen_r": 140,
               "bezel": (138, 600, 1044, 2217), "bezel_r": 162},
    "ipad": {"canvas": (2064, 2752), "kicker": (56, 190), "headline": (128, 134, 1810, 270),
             "screen": (267, 630, 1530, 2040), "screen_r": 36,
             "bezel": (237, 600, 1590, 2100), "bezel_r": 66},
}
TRACKING = 0.12        # em, the kicker only
OUTLINE_PX = 3
SHADOW = (0.45, 40, 50)  # opacity, y offset, Gaussian radius (CSS blur 100 px)
ASPECT_TOLERANCE = 0.01  # a raw shot within 1% of the screen's shape is scaled, not refused


class Refused(Exception):
    pass


def font(weight, size):
    return ImageFont.truetype(os.path.join(FONTS, f"Barlow-{weight}.ttf"), size)


def read_captions(path):
    """{name: (kicker, headline)} in file order, through check_store_media.py's parser."""
    try:
        return parse_captions(path)
    except ValueError as e:
        raise Refused(str(e)) from None


def wrap(text, f, width):
    """The headline in at most two lines of `width` pixels, or Refused."""
    lines, cur = [], ""
    for word in text.split():
        trial = f"{cur} {word}".strip()
        if f.getlength(trial) <= width:
            cur = trial
            continue
        if not cur:
            raise Refused(f"the word {word!r} is wider than {width} px")
        lines.append(cur)
        cur = word
        if f.getlength(cur) > width:
            raise Refused(f"the word {word!r} is wider than {width} px")
    if cur:
        lines.append(cur)
    if len(lines) > 2:
        raise Refused(f"the headline {text!r} runs to {len(lines)} lines in {width} px; two at most")
    return lines


def check_captions(captions):
    for name, (kicker, headline) in captions.items():
        for display, s in SPEC.items():
            size, _, width, _ = s["headline"]
            try:
                wrap(headline, font("Bold", size), width)
            except Refused as e:
                raise Refused(f"{name} ({display}): {e}") from None
            ksize, _ = s["kicker"]
            if tracked_width(kicker.upper(), font("SemiBold", ksize)) > s["canvas"][0] - 2 * s["bezel"][0]:
                raise Refused(f"{name} ({display}): the kicker {kicker!r} is wider than the frame")


def tracked_width(text, f):
    track = f.size * TRACKING
    return sum(f.getlength(c) for c in text) + track * max(len(text) - 1, 0)


def rr_mask(canvas, box, radius, scale=3):
    """An anti-aliased rounded-rectangle mask the size of the canvas."""
    w, h = canvas
    x, y, bw, bh = box
    big = Image.new("L", (w * scale, h * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        (x * scale, y * scale, (x + bw) * scale - 1, (y + bh) * scale - 1), radius=radius * scale, fill=255)
    return big.resize((w, h), Image.LANCZOS)


def background(canvas):
    w, h = canvas
    stop = int(h * 0.55)
    col = Image.new("RGB", (1, h))
    for y in range(h):
        t = min(y / stop, 1.0)
        col.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)))
    return col.resize((w, h))


def compose_one(raw_path, display, kicker, headline):
    s = SPEC[display]
    canvas = s["canvas"]
    raw = Image.open(raw_path)
    raw.load()
    sx, sy, sw, sh = s["screen"]
    have, want = raw.width / raw.height, sw / sh
    if abs(have - want) / want > ASPECT_TOLERANCE:
        raise Refused(f"{os.path.basename(raw_path)} is {raw.width}x{raw.height}, not the {display} screen's shape "
                      f"({sw}x{sh}); is it from the other simulator?")
    img = background(canvas)

    # Shadow under the bezel, then the outline, the bezel and the screen.
    opacity, dy, blur = SHADOW
    bx, by, bw, bh = s["bezel"]
    shadow = rr_mask(canvas, (bx, by + dy, bw, bh), s["bezel_r"], scale=1).filter(ImageFilter.GaussianBlur(blur))
    img.paste(Image.new("RGB", canvas, (0, 0, 0)), (0, 0), shadow.point(lambda v: int(v * opacity)))
    img.paste(Image.new("RGB", canvas, OUTLINE), (0, 0), rr_mask(canvas, s["bezel"], s["bezel_r"]))
    inner = (bx + OUTLINE_PX, by + OUTLINE_PX, bw - 2 * OUTLINE_PX, bh - 2 * OUTLINE_PX)
    img.paste(Image.new("RGB", canvas, BEZEL), (0, 0), rr_mask(canvas, inner, s["bezel_r"] - OUTLINE_PX))
    screen = Image.new("RGB", canvas)
    screen.paste(raw.convert("RGB").resize((sw, sh), Image.LANCZOS), (sx, sy))
    img.paste(screen, (0, 0), rr_mask(canvas, s["screen"], s["screen_r"]))

    draw = ImageDraw.Draw(img)
    ksize, ky = s["kicker"]
    kf = font("SemiBold", ksize)
    text = kicker.upper()
    x = (canvas[0] - tracked_width(text, kf)) / 2
    for c in text:
        draw.text((x, ky), c, font=kf, fill=GOLD, anchor="la")
        x += kf.getlength(c) + ksize * TRACKING
    hsize, lh, hwidth, hy = s["headline"]
    hf = font("Bold", hsize)
    for i, line in enumerate(wrap(headline, hf, hwidth)):
        draw.text((canvas[0] / 2, hy + i * lh), line, font=hf, fill=WHITE, anchor="ma")
    return img


def compose(raw_dir, out_dir, display, captions_path):
    if display not in SPEC:
        raise Refused(f"display is iphone or ipad, not {display!r}")
    captions = read_captions(captions_path)
    check_captions(captions)
    raws = {f[:-4]: os.path.join(raw_dir, f) for f in sorted(os.listdir(raw_dir))
            if re.match(r"^\d\d-.+\.png$", f)}
    no_caption = sorted(set(raws) - set(captions))
    no_shot = sorted(set(captions) - set(raws))
    if no_caption:
        raise Refused(f"no caption for {', '.join(no_caption)} in {os.path.basename(captions_path)}")
    if no_shot:
        raise Refused(f"no raw {display} shot for {', '.join(no_shot)} in {raw_dir}")
    os.makedirs(out_dir, exist_ok=True)
    for name, path in raws.items():
        kicker, headline = captions[name]
        out = os.path.join(out_dir, name + ".png")
        compose_one(path, display, kicker, headline).save(out, "PNG", optimize=True)
        print(f"{display}: {name}.png <- {os.path.basename(path)}: {kicker} | {headline}")
    return sorted(raws)


def on_black(picture, out, width, height):
    """The plan picture, fitted inside 92% of a black WIDTH x HEIGHT screen, centred."""
    pic = Image.open(picture).convert("RGB")
    scale = min(width * 0.92 / pic.width, height * 0.92 / pic.height)
    fitted = pic.resize((max(1, round(pic.width * scale)), max(1, round(pic.height * scale))), Image.LANCZOS)
    img = Image.new("RGB", (width, height), (0, 0, 0))
    img.paste(fitted, ((width - fitted.width) // 2, (height - fitted.height) // 2))
    img.save(out, "PNG", optimize=True)
    print(f"{out}: the plan picture ({pic.width}x{pic.height}) on black, {width}x{height}")


# --- Self-test: healthy cases first -----------------------------------------

def self_test():
    failed = total = 0

    def check(name, cond):
        nonlocal failed, total
        total += 1
        failed += not cond
        print(f"  {'ok' if cond else 'x '} {name}")

    def refuses(name, fn, *words):
        try:
            fn()
            check(name, False)
        except Refused as e:
            check(name, all(w in str(e) for w in words))

    def near(a, b, tol=12):
        return all(abs(x - y) <= tol for x, y in zip(a, b))

    def band_count(img, y0, y1, colour, tol=30):
        raw = img.crop((0, y0, img.width, y1)).tobytes()
        return sum(1 for i in range(0, len(raw), 3) if near(raw[i:i + 3], colour, tol))

    RAW = (0x33, 0x66, 0xCC)
    with tempfile.TemporaryDirectory() as d:
        caps = os.path.join(d, "captions.txt")

        def captions(text):
            with open(caps, "w", encoding="utf-8") as fh:
                fh.write(text)
            return caps

        for display, raw_size in (("iphone", (1320, 2868)), ("ipad", (2064, 2752))):
            s = SPEC[display]
            raw_dir, out_dir = os.path.join(d, f"raw-{display}"), os.path.join(d, display)
            os.makedirs(raw_dir)
            Image.new("RGBA", raw_size, RAW + (255,)).save(os.path.join(raw_dir, "01-alert.png"))
            Image.new("RGB", raw_size, RAW).save(os.path.join(raw_dir, "02-fairness.png"))
            names = compose(raw_dir, out_dir, display, captions(
                "# a comment\n01-alert: SUB ALERTS | Never miss a sub\n"
                "02-fairness: FAIR SHARES | Everyone within five minutes a game\n"))
            out = os.path.join(out_dir, "01-alert.png")
            img = Image.open(out)
            w, h, colour = png_header(out)
            check(f"healthy {display}: two shots composited, in file-name order", names == ["01-alert", "02-fairness"])
            check(f"healthy {display}: {s['canvas'][0]}x{s['canvas'][1]}, Apple's exact size",
                  (w, h) == s["canvas"] and img.size == s["canvas"])
            check(f"healthy {display}: RGB, no alpha (PNG colour type 2), even from an RGBA raw shot",
                  img.mode == "RGB" and colour == 2)
            check(f"healthy {display}: check_store_media.py passes the output", shot_problems(out_dir, display) == [])
            ksize, ky = s["kicker"]
            check(f"healthy {display}: the kicker is drawn in gold in its band",
                  band_count(img, ky, ky + ksize, GOLD) > 200)
            hsize, _, _, hy = s["headline"]
            check(f"healthy {display}: the headline is drawn in white in its band",
                  band_count(img, hy, hy + hsize, WHITE) > 2000)
            two = Image.open(os.path.join(out_dir, "02-fairness.png"))
            lh = s["headline"][1]
            check(f"healthy {display}: a long headline wraps to a second line",
                  band_count(two, hy + lh, hy + lh + hsize, WHITE) > 2000)
            sx, sy, sw, sh = s["screen"]
            check(f"healthy {display}: the raw shot fills the screen",
                  near(img.getpixel((sx + sw // 2, sy + sh // 2)), RAW, 2)
                  and near(img.getpixel((sx + sw // 2, sy + 10)), RAW, 2))
            bx, by, _, _ = s["bezel"]
            check(f"healthy {display}: the bezel is drawn round the screen",
                  near(img.getpixel((sx - (sx - bx) // 2, sy + sh // 2)), BEZEL, 4))
            check(f"healthy {display}: the top is the app's pitch colour, outside the text",
                  near(img.getpixel((10, 10)), TOP, 3))

        raw_dir = os.path.join(d, "raw-iphone")
        os.makedirs(os.path.join(d, "older"))
        Image.new("RGB", (1290, 2796), RAW).save(os.path.join(d, "older", "01-alert.png"))
        check("healthy: a 6.7\" iPhone raw shot (1290x2796) is within the shape and scales",
              compose(os.path.join(d, "older"), os.path.join(d, "older-out"), "iphone",
                      captions("01-alert: SUB ALERTS | Never miss a sub\n")) == ["01-alert"])
        check_captions(read_captions(CAPTIONS))
        check("healthy: the committed captions parse and fit two lines on both displays",
              len(read_captions(CAPTIONS)) == 8)
        pic = os.path.join(d, "plan.png")
        Image.new("RGBA", (1080, 1440), (0x2F, 0x7A, 0x52, 255)).save(pic)
        black = os.path.join(d, "03-plan.png")
        on_black(pic, black, 1320, 2868)
        b = Image.open(black)
        check("healthy: the plan picture on black is the raw size, RGB, picture centred, black round it",
              b.size == (1320, 2868) and b.mode == "RGB" and near(b.getpixel((660, 1434)), (0x2F, 0x7A, 0x52), 2)
              and b.getpixel((5, 5)) == (0, 0, 0))

        refuses("refuses: a headline that runs to three lines",
                lambda: compose(raw_dir, os.path.join(d, "x"), "iphone", captions(
                    "01-alert: SUB ALERTS | Never miss a sub, never miss a sub, never miss a sub, ever again\n"
                    "02-fairness: FAIR SHARES | Fair\n")), "01-alert", "lines")
        refuses("refuses: a raw shot with no caption",
                lambda: compose(raw_dir, os.path.join(d, "x"), "iphone",
                                captions("01-alert: SUB ALERTS | Never miss a sub\n")), "no caption", "02-fairness")
        refuses("refuses: a caption with no raw shot (a missing shot is never skipped)",
                lambda: compose(raw_dir, os.path.join(d, "x"), "iphone", captions(
                    "01-alert: A | B\n02-fairness: C | D\n03-plan: SHARE THE PLAN | Parents see every sub time\n")),
                "no raw iphone shot", "03-plan")
        refuses("refuses: an iPad-shaped raw shot in the iPhone set",
                lambda: compose(os.path.join(d, "raw-ipad"), os.path.join(d, "x"), "iphone",
                                captions("01-alert: A | B\n02-fairness: C | D\n")), "2064x2752", "other simulator")
        refuses("refuses: a line without the ' | ' between kicker and headline",
                lambda: read_captions(captions("01-alert: SUB ALERTS Never miss a sub\n")), "line 1")
        refuses("refuses: the same shot captioned twice",
                lambda: read_captions(captions("01-alert: A | B\n01-alert: C | D\n")), "twice")
        refuses("refuses: an empty captions file", lambda: read_captions(captions("# nothing\n")), "no captions")
    print(f"{total - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    args = argv[1:]
    try:
        if args == ["--self-test"]:
            return self_test()
        if len(args) == 5 and args[0] == "compose":
            compose(args[1], args[2], args[3], args[4])
            return 0
        if len(args) == 5 and args[0] == "on-black":
            on_black(args[1], args[2], int(args[3]), int(args[4]))
            return 0
        if len(args) == 2 and args[0] == "check-captions":
            caps = read_captions(args[1])
            check_captions(caps)
            print(f"{args[1]}: {len(caps)} captions, each within two lines on iPhone and iPad")
            return 0
    except Refused as e:
        print(f"MEDIA PROBLEM: {e}")
        return 1
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))

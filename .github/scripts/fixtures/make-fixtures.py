#!/usr/bin/env python3
"""
Regenerate the rendered screen fixtures used by test_smoke_assert.py.

NOT run in CI. It needs Pillow and a DejaVu font, neither of which the smoke
job depends on; the fixtures it produces are committed so the self-test stays
stdlib-only. Run it only when the Slice 0a screen changes enough that the
fixtures stop resembling it:

    python3 -m venv /tmp/fx && /tmp/fx/bin/pip install pillow
    /tmp/fx/bin/python .github/scripts/fixtures/make-fixtures.py

The three fixtures stand for the three outcomes that matter:

  good.png        the first screen of a fresh install as #218 draws it: the
                  placeholder "Your team" above the Getting started card and
                  its purpose line — must PASS
  blank-white.png the exact failure this whole job exists to catch: an APK
                  that is valid, signed and identified, and renders nothing
  wrong-text.png  the right colours and layout, the wrong squad name — the
                  case that proves the OCR assertion is doing work the
                  blankness assertion cannot do

The geometry mirrors a 1080x1920 emulator at ~420dpi, so the glyph sizes
tesseract sees here are close to the ones it sees on the device.
"""

import os

from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920
BG = (11, 61, 46)        # App.tsx styles.container.backgroundColor
FG = (255, 255, 255)     # styles.squad / styles.clock colour
CAPTION = (207, 227, 218)  # styles.caption colour
DENSITY = 2.625          # 420dpi / 160

BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
HERE = os.path.dirname(os.path.abspath(__file__))
# #218: the fresh-install Home is drawn in the face the app ships (assets/fonts).
FONTS = os.path.join(HERE, "..", "..", "..", "assets", "fonts")
BARLOW_BOLD = os.path.join(FONTS, "Barlow-Bold.ttf")
BARLOW_SEMI = os.path.join(FONTS, "Barlow-SemiBold.ttf")
BARLOW = os.path.join(FONTS, "Barlow-Regular.ttf")
MUTED = (143, 179, 165)  # theme.ts colours.inkMuted
RAISED = (15, 74, 56)    # theme.ts colours.pitchRaised
ACCENT = (18, 133, 90)   # theme.ts colours.accent


def sp(points: int) -> int:
    return int(points * DENSITY)


def status_bar(draw: ImageDraw.ImageDraw, colour) -> None:
    """The system draws this whatever the app does — which is precisely why
    the blankness check measures the content region and not the whole frame."""
    font = ImageFont.truetype(REGULAR, sp(13))
    draw.text((30, 20), "12:34", font=font, fill=colour)
    draw.text((W - 160, 20), "100%", font=font, fill=colour)


def app_screen(path: str, squad: str) -> None:
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    status_bar(d, FG)
    d.text((W // 2, H // 2 - 170), squad, font=ImageFont.truetype(BOLD, sp(28)),
           fill=FG, anchor="mm")
    d.text((W // 2, H // 2 - 20), "00:00", font=ImageFont.truetype(REGULAR, sp(72)),
           fill=FG, anchor="mm")
    caption = ImageFont.truetype(REGULAR, sp(14))
    d.text((W // 2, H // 2 + 140), "Slice 0a - walking skeleton", font=caption,
           fill=CAPTION, anchor="mm")
    d.text((W // 2, H // 2 + 190),
           "The clock is a placeholder and does not run.", font=caption,
           fill=CAPTION, anchor="mm")
    im.save(path)
    print(f"wrote {path}")


def first_open_screen(path: str, squad: str) -> None:
    """Home on a fresh install (#218): the title, then the Getting started
    card (its label, the purpose line, the three steps), then Play now."""
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    status_bar(d, FG)
    x = sp(18)
    d.text((W // 2, sp(60)), squad, font=ImageFont.truetype(BARLOW_BOLD, sp(24)), fill=FG, anchor="mm")
    top = sp(84)
    d.rounded_rectangle((x, top, W - x, top + sp(330)), radius=sp(14), fill=RAISED, outline=ACCENT, width=3)
    inner = x + sp(14)
    d.text((inner, top + sp(18)), "GETTING STARTED", font=ImageFont.truetype(BARLOW, sp(13)), fill=MUTED)
    purpose = ImageFont.truetype(BARLOW_SEMI, sp(20))
    d.text((inner, top + sp(44)), "Who comes off next, and is", font=purpose, fill=FG)
    d.text((inner, top + sp(69)), "everyone getting a fair share?", font=purpose, fill=FG)
    d.text((inner, top + sp(100)), "Three steps and you are ready for Saturday.",
           font=ImageFont.truetype(BARLOW, sp(14)), fill=MUTED)
    step = ImageFont.truetype(BARLOW_SEMI, sp(17))
    more = ImageFont.truetype(BARLOW, sp(13))
    for i, (name, detail) in enumerate((
        ("Add your squad", "First names only - 0 of 7 added"),
        ("Add your next match", "Who you are playing, and when"),
        ("Press Play now at kick-off", "The app keeps time and says who comes off next"),
    )):
        y = top + sp(128 + 64 * i)
        d.line((inner, y, W - inner, y), fill=(22, 79, 60), width=2)
        d.ellipse((inner, y + sp(14), inner + sp(28), y + sp(42)), outline=(110, 151, 135), width=4)
        d.text((inner + sp(40), y + sp(12)), name, font=step, fill=FG)
        d.text((inner + sp(40), y + sp(34)), detail, font=more, fill=MUTED)
    play = top + sp(348)
    d.rounded_rectangle((x, play, W - x, play + sp(50)), radius=sp(12), fill=ACCENT)
    d.text((W // 2, play + sp(25)), "Play now", font=ImageFont.truetype(BARLOW_SEMI, sp(18)), fill=FG, anchor="mm")
    im.save(path)
    print(f"wrote {path}")


def blank_screen(path: str) -> None:
    im = Image.new("RGB", (W, H), (255, 255, 255))
    status_bar(ImageDraw.Draw(im), (0, 0, 0))
    im.save(path)
    print(f"wrote {path}")


if __name__ == "__main__":
    first_open_screen(os.path.join(HERE, "good.png"), "Your team")
    app_screen(os.path.join(HERE, "wrong-text.png"), "Zephyr Utd")
    blank_screen(os.path.join(HERE, "blank-white.png"))

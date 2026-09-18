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

  good.png        the screen App.tsx is expected to produce — must PASS
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


def blank_screen(path: str) -> None:
    im = Image.new("RGB", (W, H), (255, 255, 255))
    status_bar(ImageDraw.Draw(im), (0, 0, 0))
    im.save(path)
    print(f"wrote {path}")


if __name__ == "__main__":
    app_screen(os.path.join(HERE, "good.png"), "Example FC")
    app_screen(os.path.join(HERE, "wrong-text.png"), "Zephyr Utd")
    blank_screen(os.path.join(HERE, "blank-white.png"))

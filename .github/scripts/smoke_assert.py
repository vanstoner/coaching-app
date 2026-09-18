#!/usr/bin/env python3
"""
Assert that a captured Android frame shows the running app, not a blank screen.

Called by .github/scripts/emulator-smoke.sh with a frame captured from the
emulator. Two assertions, in the order the Product Owner ruled on 2026-09-18:

  A. NOT BLANK  — the content region of the frame is not uniformly one colour.
                  This is the precise failure the whole job exists to catch:
                  every assertion in the APK build job passes on an APK that
                  renders a blank white screen.
  B. EXPECTED TEXT — OCR the frame and require the expected words to appear.
                  The strongest available proof that the *right* thing
                  rendered, not merely that something did.

Deliberately dependency-free apart from `tesseract` on PATH: no Pillow, no
ImageMagick, no numpy. Everything here is stdlib, so the script can be
dry-run anywhere, including in a container with no Android SDK. Its own
gating behaviour is proved by .github/scripts/test_smoke_assert.py.

Exit codes:
  0  every assertion passed
  1  at least one assertion failed (the diagnostic says which)
  2  the frame could not be read, or the invocation was wrong
"""

from __future__ import annotations

import argparse
import struct
import subprocess
import sys
import zlib
from collections import Counter

# --- Thresholds ------------------------------------------------------------
#
# The content region excludes the status bar and the navigation bar. Both are
# drawn by the system, not the app, so a genuinely blank app screen still has
# a clock and a battery icon in it. Measuring the whole frame would let a
# blank screen pass on system chrome alone.
CONTENT_TOP = 0.10
CONTENT_BOTTOM = 0.92

# A frame whose single most common colour covers this much of the content
# region is "uniformly one colour". Slice 0a's screen measures well under
# this: dark green background with white text over roughly 3-4% of the region.
MAX_DOMINANT_FRACTION = 0.995

# Anti-aliased text produces hundreds of distinct colours. A blank screen
# produces one. Sixteen is a floor no blank or near-blank frame reaches.
MIN_DISTINCT_COLOURS = 16

# One edit over a >=6 character needle: 8 of 9 characters must still match for
# "Example FC". Tolerant of a single OCR slip, nowhere near loose enough to
# hit on noise. See test_smoke_assert.py for the noise corpus this is run
# against.
MAX_EDITS = 1
MIN_NEEDLE_LENGTH = 6

# Glyph confusions tesseract makes on screen text, folded on BOTH the OCR
# output and the expected text so the comparison stays symmetric.
CONFUSIONS = {
    "0": "o", "1": "l", "!": "l", "|": "l", "[": "l", "]": "l",
    "5": "s", "$": "s", "8": "b", "2": "z", "6": "g", "9": "g",
    "(": "c", ")": "c", "{": "c", "}": "c", "@": "a", "€": "e", "¢": "c",
}


# --- Frame reading ---------------------------------------------------------

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


class FrameError(Exception):
    """The captured frame could not be decoded."""


def read_frame(path: str) -> tuple[int, int, bytes, int]:
    """Return (width, height, rgba_or_rgb_bytes, channels) from a capture.

    Accepts either `adb exec-out screencap -p` (a PNG) or `adb exec-out
    screencap` (a raw framebuffer). The raw form is preferred by the caller
    because decoding it is a struct unpack rather than a per-byte un-filter
    of eight megabytes in pure Python.
    """
    with open(path, "rb") as fh:
        data = fh.read()
    if not data:
        raise FrameError(f"{path} is empty — screencap produced nothing")
    if data[:8] == PNG_MAGIC:
        return decode_png(data)
    return decode_raw_screencap(data)


def decode_raw_screencap(data: bytes) -> tuple[int, int, bytes, int]:
    """Decode the raw buffer `adb exec-out screencap` writes.

    Layout is width, height, pixel format as little-endian uint32, followed on
    Android 9 and later by a colour-space uint32, then width*height*4 bytes of
    pixel data (screencap writes width*bpp per row, dropping stride padding).
    Both header lengths are tried and validated against the payload size, so a
    mismatch is a clear error rather than a silently misread image.
    """
    for header in (12, 16):
        if len(data) < header:
            continue
        width, height, pixfmt = struct.unpack_from("<III", data, 0)
        if width <= 0 or height <= 0:
            continue
        if len(data) - header == width * height * 4:
            if pixfmt not in (1, 2, 5):  # RGBA_8888, RGBX_8888, BGRA_8888
                raise FrameError(
                    f"raw screencap pixel format {pixfmt} is not a 4-byte format"
                )
            return width, height, data[header:], 4
    raise FrameError(
        f"raw screencap buffer of {len(data)} bytes matches no known header "
        "layout — capture the frame with `screencap -p` instead"
    )


def decode_png(data: bytes) -> tuple[int, int, bytes, int]:
    """Decode an 8-bit, non-interlaced RGB or RGBA PNG. Stdlib only."""
    pos = 8
    idat = bytearray()
    width = height = depth = colour = None
    interlace = 0
    while pos + 8 <= len(data):
        (length,) = struct.unpack_from(">I", data, pos)
        ctype = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, depth, colour, _comp, _filt, interlace = struct.unpack(
                ">IIBBBBB", body
            )
        elif ctype == b"IDAT":
            idat += body
        elif ctype == b"IEND":
            break
    if width is None:
        raise FrameError("PNG has no IHDR chunk")
    if depth != 8 or colour not in (2, 6) or interlace != 0:
        raise FrameError(
            f"unsupported PNG: bit depth {depth}, colour type {colour}, "
            f"interlace {interlace} (expected 8-bit RGB/RGBA, non-interlaced)"
        )
    channels = 3 if colour == 2 else 4
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    out = bytearray(height * stride)
    prev = bytearray(stride)
    src = 0
    for y in range(height):
        ftype = raw[src]
        src += 1
        line = bytearray(raw[src : src + stride])
        src += stride
        if ftype == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ftype == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        elif ftype != 0:
            raise FrameError(f"unknown PNG filter type {ftype} on row {y}")
        out[y * stride : (y + 1) * stride] = line
        prev = line
    return width, height, bytes(out), channels


def encode_png(path: str, width: int, height: int, pixels: bytes, channels: int) -> None:
    """Write an 8-bit PNG with no per-row filtering. Stdlib only."""
    if channels not in (3, 4):
        raise FrameError(f"cannot encode {channels}-channel pixels")
    stride = width * channels
    scanlines = b"".join(
        b"\x00" + pixels[y * stride : (y + 1) * stride] for y in range(height)
    )

    def chunk(tag: bytes, body: bytes) -> bytes:
        return (
            struct.pack(">I", len(body))
            + tag
            + body
            + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6 if channels == 4 else 2, 0, 0, 0)
    with open(path, "wb") as fh:
        fh.write(PNG_MAGIC)
        fh.write(chunk(b"IHDR", ihdr))
        fh.write(chunk(b"IDAT", zlib.compress(scanlines, 6)))
        fh.write(chunk(b"IEND", b""))


def invert(pixels: bytes, channels: int) -> bytes:
    """Invert RGB, leaving alpha alone.

    The app draws white text on a dark background; tesseract is trained on
    dark text on a light one. Inverting is the single most effective thing
    that can be done to the frame before OCR without a raster library.
    """
    out = bytearray(pixels)
    for i in range(0, len(out), channels):
        out[i] = 255 - out[i]
        out[i + 1] = 255 - out[i + 1]
        out[i + 2] = 255 - out[i + 2]
    return bytes(out)


# --- Assertion A: the frame is not blank -----------------------------------


def content_histogram(
    width: int, height: int, pixels: bytes, channels: int
) -> tuple[Counter, int]:
    """Colour histogram of the content region, ignoring alpha."""
    top = int(height * CONTENT_TOP)
    bottom = max(top + 1, int(height * CONTENT_BOTTOM))
    stride = width * channels
    counts: Counter = Counter()
    total = 0
    for y in range(top, min(bottom, height)):
        row = pixels[y * stride : (y + 1) * stride]
        for x in range(0, stride, channels):
            counts[row[x : x + 3]] += 1
            total += 1
    return counts, total


def check_not_blank(width, height, pixels, channels, report) -> bool:
    counts, total = content_histogram(width, height, pixels, channels)
    if total == 0:
        report("frame has no content region to measure")
        return False
    colour, hits = counts.most_common(1)[0]
    dominant = hits / total
    distinct = len(counts)
    report(
        f"content region {width}x{int(height * CONTENT_BOTTOM) - int(height * CONTENT_TOP)}"
        f" ({total} px); dominant colour #{colour[0]:02x}{colour[1]:02x}{colour[2]:02x}"
        f" covers {dominant:.4%}; {distinct} distinct colours"
    )
    ok = True
    if dominant >= MAX_DOMINANT_FRACTION:
        report(
            f"ASSERTION FAILED (not blank): the screen is uniformly one colour — "
            f"{dominant:.4%} of the content region is "
            f"#{colour[0]:02x}{colour[1]:02x}{colour[2]:02x}, "
            f"threshold is {MAX_DOMINANT_FRACTION:.4%}"
        )
        ok = False
    if distinct < MIN_DISTINCT_COLOURS:
        report(
            f"ASSERTION FAILED (not blank): only {distinct} distinct colours in the "
            f"content region, expected at least {MIN_DISTINCT_COLOURS} — nothing "
            "anti-aliased was drawn"
        )
        ok = False
    return ok


# --- Assertion B: the expected text is on screen ----------------------------


def normalise_words(text: str) -> list[str]:
    """Lower-case, fold OCR confusions, split into runs of a-z0-9.

    Word structure is kept rather than thrown away because it is what stops
    the assertion matching inside a longer token. `com.example.coachingapp` —
    which Android puts on screen in a crash dialog, and React Native puts in
    its red box — contains `examplec`, one edit from the needle. Without a
    word boundary the gate would pass on exactly the screen it exists to
    catch. The self-test holds that case.
    """
    folded = "".join(CONFUSIONS.get(ch, ch) for ch in text.lower())
    words: list[str] = []
    current: list[str] = []
    for ch in folded:
        if "a" <= ch <= "z" or "0" <= ch <= "9":
            current.append(ch)
        elif current:
            words.append("".join(current))
            current = []
    if current:
        words.append("".join(current))
    # `rn` read as `m` is the classic OCR confusion; fold it within each word,
    # on both the reading and the expected text, so the comparison stays
    # symmetric.
    return [w.replace("rn", "m") for w in words]


def normalise(text: str) -> str:
    """The flat, word-boundary-free form. Used for the needle and in tests."""
    return "".join(normalise_words(text))


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(
                min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
            )
        prev = cur
    return prev[-1]


def screen_text_contains(
    reading: str, expected: str, max_edits: int = MAX_EDITS
) -> bool:
    """True if an OCR `reading` shows `expected`, allowing `max_edits` slips.

    The match must begin where a word begins and end where a word ends, so it
    cannot land inside a longer token. Spaces between the words are ignored,
    because tesseract merges and splits them freely.

    With MAX_EDITS = 1 and a nine-character needle, eight of nine characters
    must match in order at a word boundary. That tolerates a single glyph
    slip and does not fire on noise — test_smoke_assert.py runs it against a
    corpus of both.
    """
    needle = normalise(expected)
    n = len(needle)
    if n < MIN_NEEDLE_LENGTH:
        raise ValueError(
            f"expected text {expected!r} normalises to {n} characters, which is "
            f"below the {MIN_NEEDLE_LENGTH}-character floor — too short to be a "
            "real assertion"
        )

    words = normalise_words(reading)
    flat = "".join(words)
    starts, ends, cursor = set(), set(), 0
    for word in words:
        starts.add(cursor)
        cursor += len(word)
        ends.add(cursor)

    lo = max(1, n - max_edits) if max_edits > 0 else n
    hi = n + max_edits if max_edits > 0 else n
    for length in range(lo, hi + 1):
        for i in sorted(starts):
            if i + length > len(flat) or (i + length) not in ends:
                continue
            if levenshtein(flat[i : i + length], needle) <= max_edits:
                return True
    return False


def run_tesseract(image_path: str, psm: str) -> str:
    proc = subprocess.run(
        ["tesseract", image_path, "stdout", "-l", "eng", "--psm", psm],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return ""
    return proc.stdout


def check_expected_text(
    width, height, pixels, channels, expected, workdir, report
) -> bool:
    """OCR the frame as captured and inverted, at two page-segmentation modes."""
    needle = normalise(expected)
    upright = f"{workdir}/ocr-upright.png"
    inverted = f"{workdir}/ocr-inverted.png"
    encode_png(upright, width, height, pixels, channels)
    encode_png(inverted, width, height, invert(pixels, channels), channels)

    seen: list[str] = []
    for label, path in (("as captured", upright), ("inverted", inverted)):
        # psm 6: one uniform block of text. psm 11: sparse text anywhere.
        for psm in ("6", "11"):
            raw = run_tesseract(path, psm)
            flat = " ".join(raw.split())
            seen.append(f"[{label}, psm {psm}] {flat[:400]}")
            if screen_text_contains(raw, expected):
                report(f"found {expected!r} in OCR of the frame ({label}, psm {psm})")
                report(f"  OCR read: {flat[:400]}")
                return True
    report(f"ASSERTION FAILED (expected text): {expected!r} is not on the screen")
    report(f"  looked for the normalised needle {needle!r} in:")
    for line in seen:
        report(f"    {line}")
    return False


# --- Entry point ------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("frame", help="PNG or raw screencap buffer to assert on")
    ap.add_argument(
        "--expect",
        required=True,
        help="text that must appear on screen, e.g. 'Example FC'",
    )
    ap.add_argument(
        "--png-out", help="write the decoded frame here as a PNG for the artifact"
    )
    ap.add_argument("--workdir", default=".", help="scratch directory for OCR inputs")
    ap.add_argument(
        "--quiet",
        action="store_true",
        help="suppress diagnostics; used while polling for the app to settle",
    )
    args = ap.parse_args(argv)

    needle = normalise(args.expect)
    if len(needle) < MIN_NEEDLE_LENGTH:
        print(
            f"--expect {args.expect!r} normalises to {needle!r}, "
            f"{len(needle)} characters, below the {MIN_NEEDLE_LENGTH}-character "
            "floor. A needle that short would pass on noise, which would make "
            "this gate worse than no gate.",
            file=sys.stderr,
            flush=True,
        )
        return 2

    lines: list[str] = []

    def report(message: str) -> None:
        if not args.quiet:
            print(message, flush=True)
        lines.append(message)

    try:
        width, height, pixels, channels = read_frame(args.frame)
    except FrameError as exc:
        print(f"could not read {args.frame}: {exc}", file=sys.stderr, flush=True)
        return 2

    if args.png_out:
        encode_png(args.png_out, width, height, pixels, channels)
        report(f"wrote {args.png_out} ({width}x{height}) for the artifact")

    # Order matters: the PO ruled these in increasing order of strength, and a
    # blank-screen diagnosis is more useful than "OCR found nothing".
    not_blank = check_not_blank(width, height, pixels, channels, report)
    has_text = check_expected_text(
        width, height, pixels, channels, args.expect, args.workdir, report
    )

    if not_blank and has_text:
        report("frame assertions passed: not blank, and the expected text is on screen")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())

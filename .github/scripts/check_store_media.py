#!/usr/bin/env python3
"""Check App Store screenshots and the preview video against Apple's rules — #108 E.

    check_store_media.py shots DIR iphone|ipad   every .png in DIR is a size
                                                 Apple takes for that display,
                                                 with no alpha
    check_store_media.py video FILE.json         ffprobe's JSON for the preview:
                                                 H.264, 886x1920, 30 fps or
                                                 less, 15-30 s, 500 MB or less
    check_store_media.py --self-test             healthy cases first

Sizes (App Store Connect help, "Screenshot specifications", read 2026-10-06):
iPhone 6.9" 1320x2868, 1290x2796 or 1260x2736; iPad 13" 2064x2752 or
2048x2732; portrait. App previews ("App preview specifications"): 886x1920
portrait for 6.9", H.264, up to 30 fps, 15 to 30 seconds, up to 500 MB.

PNG headers are read directly (no imaging library on the runner): the
IHDR chunk gives width, height and colour type, and colour types 4 and 6
carry alpha, which Apple refuses.
"""

import json
import os
import struct
import sys
import tempfile
import zlib

SIZES = {
    "iphone": {(1320, 2868), (1290, 2796), (1260, 2736)},
    "ipad": {(2064, 2752), (2048, 2732)},
}
PREVIEW = (886, 1920)
MAX_FPS = 30.0
SECONDS = (15.0, 30.0)
MAX_BYTES = 500 * 1024 * 1024
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def png_header(path):
    """(width, height, colour type), or None if PATH is not a PNG."""
    with open(path, "rb") as fh:
        head = fh.read(33)
    if len(head) < 33 or head[:8] != PNG_MAGIC or head[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", head[16:24])
    return width, height, head[25]


def shot_problems(folder, display):
    out = []
    pngs = sorted(f for f in os.listdir(folder) if f.lower().endswith(".png"))
    if not pngs:
        return [f"no .png screenshots in {folder}"]
    if len(pngs) > 10:
        out.append(f"{len(pngs)} screenshots; Apple takes at most 10 per display")
    for f in pngs:
        h = png_header(os.path.join(folder, f))
        if h is None:
            out.append(f"{f} is not a PNG")
            continue
        w, ht, colour = h
        if (w, ht) not in SIZES[display]:
            allowed = ", ".join(f"{a}x{b}" for a, b in sorted(SIZES[display]))
            out.append(f"{f} is {w}x{ht}; Apple takes {allowed} for {display}")
        if colour in (4, 6):
            out.append(f"{f} has an alpha channel, which Apple refuses")
    return out


def video_problems(probe):
    streams = [s for s in probe.get("streams", []) if s.get("codec_type") == "video"]
    if len(streams) != 1:
        return [f"expected one video stream, found {len(streams)}"]
    v = streams[0]
    out = []
    if v.get("codec_name") != "h264":
        out.append(f"codec is {v.get('codec_name')}, not h264")
    if (v.get("width"), v.get("height")) != PREVIEW:
        out.append(f"{v.get('width')}x{v.get('height')}, not {PREVIEW[0]}x{PREVIEW[1]}")
    try:
        num, den = (int(x) for x in str(v.get("avg_frame_rate", "0/1")).split("/"))
        fps = num / den if den else 0.0
    except ValueError:
        fps = 0.0
    if not 0 < fps <= MAX_FPS + 0.01:
        out.append(f"frame rate {fps:.2f}; Apple takes up to {MAX_FPS:.0f}")
    fmt = probe.get("format", {})
    try:
        seconds = float(fmt.get("duration", 0))
    except ValueError:
        seconds = 0.0
    if not SECONDS[0] <= seconds <= SECONDS[1]:
        out.append(f"{seconds:.2f} s long; Apple takes {SECONDS[0]:.0f} to {SECONDS[1]:.0f} s")
    if int(fmt.get("size", 0) or 0) > MAX_BYTES:
        out.append(f"{fmt.get('size')} bytes; Apple takes up to 500 MB")
    return out


# --- Self-test: healthy cases first --------------------------------------------

def make_png(path, w, h, colour):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, colour, 0, 0, 0)
    with open(path, "wb") as fh:
        fh.write(PNG_MAGIC + chunk(b"IHDR", ihdr) + chunk(b"IEND", b""))


def probe(codec="h264", w=886, h=1920, rate="30/1", seconds="25.0", size="9000000", streams=1):
    v = {"codec_type": "video", "codec_name": codec, "width": w, "height": h, "avg_frame_rate": rate}
    a = {"codec_type": "audio", "codec_name": "aac"}
    return {"streams": [v] * streams + [a], "format": {"duration": seconds, "size": size}}


def self_test():
    failed = total = 0

    def check(name, cond):
        nonlocal failed, total
        total += 1
        failed += not cond
        print(f"  {'ok' if cond else 'x '} {name}")

    def shots(display, files):
        with tempfile.TemporaryDirectory() as d:
            for name, (w, h, colour) in files.items():
                make_png(os.path.join(d, name), w, h, colour)
            return shot_problems(d, display)

    check("healthy: five iPhone 6.9\" shots, RGB", not shots("iphone", {f"0{i}.png": (1320, 2868, 2) for i in range(1, 6)}))
    check("healthy: iPad 13\" shots, RGB", not shots("ipad", {"01.png": (2064, 2752, 2), "02.png": (2048, 2732, 2)}))
    check("healthy: the preview, 25 s at 30 fps", not video_problems(probe()))
    check("healthy: the preview at 29.97 fps and exactly 15 s", not video_problems(probe(rate="30000/1001", seconds="15.0")))
    check("fails: an iPhone shot with alpha", bool(shots("iphone", {"01.png": (1320, 2868, 6)})))
    check("fails: an iPad-sized shot in the iPhone set", bool(shots("iphone", {"01.png": (2064, 2752, 2)})))
    check("fails: a landscape iPhone shot", bool(shots("iphone", {"01.png": (2868, 1320, 2)})))
    check("fails: no screenshots", bool(shots("ipad", {})))
    check("fails: eleven screenshots", bool(shots("iphone", {f"{i:02}.png": (1320, 2868, 2) for i in range(11)})))
    check("fails: a preview of 14 s", bool(video_problems(probe(seconds="14.0"))))
    check("fails: a preview of 31 s", bool(video_problems(probe(seconds="31.0"))))
    check("fails: a preview at 60 fps", bool(video_problems(probe(rate="60/1"))))
    check("fails: a preview at the simulator's size", bool(video_problems(probe(w=1320, h=2868))))
    check("fails: a HEVC preview", bool(video_problems(probe(codec="hevc"))))
    check("fails: no video stream", bool(video_problems(probe(streams=0))))
    print(f"{total - failed} expectation(s) passed, {failed} failed.")
    return 1 if failed else 0


def main(argv):
    args = argv[1:]
    if args == ["--self-test"]:
        return self_test()
    if len(args) == 3 and args[0] == "shots" and args[2] in SIZES:
        found = shot_problems(args[1], args[2])
        what = f"{args[1]} ({args[2]})"
    elif len(args) == 2 and args[0] == "video":
        with open(args[1], encoding="utf-8") as fh:
            found = video_problems(json.load(fh))
        what = args[1]
    else:
        print(__doc__, file=sys.stderr)
        return 2
    for p in found:
        print(f"MEDIA PROBLEM: {p}")
    if not found:
        print(f"{what}: within Apple's rules")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

#!/usr/bin/env python3
"""
Self-test for smoke_assert.py — proves the emulator smoke test's assertions
actually gate.

A green gate that would also be green on a blank screen is worse than no gate
at all, so this runs in CI immediately before the emulator boots. It is the
answer to "does that screenshot actually prove the app rendered?" being asked
of the mechanism rather than of one run's output.

Stdlib only, plus `tesseract` on PATH for the end-to-end cases. Run it with:

    python3 .github/scripts/test_smoke_assert.py

Exits non-zero on the first failing expectation.
"""

from __future__ import annotations

import os
import shutil
import struct
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import smoke_assert as sa  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "fixtures")

passed = 0
failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed
    if condition:
        passed += 1
        print(f"  ok    {name}")
    else:
        failures.append(f"{name}{(' — ' + detail) if detail else ''}")
        print(f"  FAIL  {name}{(' — ' + detail) if detail else ''}")


def solid(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    return bytes(rgb) * (width * height)


def with_speckles(width, height, rgb, speckles) -> bytes:
    """A solid frame with `speckles` pixels of graduated other colours."""
    buf = bytearray(solid(width, height, rgb))
    # Keep every speckle inside the content region (rows 10%-92% of the frame),
    # so they count towards the measurement rather than landing in the chrome.
    top = int(height * sa.CONTENT_TOP) + 1
    bottom = int(height * sa.CONTENT_BOTTOM) - 1
    span = (bottom - top) * width
    for i in range(speckles):
        p = (top * width + (i * 7) % span) * 3
        buf[p] = (i * 3) % 256
        buf[p + 1] = (i * 5) % 256
        buf[p + 2] = (i * 11) % 256
    return bytes(buf)


def two_tone(width, height, rgb_a, rgb_b, pixels_b) -> bytes:
    """A frame of exactly two colours, `pixels_b` of the content region in B.

    Two distinct colours is far below MIN_DISTINCT_COLOURS, while a few per
    cent of a second colour puts the dominant fraction comfortably *under*
    MAX_DOMINANT_FRACTION. So the dominant-fraction gate cannot fire on this
    frame and the distinct-colour floor is the only thing that can fail it —
    which is what makes it a test of the floor rather than of both gates at
    once.
    """
    buf = bytearray(solid(width, height, rgb_a))
    top = int(height * sa.CONTENT_TOP) + 1
    start = top * width
    for i in range(start, start + pixels_b):
        buf[i * 3 : i * 3 + 3] = bytes(rgb_b)
    return bytes(buf)


def assert_on(pixels, width, height, channels, expect, tmp) -> tuple[int, str]:
    """Run the real entry point on synthetic pixels and return (exit code, log)."""
    frame = os.path.join(tmp, "frame.png")
    sa.encode_png(frame, width, height, pixels, channels)
    proc = subprocess.run(
        [
            sys.executable,
            os.path.join(HERE, "smoke_assert.py"),
            frame,
            "--expect",
            expect,
            "--workdir",
            tmp,
        ],
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout + proc.stderr


def main() -> int:
    tmp = tempfile.mkdtemp(prefix="smoke-assert-test-")
    try:
        print("\nPNG codec round-trip")
        for channels in (3, 4):
            px = bytes(range(256)) * (16 * 16 * channels * 4 // 256)
            px = px[: 16 * 16 * channels]
            path = os.path.join(tmp, f"rt{channels}.png")
            sa.encode_png(path, 16, 16, px, channels)
            w, h, got, ch = sa.read_frame(path)
            check(
                f"{channels}-channel PNG survives encode/decode",
                (w, h, ch, got) == (16, 16, channels, px),
            )

        print("\nRaw screencap decoding")
        px = solid(8, 4, (1, 2, 3))
        rgba = b"".join(px[i : i + 3] + b"\xff" for i in range(0, len(px), 3))
        for header_len, header in (
            (12, struct.pack("<III", 8, 4, 1)),
            (16, struct.pack("<IIII", 8, 4, 1, 0)),
        ):
            path = os.path.join(tmp, f"raw{header_len}.bin")
            with open(path, "wb") as fh:
                fh.write(header + rgba)
            w, h, got, ch = sa.read_frame(path)
            check(
                f"{header_len}-byte header raw buffer decodes",
                (w, h, ch, got) == (8, 4, 4, rgba),
            )
        bad = os.path.join(tmp, "bad.bin")
        with open(bad, "wb") as fh:
            fh.write(struct.pack("<IIII", 8, 4, 1, 0) + rgba[:-7])
        try:
            sa.read_frame(bad)
            check("a truncated raw buffer is rejected", False, "it was accepted")
        except sa.FrameError:
            check("a truncated raw buffer is rejected", True)

        print("\nAssertion A — 'the screen is not blank' gates")
        W, H = 120, 200
        rc, log = assert_on(solid(W, H, (255, 255, 255)), W, H, 3, "Example FC", tmp)
        check(
            "a uniformly white screen FAILS",
            rc == 1 and "uniformly one colour" in log,
            f"exit {rc}",
        )
        rc, log = assert_on(solid(W, H, (11, 61, 46)), W, H, 3, "Example FC", tmp)
        check(
            "a uniformly dark-green screen FAILS (colour is not the point)",
            rc == 1 and "uniformly one colour" in log,
            f"exit {rc}",
        )
        # 12 speckles in a 120x200 content region measures 99.939% dominant,
        # which is *above* MAX_DOMINANT_FRACTION (99.5%), so both gates fire on
        # this frame. The expectation below therefore requires both failure
        # messages — the earlier version of this check asserted on the string
        # "distinct colours", which also appears in the informational line
        # printed for every frame, so it could not tell the floor firing from
        # the floor not firing. QA Note 1 on PR #45.
        rc, log = assert_on(
            with_speckles(W, H, (255, 255, 255), 12), W, H, 3, "Example FC", tmp
        )
        check(
            "a near-blank screen with a handful of stray pixels FAILS",
            rc == 1
            and "uniformly one colour" in log
            and "expected at least" in log,
            f"exit {rc}",
        )
        # The frame MIN_DISTINCT_COLOURS exists for: two flat colours, ~3% of
        # the content region in the second, so dominant is ~97% and the
        # dominant-fraction gate cannot fire. Only the floor can fail this, and
        # "uniformly one colour" must be absent from the log to prove it did.
        rc, log = assert_on(
            two_tone(W, H, (255, 255, 255), (11, 61, 46), 600),
            W,
            H,
            3,
            "Example FC",
            tmp,
        )
        check(
            "a two-colour screen under the dominant threshold FAILS on the "
            "distinct-colour floor alone",
            rc == 1
            and "expected at least" in log
            and "uniformly one colour" not in log,
            f"exit {rc}",
        )

        print("\nAssertion B — 'the expected text is on screen' gates")
        rc, log = assert_on(
            with_speckles(W, H, (11, 61, 46), 4000), W, H, 3, "Example FC", tmp
        )
        check(
            "a busy but textless screen passes 'not blank' and FAILS on OCR",
            rc == 1
            and "uniformly one colour" not in log
            and "ASSERTION FAILED (expected text)" in log,
            f"exit {rc}",
        )

        print("\nOCR tolerance — degraded readings that must still match")
        needle = sa.normalise("Example FC")
        check("the needle normalises to 'examplefc'", needle == "examplefc", needle)
        for reading in (
            "Example FC",
            "EXAMPLE FC",
            "example  fc",
            "Exarnple FC",          # rn read as m
            "Examp1e FC",           # 1 read as l
            "Examp|e FC",           # pipe read as l
            "ExampleFC",            # the two words run together
            "Exa mple FC",          # one word split in two
            "Example F0",           # 0 read as o, then one edit
            "Example FG",           # one substitution
            "Exampl FC",            # one deletion
            "12:34 100%\nExample FC\n00:00\nSlice 0a",
        ):
            check(
                f"matches {reading!r}",
                sa.screen_text_contains(reading, "Example FC"),
            )

        print("\nOCR tolerance — readings that must NOT match")
        for reading in (
            "",
            "Zephyr Utd 00:00 Slice 0a - walking skeleton",
            "Example",                         # the second word missing entirely
            "Unable to load script. Make sure you are running Metro",
            "12:34 100% 5G",
            "unfortunately coaching app has stopped",
            "aslkdjf qwpeori zxcvmn 1029384756 ~~~ ,,, ;;;",
            "e x a m",
            "sample fee",
            "exemplify",
            "com.example.coachingapp",         # a crash dialog, not a rendered screen
            "com.example.coachingapp keeps stopping",
            "Texample FCx",                    # the needle buried inside a token
            "theexamplefcorp",
        ):
            check(
                f"rejects {reading!r}",
                not sa.screen_text_contains(reading, "Example FC"),
            )

        print("\nThe assertion cannot be weakened into a no-op")
        try:
            sa.screen_text_contains("anything at all FC", "FC")
            check("a too-short expected text is rejected", False, "it was accepted")
        except ValueError:
            check("a too-short expected text is rejected", True)
        proc = subprocess.run(
            [
                sys.executable,
                os.path.join(HERE, "smoke_assert.py"),
                os.path.join(FIXTURES, "good.png"),
                "--expect",
                "FC",
                "--workdir",
                tmp,
            ],
            capture_output=True,
            text=True,
        )
        check(
            "the workflow cannot pass a two-character --expect",
            proc.returncode == 2 and "below the" in proc.stderr,
            f"exit {proc.returncode}",
        )

        if shutil.which("tesseract") is None:
            check(
                "tesseract is installed",
                False,
                "not on PATH — the end-to-end fixture cases cannot run",
            )
        else:
            version = subprocess.run(
                ["tesseract", "--version"], capture_output=True, text=True
            ).stdout.splitlines()[0]
            print(f"\nEnd-to-end against rendered fixtures ({version})")
            cases = (
                ("good.png", 0, "a rendered 'Example FC' screen PASSES"),
                ("blank-white.png", 1, "a blank white screen FAILS"),
                ("wrong-text.png", 1, "a screen rendering the wrong squad FAILS"),
            )
            for name, want, label in cases:
                path = os.path.join(FIXTURES, name)
                if not os.path.exists(path):
                    check(label, False, f"missing fixture {path}")
                    continue
                proc = subprocess.run(
                    [
                        sys.executable,
                        os.path.join(HERE, "smoke_assert.py"),
                        path,
                        "--expect",
                        "Example FC",
                        "--workdir",
                        tmp,
                        "--quiet",
                    ],
                    capture_output=True,
                    text=True,
                )
                check(label, proc.returncode == want, f"exit {proc.returncode}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print(f"\n{passed} expectation(s) passed, {len(failures)} failed.")
    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f"  x {f}")
        return 1
    print("smoke_assert.py gates as specified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

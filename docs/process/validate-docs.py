#!/usr/bin/env python3
"""
Documentation validator — the first piece of the deterministic docs build (ADR-005).

Run from the repo root:
    python3 docs/process/validate-docs.py

Exits non-zero on failure, so it can gate CI.

Checks:
  1. Every internal markdown link resolves to a real file.
  2. Every ADR has the required sections and a valid status.
  3. Every spec declares a status.
  4. Specs left in Draft beyond MAX_DRAFT_DAYS are reported (process check:
     catches specs written, never approved, and quietly implemented anyway).
"""

import re
import sys
from datetime import datetime, timezone
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent
MAX_DRAFT_DAYS = 30

LINK_RE = re.compile(r'\[([^\]]+)\]\(([^)]+)\)')
ADR_SECTIONS = ("## Context", "## Decision", "## Consequences", "## Alternatives considered")
ADR_STATUSES = ("Proposed", "Accepted", "Superseded", "Rejected")

errors: list[str] = []
warnings: list[str] = []


def check_links() -> int:
    checked = 0
    for f in sorted(DOCS.rglob("*.md")):
        for label, target in LINK_RE.findall(f.read_text(encoding="utf-8")):
            if target.startswith(("http://", "https://", "#", "mailto:")):
                continue
            clean = target.split("#")[0]
            if not clean:
                continue
            checked += 1
            if not (f.parent / clean).resolve().exists():
                rel = f.relative_to(DOCS)
                errors.append(f"broken link in {rel}: [{label}]({target})")
    return checked


def check_adrs() -> int:
    adr_dir = DOCS / "decisions"
    if not adr_dir.is_dir():
        return 0
    count = 0
    for f in sorted(adr_dir.glob("[0-9]*.md")):
        count += 1
        text = f.read_text(encoding="utf-8")
        rel = f.relative_to(DOCS)
        for section in ADR_SECTIONS:
            if section not in text:
                errors.append(f"{rel}: missing required section '{section}'")
        m = re.search(r"^\*\*Status:\*\*\s*(.+)$", text, re.MULTILINE)
        if not m:
            errors.append(f"{rel}: missing '**Status:**' line")
        elif not any(s in m.group(1) for s in ADR_STATUSES):
            errors.append(f"{rel}: unrecognised status '{m.group(1).strip()}'")
    return count


def check_specs() -> int:
    spec_dir = DOCS / "specs"
    if not spec_dir.is_dir():
        return 0
    count = 0
    now = datetime.now(timezone.utc)
    for f in sorted(spec_dir.glob("*.md")):
        count += 1
        text = f.read_text(encoding="utf-8")
        rel = f.relative_to(DOCS)
        m = re.search(r"^Status:\s*(.+)$", text, re.MULTILINE)
        if not m:
            errors.append(f"{rel}: missing 'Status:' line")
            continue
        status = m.group(1)
        if "Draft" in status:
            d = re.search(r"^Last updated:\s*(\d{4}-\d{2}-\d{2})", text, re.MULTILINE)
            if d:
                updated = datetime.strptime(d.group(1), "%Y-%m-%d").replace(tzinfo=timezone.utc)
                age = (now - updated).days
                if age > MAX_DRAFT_DAYS:
                    warnings.append(
                        f"{rel}: in Draft for {age} days "
                        f"(>{MAX_DRAFT_DAYS}) — approve it or close it"
                    )
    return count


def main() -> int:
    links = check_links()
    adrs = check_adrs()
    specs = check_specs()

    print(f"Checked {links} internal links, {adrs} ADRs, {specs} specs.")

    if warnings:
        print(f"\n{len(warnings)} warning(s):")
        for w in warnings:
            print(f"  ! {w}")

    if errors:
        print(f"\n{len(errors)} error(s):")
        for e in errors:
            print(f"  x {e}")
        return 1

    print("\nAll documentation checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

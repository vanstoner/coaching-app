#!/usr/bin/env python3
"""
Documentation validator — the first piece of the deterministic docs build (ADR-005).

Run from the repo root:
    python3 docs/process/validate-docs.py

Exits non-zero on failure, so it can gate CI.

Checks:
  1. Every internal markdown link resolves to a real file.
  2. Every ADR has the required sections and a valid status, and its
     status line starts with what the ADR index says (#259).
  3. Every spec declares a status: feature-specs.md, domain-models.md and
     system-architecture.md. Checking none is a failure, not a pass: this
     check once read a removed folder and passed on "0 specs" (#259).
  4. Specs left in Draft beyond MAX_DRAFT_DAYS are reported (process check:
     catches specs written, never approved, and quietly implemented anyway).
  5. Every row of feature-specs.md has a Status from the vocabulary (#259):
     a Built row names, in Code, a file that exists, and every `src/` path a
     Built row cites exists; a Built–differs row says how; a Ready, Proposed
     or Idea row names its issue (#NNN); no issue waits twice.

Offline by design (ADR-005): whether an issue is open, or carries the
target: label its heading says, is not checked here.
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

REPO = DOCS.parent
SPEC_FILES = ("feature-specs.md", "domain-models.md", "system-architecture.md")
FEATURE_SPECS = DOCS / "feature-specs.md"
ROW_STATUSES = ("Built", "Ready", "Proposed", "Idea")
DIFFERS_RE = re.compile(r"^Built[–-]differs:\s*\S")
SUPERSEDED_RE = re.compile(r"^Superseded\b.*\S")
ISSUE_RE = re.compile(r"#(\d+)")
SRC_PATH_RE = re.compile(r"`((?:src/|App\.tsx)[^`\s]*)`")
CODE_PATH_RE = re.compile(r"`([^`\s]+\.[A-Za-z]+)`")

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
    count = 0
    now = datetime.now(timezone.utc)
    for name in SPEC_FILES:
        f = DOCS / name
        if not f.is_file():
            errors.append(f"{name}: spec file missing")
            continue
        count += 1
        text = f.read_text(encoding="utf-8")
        m = re.search(r"^Status:\s*(.+)$", text, re.MULTILINE)
        if not m:
            errors.append(f"{name}: missing 'Status:' line")
            continue
        status = m.group(1)
        if "Draft" in status:
            d = re.search(r"^Last updated:\s*(\d{4}-\d{2}-\d{2})", text, re.MULTILINE)
            if d:
                updated = datetime.strptime(d.group(1), "%Y-%m-%d").replace(tzinfo=timezone.utc)
                age = (now - updated).days
                if age > MAX_DRAFT_DAYS:
                    warnings.append(
                        f"{name}: in Draft for {age} days "
                        f"(>{MAX_DRAFT_DAYS}) — approve it or close it"
                    )
    if count == 0:
        errors.append("no spec checked: a check that checks nothing must not pass")
    return count


def cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def check_rows(path: Path = FEATURE_SPECS) -> dict[str, int]:
    """Check 5: each feature-spec row's Status, and what that status needs."""
    counts: dict[str, int] = {}
    if not path.is_file():
        return counts
    rel = path.relative_to(DOCS) if path.is_relative_to(DOCS) else path.name
    lines = path.read_text(encoding="utf-8").splitlines()
    waiting: dict[str, int] = {}
    in_waiting = False
    header: list[str] | None = None
    for n, line in enumerate(lines, 1):
        if line.startswith("## "):
            in_waiting = line.strip() == "## Waiting to build"
        if not line.startswith("|"):
            header = None
            continue
        row = cells(line)
        if header is None:
            header = row
            # A spec table names a Feature or an Issue, and must have a Status.
            if ("Feature" in row or "Issue" in row) and "Status" not in row:
                errors.append(f"{rel}:{n}: table has no Status column")
            continue
        if set(line.replace("|", "").strip()) <= set("-: "):
            continue
        if "Status" not in header or not ("Feature" in header or "Issue" in header):
            continue
        status = row[header.index("Status")] if len(row) == len(header) else ""
        where = f"{rel}:{n} ({row[0]})"
        if status in ROW_STATUSES:
            kind = status
        elif DIFFERS_RE.match(status):
            kind = "Built–differs"
        elif SUPERSEDED_RE.match(status) and status != "Superseded":
            kind = "Superseded"
        else:
            errors.append(f"{where}: status '{status}' is not one of Built, "
                          "Built–differs: <how>, Ready, Proposed, Idea, Superseded by <what>")
            continue
        counts[kind] = counts.get(kind, 0) + 1
        if kind in ("Built", "Built–differs"):
            code = row[header.index("Code")] if "Code" in header else ""
            named = CODE_PATH_RE.findall(code)
            if not named:
                errors.append(f"{where}: a {kind} row names no file in Code")
            for p in set(named) | set(SRC_PATH_RE.findall(line)):
                if not (REPO / p).is_file():
                    errors.append(f"{where}: cites `{p}`, which does not exist")
        if kind in ("Ready", "Proposed", "Idea"):
            issues = ISSUE_RE.findall(line)
            if not issues:
                errors.append(f"{where}: a {kind} row names no issue #NNN")
            elif in_waiting:
                first = issues[0]
                if first in waiting:
                    errors.append(f"{where}: #{first} already waits at line {waiting[first]}")
                waiting[first] = n
    if not counts:
        errors.append(f"{rel}: no feature rows found: a check that checks nothing must not pass")
    return counts


def check_adr_index() -> None:
    """Each ADR file's status line starts with its row in the index (#259)."""
    adr_dir = DOCS / "decisions"
    index = adr_dir / "README.md"
    if not index.is_file():
        return
    row_re = re.compile(r"^\| \[(\d{3})\]\(\./([^)]+)\) \|[^|]*\| (.+?) \| [^|]*\|$")
    for line in index.read_text(encoding="utf-8").splitlines():
        m = row_re.match(line)
        if not m:
            continue
        f = adr_dir / m.group(2)
        if not f.is_file():
            continue  # a broken link is reported by check_links
        s = re.search(r"^\*\*Status:\*\*\s*(.+)$", f.read_text(encoding="utf-8"), re.MULTILINE)
        if s and not s.group(1).strip().startswith(m.group(3).strip()):
            errors.append(
                f"decisions/{m.group(2)}: status '{s.group(1).strip()}' does not match "
                f"the index's '{m.group(3).strip()}'"
            )


def main() -> int:
    links = check_links()
    adrs = check_adrs()
    check_adr_index()
    specs = check_specs()
    rows = check_rows()

    print(f"Checked {links} internal links, {adrs} ADRs, {specs} specs, "
          f"{sum(rows.values())} feature-spec rows.")
    if rows:
        print("  " + ", ".join(f"{k} {v}" for k, v in sorted(rows.items())))

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

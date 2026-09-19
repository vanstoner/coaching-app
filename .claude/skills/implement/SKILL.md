---
name: implement
description: Build an issue against its acceptance criteria on a branch, prove it with pasted evidence, and say plainly what was not done. Use when writing product code in src/ or App.tsx. Carries the Android and Hermes traps this project has already paid for. The Engineer discipline (Ellis).
---

Build the issue in front of you, prove it works, say plainly what you did not do.

## Produce

- Product code in `src/` and `App.tsx`, and tests for it that run in Node.
- A branch, a commit with `Refs:` and `Squad-Role:` trailers, a PR with
  **pasted evidence** — never assertions.

## Never

- Write your own acceptance criteria, or merge.
- Report partial work as complete.
- Put React or platform imports in the match engine.

## Gates — all of them, before every push

```bash
npx vitest run
npx tsc --noEmit
npm run bundle:check
python3 .github/scripts/test_smoke_assert.py
python3 .github/scripts/check_refs_trailer.py --self-test
python3 docs/process/validate-docs.py
```

## Android and Hermes traps, each paid for in CI cycles

- **Metro does not resolve a `.js` specifier onto a `.ts` file.** Extensionless
  relative imports. `bundle:check` catches it — after four minutes of Gradle if
  you skip it.
- **Hermes is not Node.** `crypto.randomUUID()` crashed the app on launch. Test
  with the capability removed from `globalThis`.
- **Text sized to its own measurement loses its last glyph.** Never change
  `fontWeight` between states; never size a box to text with `minWidth`; use
  `alignSelf: 'stretch'` with `textAlign: 'center'`, `includeFontPadding: false`
  and `flexShrink: 0`. This has occurred four separate times.
- **A centred screen that does not scroll hides everything below the fold.**
  `flexGrow: 1` inside a `ScrollView` centres a short screen and scrolls a tall
  one. This shipped a settings link nobody could reach.
- **Hermes stores a non-ASCII string as UTF-16LE**, so a byte-grep for its
  UTF-8 form finds nothing in a bundle that contains it.
- RN activities are edge-to-edge; screens need `SafeAreaView`.

## Rules that bite

- **CI green is not proof it works.** Four defects reached Rob's phone green.
  The emulator gate proves text is *present* — not complete, not reachable.
- **A test encoding old behaviour is replaced, not worked around**, and the
  commit says which ruling overturned it.
- **Every screen needs a way out.** A screen whose only exit commits the user
  to something is a trap; the lineup screen was one.
- **Report partial work as partial.** A known gap reported is a managed risk.

## Learned here

- `tsc` finds call sites that 200 tests miss. Widening a type and following the
  errors is a refactoring tool, not an obstacle.
- The fix Rob asks for is usually smaller than the fix you designed.

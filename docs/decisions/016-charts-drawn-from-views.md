# ADR-016: Charts are bars we draw ourselves, from a pure numbers module

**Status:** Accepted
**Date:** 2026-10-04
**Decision maker:** Architect, on the Product Owner's ruling of 2026-10-04 (#98 ruling 6, `approve 1 2 3 4 5 6 7 8 9`; criteria in #105)

## Context

#105 asks for two charts. The first shows this match's playing time per
player, with a shadow bar of each player's season average behind it. The
second shows the season average per player, split by competition. Both must
be legible at arm's length and colour-blind safe (AC4). Their numbers must
come from a pure, tested module (AC5).

Verified on `main` at 64a11af:

- No chart or drawing library is installed. `react-native-svg` is not even a
  transitive dependency.
- Expo SDK 57's `bundledNativeModules.json` pins `react-native-svg` 15.15.4
  and `@shopify/react-native-skia` 2.6.2. `victory-native` is not listed: it
  is third party, and needs Skia, Reanimated and Gesture Handler.
- `api.expo.dev` is blocked from this sandbox, so an Expo install needs
  `EXPO_OFFLINE=1 npx expo install <pkg>`.

iOS is coming (#107), so a native dependency costs on two platforms.

## Decision

1. **Both charts are horizontal bars drawn with plain React Native `View` and
   `Text`.** There is no new dependency. A bar is a rectangle whose width is a
   fraction of the track, and the shadow is a rectangle behind it. Nothing in
   #105 needs a path, a curve or a rotated label.
2. **`react-native-svg` is the named next step.** When a chart genuinely
   needs a path, such as a season trend line, add it with
   `EXPO_OFFLINE=1 npx expo install react-native-svg`, which pins the SDK's
   version. Skia and victory-native are not used.
3. **The numbers live in a pure module** (`src/app/analysis.ts`, which imports
   no React). It reads the ledger fold (ADR-014), the match and `now`, and
   returns rows that are ready to draw. The screen only maps rows to boxes.
   Figures follow ADR-015.
4. **Visual contract: this match (#105 AC1).** There is one row per player who
   attended:
   - `thisMatchMs`: total pitch time so far. During a match this includes the
     open interval, recomputed from anchors at each repaint (invariant 2). It
     is drawn as a solid bar in two segments, goal and outfield, which differ
     in lightness and are labelled. Hue alone is never used.
   - `shadowMs`: the ADR-015 §9 average, or null. It is drawn as an outlined,
     unfilled bar behind the solid one. When it is null there is no shadow,
     and the label says "no average yet".
   - **Scale:** one axis per chart. Its maximum is the greater of this match's
     length and the largest shadow, so bars are comparable within the chart.
   - **Label:** first name, then whole minutes this match, then the average,
     for example "Ava 32 · avg 28".
   - **Order:** decided and tested in the module. By default the player
     furthest below their usual comes first, because that is the subbing
     question.
   - Absent players get no bar, which would be a fabricated zero. They are
     listed by first name underneath.
5. **Visual contract: season (#105 AC2, #103).** There is one group per
   player, with one bar per competition bucket ADR-015 §8 returns, each
   labelled with its minutes and its match count (n). A null bucket draws
   nothing, never a zero bar. Buckets are distinguished by position and label
   first, and by a colour-blind-safe palette second.
6. **Accessibility:** each row carries one `accessibilityLabel` that reads
   the same text as its visible label.

## Consequences

**Easier:**
- No native module and no APK size change.
- iOS needs nothing.
- When screens get a test harness, they will need no native mocks.
- Every number is asserted in `analysis.test.ts`.

**Harder:** anything beyond bars, such as lines, areas or axes with ticks,
means adding `react-native-svg` first. That is a native dependency, so the
first build after it needs a full APK build. It is cheap and reversible.

**Accepted:** the charts look plain, which is what makes them legible at the
touchline.

## Alternatives considered

**`react-native-svg` now** (the suggested direction). It is the Expo standard
and is small. It was rejected for this scope only: it would add a native
module, and a jest/vitest mock, for rectangles that `View` already draws. It
stays the first choice when a path is needed.

**victory-native or another chart library on Skia.** These are heavier: Skia,
Reanimated and Gesture Handler are native dependencies on both platforms, and
their chart defaults would have to be overridden to meet AC4 anyway. This
breaks "the least machinery that satisfies the criteria".

**A WebView with a JS chart library.** This would mean a second runtime and
slow first paint at the touchline, and it is hard to test. Rejected.

# Handover prompt

Copy everything below the line into a fresh session with a new team. It is
written to be read cold, by people with no memory of this project.

It is deliberately unflattering. A handover that only lists achievements makes
the next team repeat the mistakes.

---

## You are taking over a project in progress

You are inheriting `vanstoner/coaching-app` from a previous team. Read this
whole brief before you touch anything. Your first job is **not** to continue the
plan — it is to decide what to keep, and to get the Product Owner something he
can use on a Saturday.

### The product

A junior football coaching app. One coach (Rob, the Product Owner), one squad of
under-10s, one match a week on a Saturday, 50 minutes, played in quarters or
halves. Between Tuesday training and the Saturday match a teamsheet goes out to
children and parents so they can flag absence.

It exists to answer one question at the touchline: **who comes off next, and is
everyone getting a fair share of the game?** It is a substitution reminder, not
a timing system.

The Product Owner's own words, which override any inherited document that
contradicts them:

> "approx. times aren't going to cause major harm and I am not trying to audit a
> match, I just want something that reminds me to put a substitute on, alerts me
> if a match is running really weirdly and that doesn't die in a heap if I forget
> to stop the clock"

### What actually exists and works

- A **pure-TypeScript match engine** in `src/engine/` with 66 passing tests. No
  React or platform imports; runs without a device. This is the best asset in
  the repository.
- **CI on GitHub Actions**, two workflows: `ci.yml` (vitest, tsc, docs
  validator) and `android-apk.yml` (build, emulator smoke test, release).
- **A release APK that genuinely runs.** `assembleRelease` embeds the JS bundle;
  an emulator smoke test installs that exact artifact on a clean Android 14
  device with every `adb reverse` tunnel torn down, and asserts the app launches,
  does not crash, draws a non-blank screen, and that OCR reads the squad name
  off it. This is real proof, not a green tick.
- A large body of specs, ADRs and process documents in `docs/`.

### What does not exist

- **Any product feature.** The app is a walking skeleton: a screen showing a
  placeholder squad name and the words "the clock is a placeholder and does not
  run". A coach can do nothing with it.
- Squad entry, on/off pitch tracking, the substitution alert, the sub command —
  all unbuilt. This is "Slice 1" and it is the entire point of the product.
- Anything that has run on real hardware. At handover, check whether a human has
  ever installed the app. If the answer is still no, that is your first problem.

### The five invariants — keep these

Each is an ADR in `docs/decisions/`. They are load-bearing and were arrived at
for good reasons. Do not relitigate them without evidence.

1. **Minutes are derived by folding, never stored as running totals.** The
   displayed figure and the audit trail must be incapable of disagreeing.
2. **Elapsed time comes from wall-clock anchors, never tick counting.** Android
   throttles background JS timers; ticks are silently lost.
3. **Fairness is total outfield playing time, never per position.**
4. **First names only. No PII.** Children's data. No surnames, DOB, contacts or
   photos, in the model or the UI. Real squad data is never committed.
5. **Corrections are explicit, noted, and never destructive.**

Alongside them sits a proportionality ruling that matters as much as they do:
*this is not audit-grade timing; seconds-level accuracy is sufficient; surviving
a forgotten clock matters more than refining precision.* Three separate pieces
of over-engineering were stopped by that sentence. Keep it.

### What went wrong — so you do not repeat it

Be blunt with yourselves about this. The previous team's failures were
structural, not accidental.

1. **A beautiful spine with nothing running on it.** Thousands of lines of
   specification and eleven ADRs were written before a single line of app code
   or any CI. The Product Owner had to point this out himself.
2. **Process work crowded out product work.** Operating models, role charters,
   squad diagrams, release-management design and an outward-facing programme
   document were all produced while the app still did nothing. Some of it is
   genuinely good. None of it was what the Product Owner needed on a Saturday.
3. **The pipeline was built on an unverified precondition.** The release job was
   gated on a git tag. Nobody checked whether the agent could push a tag. It
   cannot: `git push` of a tag ref disconnects, and `POST /git/refs` returns
   `403 "Write access to this GitHub API path is not permitted through this
   proxy"`. The job therefore never executed once. **Verify that you can perform
   every step of a pipeline before you build on it.**
4. **Acceptance criteria were repeatedly not written.** The charters say the
   Business Analyst writes them and implementers never set their own pass mark.
   In practice the analyst agent kept dying to rate limits and the work silently
   fell back to the orchestrator, which then built to its own interpretation —
   exactly the failure the separation exists to prevent.
5. **Self-inflicted CI defects burned real time.** Assertions written too
   strictly and never exercised against a healthy input: a permission gate that
   rejected an app-scoped permission AndroidX mints; a `[ -s file ]` test that
   failed because `adb reverse --list` prints one empty line rather than zero
   bytes, so the gate fired precisely when there were no tunnels. Both cost a
   full build cycle. **Dry-run the happy path, not just the failure path.**
6. **Decisions made in conversation did not reach documents**, despite a written
   rule saying that loses them. They were duly lost, and rediscovered late.

### The honest state of the process

There are five named agent roles — Business Analyst, Architect, Engineer, QA,
Platform Engineer — with charters in `docs/roles/`. The separation is sound in
principle and produced at least two real catches (a duration check that passed
on two offsetting one-millisecond errors; an OCR matcher that passed on crash
dialogs). Decide for yourselves whether it earned its overhead here.

Known weaknesses, stated plainly:

- **One GitHub account authors everything.** There is no platform-level
  separation between roles; a commit trailer is the only marker and it is added
  voluntarily. The approval gate is a convention, not an enforcement.
- **Agents die to rate limits often**, and when they do the work reverts to
  whoever is orchestrating, quietly dissolving the role boundaries.
- **Work labelled "parked" accumulated** without anyone tracking the total.

### How the Product Owner wants to work

His response time is the bottleneck, not your throughput. Respect that.

- **Decide** — put options to him in chat, *before* the work. Every decision
  carries: what is being decided, the options, **a recommendation with
  reasoning**, the cost to reverse, what it unblocks, and a link. A neutral menu
  with no recommendation is an unfinished handoff.
- **Approve** — he says the word, you merge. He does not touch the merge button.
- **Interrogate** — PRs, issues and docs are where he goes for detail. They are
  the archive, not the interface.
- **Never hand him manual steps.** No "copy this file", no "run these commands".

He is a platform engineer by background. He spotted the infrastructure gap, he
rejected an over-engineered schema-versioning ADR that the agents recommended
accepting, and he was right that a green build should cut a release
automatically. **When he pushes back on a technical design, take it seriously.**

### Your first decisions

Do not start by writing a plan. Start by answering these, with evidence:

1. **Is there an installable APK the Product Owner can actually download?**
   Check the repository's Releases. If not, fix that before anything else.
2. **What is the minimum that makes this useful at one real match?** Squad entry,
   who is on the pitch, elapsed time per player, and an alert when someone is due
   to come off. Nothing else.
3. **What do you keep from `docs/`?** The five invariants and the engine specs
   have earned their place. Much of the process documentation may not have. You
   are explicitly permitted to archive it.
4. **What is the smallest role structure that still stops an implementer marking
   its own homework?** Possibly fewer than five roles.

### Ground rules that are not negotiable

- Real squad data is never committed. Player data lives on the device.
- Nothing captured from a device running a real squad is ever attached to a
  release — no database export, no screenshot from the coach's phone, no logcat,
  no crash dump. The repository is public and release assets are world-readable
  and permanent.
- The match engine stays pure TypeScript, testable without a device.
- Report partial work as partial. A known gap reported is a managed risk; a
  concealed one is a latent defect.
- Escalate ambiguity rather than guessing. A confident wrong guess is the most
  expensive failure mode here.

### The one-sentence version

There is a well-tested engine, a real CI pipeline and an APK that provably runs,
wrapped in far more process than a one-coach app needs, and **no feature a coach
can use** — so build the substitution reminder, get it onto a phone, and only
add process back when something concrete goes wrong.

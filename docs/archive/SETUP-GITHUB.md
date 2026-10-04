# Connecting GitHub — setup guide

You're on a personal laptop as admin, and you want to work in VS Code alongside
me. That makes **linking your computer** clearly the better of the two options:
your existing GitHub auth is reused, nothing sensitive is stored in a cloud
session, and you see every file change live in VS Code.

Do this whenever convenient — nothing is blocked in the meantime.

---

## Step 1 — Create the repo (2 minutes, in your browser)

1. Go to <https://github.com/new>
2. **Repository name:** `coaching-app` (or your preference)
3. **Visibility: Private.** Recommended — even with first names only, a private
   repo keeps squad data out of public view and avoids any GDPR grey area.
4. Do **not** tick "Add a README", ".gitignore", or a licence — I'll push a
   scaffold and those would cause a conflict.
5. Click **Create repository** and leave the page open; you'll want the URL.

---

## Step 2 — Get a local clone and the GitHub CLI

Open a terminal on your laptop.

**Install the GitHub CLI** if you don't have it:

- **macOS:** `brew install gh`
- **Windows:** `winget install --id GitHub.cli`
- **Linux:** see <https://github.com/cli/cli#installation>

**Authenticate** — this is the step that avoids creating a long-lived token:

```bash
gh auth login
```

Choose: `GitHub.com` → `HTTPS` → `Login with a web browser`. Paste the one-time
code it shows into the browser window it opens. Auth is then stored in your
system keychain, scoped to your machine, and revocable at any time.

**Clone the empty repo** into wherever you keep projects:

```bash
cd ~/Projects          # or your preferred location
gh repo clone <your-username>/coaching-app
cd coaching-app
```

---

## Step 3 — Link the folder to this session

This is what gives me limited, scoped access — I can only reach the folder you
explicitly connect, nothing else on your laptop.

1. Open the **Claude desktop app** on this laptop.
2. Open this task in it (or start a new task with this computer selected).
3. Choose **"Link to this computer"**.
4. When prompted for folders, connect **only** `~/Projects/coaching-app`.

That's the boundary: one folder, read/write, nothing outside it. I can't see
your documents, your other repos, or anything else.

---

## Step 4 — Open in VS Code

```bash
code ~/Projects/coaching-app
```

Once linked, we work in the same directory. You'll see my edits appear in VS
Code as they happen, and I'll see yours. You can review a diff, stage things
yourself, or hand commits back to me.

---

## What I'll do once linked

1. Push the spec documents already written (domain model, match engine,
   fairness ledger).
2. File the requirement issues — one per numbered requirement in your brief,
   plus the fairness and audit work your answers surfaced.
3. Set up issue labels and a milestone for the MVP.
4. Scaffold the Expo app and get it running on your Android device.

---

## Scope and revocation

**What I can access:** only the folder(s) you connect, while the desktop app is
running and this session is linked. Nothing else on the machine.

**What I cannot do:** delete files in a connected folder without asking you
first — deletion is separately permissioned and prompts you each time.

**To revoke:** unlink the computer in the desktop app, or run `gh auth logout`
to drop the GitHub credential. Both take effect immediately.

**A note on the repo:** keep it private, and if you later add real squad data
(even first names), keep it out of the repo entirely — data belongs on the
device, not in version control. I'll add a `.gitignore` that blocks common data
file patterns as a guard.

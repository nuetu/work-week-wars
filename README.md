# Work Week Wars

A live multiplayer classroom game about the four‑day work week, themed on *The Office*.
2–5 players use their phones; a host runs a big screen. Built as plain HTML/CSS/JS
with a Supabase realtime backend — **no build step**.

See [`SPEC.md`](./SPEC.md) for the full design. This README covers running and hosting it.

---

## Quick start (local)

You need any static file server (modules + the Supabase fetch don't work from `file://`).

```bash
# from this folder
python3 -m http.server 8000
```

- **Host / big screen:** open <http://localhost:8000/screen.html> on the projector.
  It creates a room and shows a 4‑letter join code + QR.
- **Players:** open <http://localhost:8000/> (or scan the QR) on phones, enter the
  code and a name. Roles are assigned in join order: Michael → Dwight → Pam → Toby → Oscar.

The host drives the game from the big screen:
- **Space** (or `→` / `Enter`) — advance to the next phase / next reveal card.
- **A** — toggle auto‑advance (skips straight to the reveal once all players lock).
- **M** — mute / unmute sound effects.
- **🔄 New game** (on‑screen button, bottom‑right) — starts a fresh game: it tells
  every connected phone and the big screen to wipe their saved session, then loads a
  brand‑new room code. Use this to reset cleanly between groups so nobody resumes a
  stale session.

A 6th+ person, or anyone joining after the game starts, joins as a **spectator** (they
watch the big screen; they don't get a role).

## It's a team game

Everyone **wins or loses together**, on two axes:

- **Output** — did the team deliver corporate's paper orders? (an absolute floor —
  corporate doesn't shrink the order book just because you work less)
- **Wellbeing** — is the team out of burnout?

**Round 1 (40h) is the baseline** — your "normal" week. **Round 2 (32h) is judged against
it:** the four‑day week only *works* if it holds output at the floor **and** leaves the
team healthier than Round 1 (less burnout, more wellbeing). The two honest failure modes
both show up — output drops (the shorter week cost you), or you just crammed five days into
four and nobody's better off.

Each role also has a personal **medal** (Dwight = Top Producer, Pam = Morale MVP, Toby =
Compliance Clear, Oscar = Books Balanced, Michael = In Control) for flavour — but a medal
never overrides the team result, so you can't "win" by optimising your own numbers while
the company tanks.

## How a game runs

1. **Lobby** — players join; host presses Space to start (needs ≥2 players).
2. **Intro + plan** — the big screen sets the scene (Dunder Mifflin, the week's brief, the
   shared team goal) **and explains the model**: the three team numbers everyone is
   steering (output / burnout / wellbeing) and how each control moves the dials. Meanwhile
   Michael sets daily meeting hours and a deep‑work target per teammate (with the same
   +/− steppers players use, plus a note on *why* he sets each). Everyone else sees the
   intro, their role, a glossary and a how‑it‑works guide on their phone.
3. **Allocate (Round 1, 40h)** — everyone splits their remaining daily hours across
   deep work / admin / learning / rest with **+/− steppers**, while a pinned
   "your week at a glance" panel shows live burnout, stress, wellbeing and productivity
   gauges. Lock in when ready.
4. **Reveal** — host steps through each character (schedule, metrics, personal medal), the
   company‑output gauge, then the **team verdict** (the round‑1 baseline result).
5. **Round 2 (32h)** — Friday is struck off. Michael may only *reduce* meetings/targets.
   Everyone re‑allocates from scratch.
6. **Final** — reveal again, the **Round 2 team verdict** (judged vs the round‑1 baseline),
   a Round 1 vs Round 2 comparison chart, a **data‑driven debrief** (the output /
   burnout / wellbeing deltas, the verdict, and a tailored "what would've helped"), and
   finally **five full‑screen discussion questions**, one per Space press — presentation
   style, to run the closing conversation.

## Hosting (Netlify / GitHub Pages)

It's all static files — deploy the folder as‑is. The join‑link/QR logic works under
plain `*.html` paths, the pretty `/screen` · `/play` URLs, and project subdirectories.

**Netlify** (config in [`netlify.toml`](./netlify.toml)):
- Drag‑and‑drop the folder onto <https://app.netlify.com/drop>, **or**
- Connect the repo — no build command, publish directory `.`. The `netlify.toml`
  already sets this up plus `/screen` and `/play` pretty URLs.

**GitHub Pages** (serving straight from the repo root):
1. Push the repo to GitHub.
2. Settings → Pages → **Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Your site goes live at `https://<user>.github.io/<repo>/screen.html`. Re-deploys
   happen on every push. (Relative paths and the QR/join logic handle the `/<repo>/`
   subdirectory automatically.)

#### Fixing the HTTPS certificate warning (custom domain)

If you serve under a custom domain (this repo ships a `CNAME` → `game.benkeil.com`)
and browsers warn that the connection isn't private / the certificate doesn't match,
GitHub Pages is serving its default `*.github.io` certificate because it hasn't yet
**provisioned a TLS certificate for your domain**. The fix is in **Settings → Pages**,
not in the code:

1. Confirm DNS points at GitHub Pages — an `A`/`ALIAS` to `185.199.108–111.153`, or a
   `CNAME` to `<user>.github.io` (this domain already does).
2. In **Settings → Pages → Custom domain**, clear the field, **Save**, wait ~1 minute,
   re-enter the domain (`game.benkeil.com`), and **Save** again. This re-triggers
   Let's Encrypt provisioning, which can take a few minutes to an hour.
3. Once the **Enforce HTTPS** checkbox is no longer greyed out, tick it.

Until the certificate is issued, share the `https://<user>.github.io/<repo>/screen.html`
URL (which always has a valid cert) instead of the custom domain.

The Supabase URL and **publishable** key are embedded in [`supabase.js`](./supabase.js).
Publishable/anon keys are designed to be public and ship in client code — access is
controlled by Row Level Security, not by hiding the key.

## Backend

A Supabase project hosts four tables (`www_rooms`, `www_players`, `www_schedules`,
`www_targets`) with Realtime enabled, plus a `project_info` table that documents which
tables belong to which project. The schema lives in [`schema.sql`](./schema.sql) (already
applied to the configured project). To use a **different** project:

1. Run `schema.sql` in the Supabase SQL editor.
2. Either edit the defaults in `supabase.js`, or create an untracked `config.js`
   (loaded before the modules — see `config.example.js`) and set `window.WWW_CONFIG`.

### Security model

Players are anonymous (no login), as fits a one‑off workshop. RLS still enforces the one
rule that matters: **a phone cannot read anyone's `www_schedules` rows until the room
reaches a reveal phase.** Writes are intentionally open (any client in the room may create/join
rooms and submit its own schedule) — acceptable for a trusted classroom, and the reason
the Supabase advisor flags permissive write policies. Everything else is filtered in app
logic, which the spec explicitly allows.

## Files

| File | Purpose |
|---|---|
| `index.html` | Landing / join page |
| `screen.html` · `screen.js` | Big‑screen host view |
| `play.html` · `play.js` | Player phone view |
| `game.js` | Pure game logic: roles, metric formulas, win/fail (no network) |
| `db.js` | Supabase queries + realtime subscriptions |
| `supabase.js` | Supabase client init (URL + publishable key) |
| `audio.js` | Synthesized sound effects (Web Audio — no audio files to host) |
| `avatars.js` | Original SVG character avatars |
| `style.css` | Shared styles |
| `schema.sql` | Database schema + RLS + realtime |
| `netlify.toml` | Netlify deploy config (drag‑and‑drop or connect‑repo) |

## Design decisions (the spec's open questions)

| # | Question | Decision |
|---|---|---|
| 1 | Slider granularity | `0.5h` steps |
| 2 | Company income during allocation | Hidden — shown only at reveal/final |
| 3 | Win/fail display | Shared **team verdict** (the headline) plus a per‑role **medal** badge + themed score |
| 4 | Debrief | Built‑in, data‑driven debrief slide (R1→R2 deltas + a tailored takeaway) |
| 6 | Phase advancement | Host advances manually with Space |
| 7 | Metric calibration | Balanced 8h day = exactly 50 on all metrics; team thresholds (`OUTPUT_FLOOR`, `BURNOUT_CAP` in `game.js`) tuned in `test/calibrate.mjs` so a normal R1 passes, a panicked grind or slack‑off fails, and the four‑day week is winnable with smart play (verified 2p–5p) |
| 8 | Target visibility | Players see their *own* deep‑work target during allocation |

### Metric model

Each metric starts at **50** for the balanced reference day and moves as weekly hours
deviate from it, with coefficients whose signs match the spec's influence table:
```
metric = clamp(50 + Σ coeff·(weekly_hoursᵢ − balancedᵢ) + roundEffects, 0, 100)
```
On top of that linear base, three refinements make it behave more like the real research
on hours and the four‑day week (see `game.js`):

- **Diminishing returns on deep work** — productivity uses a saturating curve, so each
  extra focus hour yields less output (and burnout keeps climbing), discouraging grinding.
- **Round‑2 focus bonus** — each deep‑work hour is ~15% more productive in the four‑day
  week (less waste, tighter meetings), so a shorter week roughly *maintains* output
  instead of mechanically losing it.
- **Round‑2 recovery + carryover** — the extra day off lowers baseline burnout/stress and
  raises wellbeing (a downward shift, not a cap — you can still burn out by cramming),
  while a brutal Round 1 carries residual fatigue into Round 2.

Result: a balanced 8h day scores exactly 50 across the board in Round 1, and the same
shape in the four‑day Round 2 shows lower burnout/stress, higher wellbeing, and roughly
equal output — the headline finding from real four‑day‑week trials.

### Team verdict

On top of the per‑player metrics, `teamVerdict()` (in `game.js`) decides the shared
win/lose. The team's **output** (`company_output` — deep work delivered against Michael's
targets, averaged) must clear `OUTPUT_FLOOR` in both rounds. Round 1 also needs team
burnout ≤ `BURNOUT_CAP` and records the **baseline**. Round 2 is judged *relative to that
baseline*: hold output at the floor **and** end up healthier (burnout down **and**
wellbeing up). `test/calibrate.mjs` simulates several team strategies to keep these
thresholds honest.

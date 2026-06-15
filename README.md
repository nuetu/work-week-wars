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

A 6th+ person, or anyone joining after the game starts, joins as a **spectator** (they
watch the big screen; they don't get a role).

## How a game runs

1. **Lobby** — players join; host presses Space to start (needs ≥2 players).
2. **Michael plans** — player 1 (Michael) sets daily meeting hours for everyone and a
   deep‑work target per teammate, then locks in.
3. **Allocate (Round 1, 40h)** — everyone splits their remaining daily hours across
   deep work / admin / learning / rest, watching live burnout, stress, wellbeing and
   productivity gauges. Lock in when ready.
4. **Reveal** — host steps through each character (schedule, metrics, win/fail), then a
   company‑income gauge.
5. **Round 2 (32h)** — Friday is struck off. Michael may only *reduce* meetings/targets.
   Everyone re‑allocates from scratch.
6. **Final** — reveal again, a Round 1 vs Round 2 comparison chart, and a discussion prompt.

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
| 3 | Win/fail display | Badge **plus** a themed score (e.g. Dwight's bonus €) |
| 4 | Debrief | Built‑in discussion slide |
| 6 | Phase advancement | Host advances manually with Space |
| 7 | Metric calibration | Recalibrated so a balanced 8h day = exactly 50 on all metrics; win thresholds playtested (Michael's company + Pam's team‑wellbeing bars set to 60) so every role is winnable in both rounds |
| 8 | Target visibility | Players see their *own* deep‑work target during allocation |

### Metric model

Each metric starts at **50** for the balanced reference day and moves as weekly hours
deviate from it, with coefficients whose signs match the spec's influence table. This
guarantees the calibration target and makes the four‑day week naturally lower burnout —
the lesson of the workshop. See the comments in `game.js`.
```
burnout/stress/wellbeing/productivity = clamp(50 + Σ coeff·(weekly_hoursᵢ − balancedᵢ), 0, 100)
```

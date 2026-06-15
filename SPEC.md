# Work Week Wars — Project Spec

> A live multiplayer classroom game about the four-day work week, themed on *The Office* (NBC).
> Built for a university workshop. 2–5 players on phones; a host big screen runs the show.

---

## Table of Contents

1. [Concept](#1-concept)
2. [Game Structure](#2-game-structure)
3. [Player Roles](#3-player-roles)
4. [Schedule Categories & Metrics](#4-schedule-categories--metrics)
5. [Metric Formulas](#5-metric-formulas)
6. [Game Flow](#6-game-flow)
7. [Screen Architecture](#7-screen-architecture)
8. [Supabase Schema](#8-supabase-schema)
9. [Tech Stack](#9-tech-stack)
10. [File Structure](#10-file-structure)
11. [Open Questions](#11-open-questions)

---

## 1. Concept

Players are assigned roles from *The Office*. Each player allocates a single representative workday across four hour categories. That day is multiplied over the full week (×5 in round 1, ×4 in round 2). Every role has a personal goal, a weakness, and a binary win/fail condition.

The manager (Michael) sets mandatory meeting hours for all employees **before** individual allocation begins. He also sets a personal deep work target for each employee — hitting or missing that target drives company-wide productivity and income.

Two rounds:
- **Round 1 — 40-hour week** (Mon–Fri, 5 days)
- **Round 2 — 32-hour week** (Mon–Thu, 4 days, Friday struck off)

---

## 2. Game Structure

### Daily Time Budget

| Block | Time | Hours | Notes |
|---|---|---|---|
| Morning | 09:00 – 13:00 | 4hr | Player-allocated |
| Lunch | 13:00 – 14:00 | 1hr | **Fixed. Uneditable. Not in budget.** |
| Afternoon | 14:00 – 18:00 | 4hr | Player-allocated |
| **Total workable** | | **8hr/day** | Before meeting deduction |

### Weekly Budget

| Round | Days | Raw budget | Meeting deduction | Player budget |
|---|---|---|---|---|
| Round 1 | 5 (Mon–Fri) | 40hr | `meeting_hrs_per_day × 5` | `40 − meetings` |
| Round 2 | 4 (Mon–Thu) | 32hr | `meeting_hrs_per_day × 4` | `32 − meetings` |

### Michael's Meeting Deduction

- Michael sets one **daily meeting value** (e.g. `1.5hr/day`) that applies equally to **all employees**.
- This is deducted automatically before any player allocation screen unlocks.
- Players **cannot override or skip** meetings — the hours are gone.
- In Round 2, Michael **may reduce** (but not increase) his meeting hours and deep work targets.

### Schedule Constraint

Players set **hours per day**. Weekly totals are derived:
```
weekly_hours = daily_hours × days_in_round   // 5 or 4
```

All metric calculations use weekly totals.

---

## 3. Player Roles

Roles are assigned in **join order**: Michael → Dwight → Pam → Toby → Oscar.  
With fewer than 5 players, assign from the top of this list.

---

### Michael Scott — Regional Manager
*Always player 1.*

**Unique mechanic:** Sets daily meeting hours (all employees) + individual deep work targets (per employee) before round starts. Then allocates his own schedule like everyone else.

| | |
|---|---|
| **Goal** | Feel in control — minimum meeting requirement must be hit |
| **Weakness** | Too many meetings tanks team productivity and morale |
| **Sets** | `meeting_hrs_per_day` (all), `deep_work_target` per role |
| **Win** | `weekly_meetings ≥ 6hr` AND `company_productivity ≥ 70` |
| **Fail** | Either threshold missed |

---

### Dwight Schrute — Bonus-Motivated Sales Rep

| | |
|---|---|
| **Goal** | Maximize bonus = maximize deep work hours |
| **Weakness** | Deep work without rest spikes burnout hard |
| **Win** | `actual_deep_work_hrs ≥ michael_target` AND `burnout < 80` |
| **Fail** | Misses target OR `burnout ≥ 80` |

Bonus score (display only): `(actual_deep_work / target_deep_work) × 100%`

---

### Pam Beesly — Front Desk / People Operations

| | |
|---|---|
| **Goal** | Keep team harmony — wellbeing metric acts as team buffer |
| **Weakness** | Too much admin overloads her; personal burnout climbs fast |
| **Win** | `team_wellbeing ≥ 70` AND `personal_burnout < 75` |
| **Fail** | Either threshold breached |

Pam's wellbeing score adds a flat `+5` bonus to the team-wide wellbeing aggregate if she wins.

---

### Toby Flenderson — HR

| | |
|---|---|
| **Goal** | Hit HR compliance hours (treated as Toby's "deep work") |
| **Weakness** | Every meeting hour Michael schedules eats directly into his compliance window |
| **Win** | `compliance_hrs ≥ 8hr/wk` AND `team_burnout < 65` |
| **Fail** | Either threshold breached |

`compliance_hrs` = Toby's deep work hours. If Michael schedules heavy meetings, Toby structurally cannot win without sacrificing rest.

---

### Oscar Martinez — Financial Analyst

| | |
|---|---|
| **Goal** | Precision — admin + analysis hours must stay in a stable band |
| **Weakness** | Excess meetings spike his stress disproportionately |
| **Win** | `(admin_hrs + deep_work_hrs)/wk` in range `[10, 18]` AND `stress < 70` |
| **Fail** | Outside band OR `stress ≥ 70` |

Too few hours = sloppy work. Too many = diminishing returns. Oscar needs balance, not grinding.

---

## 4. Schedule Categories & Metrics

After meetings are deducted, each player splits remaining hours across **4 categories**:

| Category | Description |
|---|---|
| `deep_work_hrs` | Focused individual output — the core productive block |
| `admin_hrs` | Email, filing, logistics — necessary but draining |
| `learning_hrs` | Development, upskilling — energising but not immediately productive |
| `rest_hrs` | Breaks, buffer, recovery, informal chat |

> **Note:** `meeting_hrs` is not a player-set category. It is deducted by the system based on Michael's input.

### Metric Influence Table

| Category | Burnout | Stress | Wellbeing | Productivity |
|---|---|---|---|---|
| Deep work | ↑↑ | → | → | ↑↑↑ |
| Meetings | ↑ | ↑↑ | ↓ | ↓ |
| Admin | ↑ | ↑ | ↓ | ↓ |
| Learning | → | → | ↑↑ | ↑ |
| Rest | ↓↓ | ↓↓ | ↑↑ | → |

All four metrics are **0–100 scores**, visible to the player on their phone during allocation. The big screen shows company-wide aggregates only.

---

## 5. Metric Formulas

All formulas operate on **weekly hours**. Calibrate coefficients so that a balanced 8hr day (3hr deep, 1hr meetings, 1hr admin, 1hr learning, 2hr rest) × 5 days produces scores near **50** on all metrics.

```js
// weekly totals
const days = round === 1 ? 5 : 4

const deep   = deep_work_hrs  * days
const meet   = meeting_hrs    * days   // from Michael
const admin  = admin_hrs      * days
const learn  = learning_hrs   * days
const rest   = rest_hrs       * days

// metric calculations
burnout      = clamp((deep * 2.8) + (meet * 1.5) + (admin * 1.2) - (rest * 3.5), 0, 100)
stress       = clamp((meet * 3.2) + (admin * 2.0) + (deep * 0.5) - (rest * 2.8) - (learn * 1.0), 0, 100)
wellbeing    = clamp((rest * 3.5) + (learn * 2.5) - (admin * 1.5) - (meet * 1.2) - (deep * 0.5), 0, 100)
productivity = clamp((deep * 3.5) + (learn * 1.0) - (meet * 1.5) - (admin * 1.0), 0, 100)

// company-level
company_productivity = average of all players' (actual_deep / target_deep) × productivity_score
company_income       = company_productivity  // display as a 0–100 gauge on big screen

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)) }
```

> **TODO (open question #3):** Calibrate these coefficients against a test scenario before locking. The balanced day above should produce ~50 across all four metrics.

---

## 6. Game Flow

### Phase State Machine

```
lobby → michael_sets → allocating → reveal → round2_setup → round2_allocating → final
```

The `phase` field in the `rooms` table drives all UI transitions via Supabase realtime.

### Step-by-Step

**Step 1 — Lobby**
- Host opens `/screen?code=XXXX` on big screen (or host generates code from `/screen`).
- Players open `/play` on phones, enter room code and display name.
- Roles assigned in join order as players connect.
- Big screen shows character portrait cards populating in real time.
- Host advances to next phase manually (spacebar or on-screen button).

**Step 2 — Michael sets meetings (Round 1)**
- `phase` → `michael_sets`
- Only Michael's phone shows the meeting hours slider + deep work target sliders per role.
- Big screen: "Michael is thinking..." animation with Michael's portrait.
- Michael locks in → `phase` → `allocating`, all other phones unlock simultaneously.

**Step 3 — All players allocate (Round 1)**
- `phase` = `allocating`
- Each player's phone shows: remaining hours after meeting deduction, 4 category sliders, live personal metric gauges (burnout, stress, wellbeing, productivity).
- Players **cannot see each other's allocations**.
- Big screen: Jackbox-style waiting screen — character portraits, checkmark animates in when each player locks.
- When all players locked → host advances to reveal.

**Step 4 — Round 1 Reveal**
- `phase` → `reveal`
- Big screen reveals character by character (host-paced, spacebar).
- Each reveal shows: schedule breakdown, metric scores, win ✓ or fail ✗ badge.
- Final card: company income gauge fills based on aggregate productivity.

**Step 5 — Round 2 Setup**
- `phase` → `round2_setup`
- Big screen: Friday visually struck through on a Mon–Fri calendar.
- Michael's phone unlocks again. He may **reduce** (not increase) meeting hours and/or deep work targets.
- All other phones show "Waiting for Michael..." screen.
- Michael locks → `phase` → `round2_allocating`

**Step 6 — All players allocate (Round 2)**
- Same as Step 3 but 32hr budget (4-day multiplier).
- Players start from zero — no carry-over from Round 1.
- Remaining hours = `32 − (michael_meeting_hrs × 4)`

**Step 7 — Final Reveal + Comparison**
- `phase` → `final`
- Same reveal sequence as Step 4.
- After all characters revealed: big screen shows side-by-side comparison chart — Round 1 vs Round 2 for each metric per player.
- Final screen: discussion prompt — *"What did you cut first — and why?"*

---

## 7. Screen Architecture

### Big Screen (`/screen`)

| Phase | Display |
|---|---|
| `lobby` | Room code (large), character portrait slots filling as players join |
| `michael_sets` | Michael portrait + "thinking..." animation |
| `allocating` | Character portraits grid, lock icon animates to checkmark per player |
| `reveal` | One character at a time — schedule bars, metric gauges, win/fail badge |
| `round2_setup` | Calendar with Friday struck off, "Michael is adjusting..." |
| `round2_allocating` | Same as `allocating` |
| `final` | Reveal sequence → comparison chart → discussion prompt |

**Design requirements:**
- Readable from back of lecture room — minimum 32px body text
- High contrast, minimal text per screen
- Host advances manually via **spacebar** (or large on-screen button)
- No sensitive player data shown during allocation phases

### Player Phone (`/play`)

| Phase | Display |
|---|---|
| Join | Room code input + display name |
| `lobby` | Role assignment card (character portrait + role description) |
| `michael_sets` | Michael only: meeting slider + per-role deep work target sliders. Others: "Waiting for Michael..." |
| `allocating` | Hour sliders (4 categories) + remaining hours counter + live metric gauges |
| Locked | "Waiting for others..." with lock confirmation |
| `reveal` | Personal win/fail result card |
| `final` | Round 1 vs Round 2 personal comparison |

---

## 8. Supabase Schema

Enable **Realtime** on all four tables. Enable **Row Level Security (RLS)**.

```sql
-- rooms
create table rooms (
  id           uuid primary key default gen_random_uuid(),
  code         text unique not null,         -- 4-letter join code
  phase        text not null default 'lobby',
  round        int  not null default 1,
  meeting_hrs  float not null default 0,     -- daily hrs set by Michael
  created_at   timestamptz default now()
);

-- players
create table players (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid references rooms(id) on delete cascade,
  role         text not null,                -- michael | dwight | pam | toby | oscar
  display_name text not null,
  locked_r1    bool not null default false,
  locked_r2    bool not null default false,
  joined_at    timestamptz default now()
);

-- schedules
create table schedules (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid references players(id) on delete cascade,
  round           int  not null,             -- 1 or 2
  deep_work_hrs   float not null default 0,  -- hours per day
  admin_hrs       float not null default 0,
  learning_hrs    float not null default 0,
  rest_hrs        float not null default 0,
  submitted_at    timestamptz default now()
);

-- targets (set by Michael per role per round)
create table targets (
  id                 uuid primary key default gen_random_uuid(),
  room_id            uuid references rooms(id) on delete cascade,
  round              int  not null,
  player_role        text not null,          -- which role this target applies to
  deep_work_target   float not null default 0 -- hrs/day Michael wants from this role
);
```

### RLS Policies

```sql
-- Players can only read/write their own schedule
create policy "own schedules only"
  on schedules for all
  using (player_id = auth.uid());

-- Schedules readable by all in reveal/final phases only
-- (implement via phase check in application layer or a Postgres function)

-- Rooms readable by anyone with the code
create policy "read rooms by code"
  on rooms for select
  using (true);

-- Targets readable by Michael (writer) and big screen (reader) only
-- Players should not see each other's targets during allocation
```

> ⚠️ **Security:** Player phones must not be able to read other players' `schedules` rows before `phase = 'reveal'`. Enforce this in RLS or filter reads in application logic.

---

## 9. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Vanilla HTML + CSS + JS | No framework, no build step |
| Realtime | Supabase JS client (`@supabase/supabase-js`) | Subscribe to `rooms` table by room code |
| Database | Supabase (Postgres) | Free tier sufficient for classroom use |
| Hosting | Netlify or GitHub Pages | Static files only |
| QR code | `qrcode.js` (CDN) | Generated client-side for join URL on big screen |
| Fonts | Google Fonts (CDN) | See UI notes below |

### Realtime Subscription Strategy

```js
// All clients subscribe to room phase changes
supabase
  .channel('room-' + roomCode)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'rooms',
    filter: `code=eq.${roomCode}`
  }, payload => handlePhaseChange(payload.new.phase))
  .subscribe()

// Big screen subscribes to player lock status
supabase
  .channel('players-' + roomId)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'players',
    filter: `room_id=eq.${roomId}`
  }, payload => updateLockStatus(payload.new))
  .subscribe()
```

---

## 10. File Structure

```
/
├── index.html          # redirect or landing (enter room code)
├── screen.html         # big screen view
├── play.html           # player phone view
├── style.css           # shared base styles
├── screen.js           # big screen logic
├── play.js             # player phone logic
├── game.js             # shared: metric formulas, phase logic, role definitions
├── supabase.js         # supabase client init (reads env vars)
└── .env                # SUPABASE_URL, SUPABASE_ANON_KEY (not committed)
```

### Role Definitions (in `game.js`)

```js
export const ROLES = {
  michael: {
    name: 'Michael Scott',
    title: 'Regional Manager',
    goal: 'control',
    weakness: 'isolation',
    win: (metrics, schedule) =>
      metrics.weekly_meetings >= 6 && metrics.company_productivity >= 70,
  },
  dwight: {
    name: 'Dwight Schrute',
    title: 'Sales Representative',
    goal: 'money',
    weakness: 'burnout',
    win: (metrics, schedule, target) =>
      schedule.deep_work_weekly >= target && metrics.burnout < 80,
  },
  pam: {
    name: 'Pam Beesly',
    title: 'Front Desk / People Ops',
    goal: 'harmony',
    weakness: 'overload',
    win: (metrics, teamMetrics) =>
      teamMetrics.wellbeing >= 70 && metrics.burnout < 75,
  },
  toby: {
    name: 'Toby Flenderson',
    title: 'HR',
    goal: 'compliance',
    weakness: 'meetings',
    win: (metrics, schedule, teamMetrics) =>
      schedule.deep_work_weekly >= 8 && teamMetrics.burnout < 65,
  },
  oscar: {
    name: 'Oscar Martinez',
    title: 'Financial Analyst',
    goal: 'precision',
    weakness: 'stress',
    win: (metrics, schedule) => {
      const band = schedule.admin_weekly + schedule.deep_work_weekly
      return band >= 10 && band <= 18 && metrics.stress < 70
    },
  },
}
```

---

## 11. Open Questions

Decide before building.

| # | Question | Options |
|---|---|---|
| 1 | Slider granularity | `0.5hr` increments or `1hr` only? |
| 2 | Company income during allocation | Show running meter on big screen, or only reveal at the end? |
| 3 | Win/fail display | Binary badge only, or show a score (e.g. "Dwight earned €4,200 bonus")? |
| 4 | Post-game debrief | Built-in discussion slide in the app, or lecturer takes over after final reveal? |
| 5 | Room expiry | Auto-delete rooms after X hours to keep database clean? |
| 6 | Phase advancement | Host advances manually (spacebar), or auto-advance when all players lock? |
| 7 | Metric coefficient calibration | Needs a test run — balanced 8hr day should produce ~50 on all metrics |
| 8 | Michael's target visibility | Can employees see their own deep work target during allocation, or is it hidden until reveal? |

---

*Spec version 0.1 — June 2026*
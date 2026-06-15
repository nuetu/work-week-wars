// game.js — shared game logic: roles, metric formulas, win/fail, phase machine.
// No DOM, no Supabase. Imported by play.js and screen.js (and the calibration test).

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

// Assignment order (Michael is always player 1). With <5 players, fill from top.
export const ROLE_ORDER = ['michael', 'dwight', 'pam', 'toby', 'oscar']

export const ROLES = {
  michael: {
    name: 'Michael Scott',
    title: 'Regional Manager',
    emoji: '🧑‍💼',
    color: '#2f6fb3',
    goal: 'Feel in control — your meetings must happen.',
    weakness: 'Too many meetings tank team productivity and morale.',
    // metrics: company-level; schedule: this player's weekly hours
    // Per-day so it scales with the round: ≥1.2h/day = 6h in R1, 4.8h in R2.
    // (A fixed weekly 6h would trap Michael in R2, where he can only reduce.)
    win: (m, s) => s.meet / s.days >= 1.2 && m.company_productivity >= 60,
    // Friendly description of the bar to clear, shown on cards.
    target: 'Meetings ≥ 1.2h/day  &  company productivity ≥ 60',
  },
  dwight: {
    name: 'Dwight Schrute',
    title: 'Sales Representative',
    emoji: '🥋',
    color: '#9c7a2e',
    goal: 'Maximize your bonus — hit Michael’s deep-work target.',
    weakness: 'Deep work without rest spikes burnout hard.',
    win: (m, s) => s.deep >= s.target_weekly && m.burnout < 80,
    target: 'Deep work ≥ target  &  burnout < 80',
  },
  pam: {
    name: 'Pam Beesly',
    title: 'Front Desk / People Ops',
    emoji: '🎨',
    color: '#b8552e',
    goal: 'Keep the team happy — you are the wellbeing buffer.',
    weakness: 'Too much admin overloads you; your burnout climbs fast.',
    win: (m, s) => m.team_wellbeing >= 60 && m.burnout < 75,
    target: 'Team wellbeing ≥ 60  &  your burnout < 75',
  },
  toby: {
    name: 'Toby Flenderson',
    title: 'Human Resources',
    emoji: '📋',
    color: '#5a7d5a',
    goal: 'Hit HR compliance hours (your "deep work").',
    weakness: 'Every meeting Michael schedules eats your compliance window.',
    win: (m, s) => s.deep >= 8 && m.team_burnout < 65,
    target: 'Compliance ≥ 8h/wk  &  team burnout < 65',
  },
  oscar: {
    name: 'Oscar Martinez',
    title: 'Financial Analyst',
    emoji: '📊',
    color: '#3b6e6e',
    goal: 'Precision — keep admin + analysis in a stable band.',
    weakness: 'Excess meetings spike your stress disproportionately.',
    win: (m, s) => {
      const band = s.admin + s.deep
      return band >= 10 && band <= 18 && m.stress < 70
    },
    target: 'Admin + deep work in 10–18h  &  stress < 70',
  },
}

// ---------------------------------------------------------------------------
// Phase machine
// ---------------------------------------------------------------------------

export const PHASES = [
  'lobby',
  'michael_sets',
  'allocating',
  'reveal',
  'round2_setup',
  'round2_allocating',
  'final',
]

// The next phase the host advances to. `final` is terminal.
export function nextPhase(phase) {
  const i = PHASES.indexOf(phase)
  if (i < 0 || i >= PHASES.length - 1) return null
  return PHASES[i + 1]
}

// Which round a phase belongs to.
export function roundForPhase(phase) {
  return phase === 'round2_setup' || phase === 'round2_allocating' || phase === 'final'
    ? 2
    : 1
}

export function daysInRound(round) {
  return round === 1 ? 5 : 4
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

// Player-allocated categories (meetings are set by Michael, not here).
export const CATEGORIES = [
  { key: 'deep_work_hrs', short: 'deep', label: 'Deep work', desc: 'Focused output. The core productive block.', emoji: '🎯' },
  { key: 'admin_hrs', short: 'admin', label: 'Admin', desc: 'Email, filing, logistics — necessary but draining.', emoji: '🗂️' },
  { key: 'learning_hrs', short: 'learn', label: 'Learning', desc: 'Development, upskilling — energising, slow payoff.', emoji: '📚' },
  { key: 'rest_hrs', short: 'rest', label: 'Rest', desc: 'Breaks, buffer, recovery, informal chat.', emoji: '☕' },
]

export const METRICS = [
  { key: 'burnout', label: 'Burnout', good: 'low' },
  { key: 'stress', label: 'Stress', good: 'low' },
  { key: 'wellbeing', label: 'Wellbeing', good: 'high' },
  { key: 'productivity', label: 'Productivity', good: 'high' },
]

// ---------------------------------------------------------------------------
// Time budget
// ---------------------------------------------------------------------------

export const RAW_DAILY_HOURS = 8 // 09–13 + 14–18, lunch excluded
export const SLIDER_STEP = 0.5 // open question #1

// Hours a player may allocate per day, after Michael's meetings are removed.
export function dailyAllocatable(meetingHrsPerDay) {
  return Math.max(0, RAW_DAILY_HOURS - meetingHrsPerDay)
}

// Weekly player budget = (8 - meetings) * days.
export function weeklyBudget(meetingHrsPerDay, round) {
  return dailyAllocatable(meetingHrsPerDay) * daysInRound(round)
}

// ---------------------------------------------------------------------------
// Metric formulas  (open question #7 — calibrated here)
// ---------------------------------------------------------------------------
//
// Model: every metric starts at 50 for the "balanced day" and moves as the
// weekly hours deviate from that balanced reference. This guarantees the spec's
// calibration target — a balanced 8h day (3 deep / 1 meeting / 1 admin /
// 1 learning / 2 rest) × 5 days scores 50 on all four metrics — and the signs
// of the coefficients reproduce the spec's Metric Influence Table:
//
//   Category   Burnout  Stress  Wellbeing  Productivity
//   Deep work    ↑↑       →        →           ↑↑↑
//   Meetings     ↑        ↑↑       ↓           ↓
//   Admin        ↑        ↑        ↓           ↓
//   Learning     →        →        ↑↑          ↑
//   Rest         ↓↓       ↓↓       ↑↑          →

// Balanced reference, in WEEKLY hours (the 5-day balanced week).
export const BALANCED_WEEKLY = { deep: 15, meet: 5, admin: 5, learn: 5, rest: 10 }

const INFLUENCE = {
  burnout:      { deep:  2.0, meet:  1.0, admin:  1.0, learn:  0.0, rest: -2.0 },
  stress:       { deep:  0.0, meet:  2.0, admin:  1.0, learn:  0.0, rest: -2.0 },
  wellbeing:    { deep:  0.0, meet: -1.0, admin: -1.0, learn:  2.0, rest:  2.0 },
  // productivity's deep term is handled by deepProductivity() (diminishing returns),
  // not this linear coefficient; meet/admin/learn stay linear.
  productivity: { deep:  0.0, meet: -1.0, admin: -1.0, learn:  1.0, rest:  0.0 },
}

// --- Realism refinements (see README "Metric model") ---------------------
// 1. Deep work has DIMINISHING RETURNS for productivity — cramming more focus
//    hours yields progressively less output (a saturating curve), and past a
//    point you're just tired, not productive.
// 2. The 4-day week gets a FOCUS bonus: each deep hour is worth a bit more
//    (less waste, tighter meetings), so a shorter week roughly matches output.
// 3. The 4-day week gets a RECOVERY bonus: the extra day off lowers baseline
//    burnout/stress and raises wellbeing — but the ceiling stays 100, so you
//    can still burn out by cramming long days.
const PROD_K = 22 // weekly-deep-hours half-saturation; lower = stronger diminishing returns
const PROD_GAIN = 10 // scales the (diminished) deep contribution to productivity
const FOCUS_R2 = 1.15 // each deep hour ~15% more productive in the focused 4-day week
const RECOVERY_R2 = { burnout: -5, stress: -6, wellbeing: 7, productivity: 0 }

function deepProductivity(deepWeekly, round) {
  const focus = round === 2 ? FOCUS_R2 : 1
  return focus * (deepWeekly / (1 + deepWeekly / PROD_K)) // concave / saturating
}
const DEEP_PROD0 = deepProductivity(BALANCED_WEEKLY.deep, 1) // R1 balanced reference

// Residual fatigue carried from a hard previous week into round 2.
export function burnoutCarry(priorBurnout) {
  if (!priorBurnout) return 0
  return clamp(0.35 * (priorBurnout - 50), 0, 25)
}

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

// Convert a per-day schedule + Michael's meetings into weekly hour totals.
export function weeklyTotals(schedule, meetingHrsPerDay, round) {
  const d = daysInRound(round)
  return {
    deep: (schedule.deep_work_hrs || 0) * d,
    meet: (meetingHrsPerDay || 0) * d,
    admin: (schedule.admin_hrs || 0) * d,
    learn: (schedule.learning_hrs || 0) * d,
    rest: (schedule.rest_hrs || 0) * d,
  }
}

// Compute the four personal metrics from weekly totals.
// opts: { round (1|2), carryBurnout } — round drives the focus/recovery bonuses.
export function metricsFromWeekly(w, opts = {}) {
  const round = opts.round || 1
  const carry = opts.carryBurnout || 0
  const rec = round === 2 ? RECOVERY_R2 : { burnout: 0, stress: 0, wellbeing: 0, productivity: 0 }

  const dev = (c) =>
    c.deep * (w.deep - BALANCED_WEEKLY.deep) +
    c.meet * (w.meet - BALANCED_WEEKLY.meet) +
    c.admin * (w.admin - BALANCED_WEEKLY.admin) +
    c.learn * (w.learn - BALANCED_WEEKLY.learn) +
    c.rest * (w.rest - BALANCED_WEEKLY.rest)

  // Productivity: deep via diminishing returns + round focus bonus; rest linear.
  const prodDeep = PROD_GAIN * (deepProductivity(w.deep, round) - DEEP_PROD0)

  return {
    burnout: Math.round(clamp(50 + dev(INFLUENCE.burnout) + rec.burnout + carry, 0, 100)),
    stress: Math.round(clamp(50 + dev(INFLUENCE.stress) + rec.stress, 0, 100)),
    wellbeing: Math.round(clamp(50 + dev(INFLUENCE.wellbeing) + rec.wellbeing, 0, 100)),
    productivity: Math.round(clamp(50 + prodDeep + dev(INFLUENCE.productivity) + rec.productivity, 0, 100)),
  }
}

// Convenience: schedule -> { weekly, metrics }.
export function computePersonal(schedule, meetingHrsPerDay, round, carryBurnout = 0) {
  const weekly = weeklyTotals(schedule, meetingHrsPerDay, round)
  return { weekly, metrics: metricsFromWeekly(weekly, { round, carryBurnout }) }
}

// ---------------------------------------------------------------------------
// Company / team aggregates
// ---------------------------------------------------------------------------
//
// entries: [{ role, schedule, target_per_day }], meetingHrsPerDay, round
// Returns per-player results plus team & company numbers, and win/fail.

// priorBurnout: { role: round-1 burnout } — drives the round-2 carryover. Omit for round 1.
export function evaluateRound(entries, meetingHrsPerDay, round, priorBurnout = {}) {
  const days = daysInRound(round)

  // First pass: personal metrics + weekly totals.
  const results = entries.map((e) => {
    const carry = round === 2 ? burnoutCarry(priorBurnout[e.role]) : 0
    const { weekly, metrics } = computePersonal(e.schedule, meetingHrsPerDay, round, carry)
    return {
      role: e.role,
      schedule: e.schedule,
      target_weekly: (e.target_per_day || 0) * days,
      weekly,
      metrics,
      carry,
    }
  })

  // Team aggregates.
  const avg = (sel) => (results.length ? results.reduce((a, r) => a + sel(r), 0) / results.length : 0)
  const team_burnout = Math.round(avg((r) => r.metrics.burnout))
  let team_wellbeing = avg((r) => r.metrics.wellbeing)

  // Company productivity: average of (deep delivered vs target, capped at 1) × productivity.
  const company_productivity = Math.round(
    avg((r) => {
      const ratio = r.target_weekly > 0 ? Math.min(r.weekly.deep / r.target_weekly, 1) : 1
      return ratio * r.metrics.productivity
    })
  )

  // Pam's buffer: if Pam wins (on the base team wellbeing) she adds +5 to the
  // displayed team wellbeing aggregate.
  const pamResult = results.find((r) => r.role === 'pam')
  let pamWins = false
  if (pamResult) {
    pamWins =
      Math.round(team_wellbeing) >= 70 && pamResult.metrics.burnout < 75
  }
  team_wellbeing = Math.round(team_wellbeing + (pamWins ? 5 : 0))

  const company = {
    company_productivity,
    company_income: company_productivity, // 0–100 gauge, open question #2: reveal only
    team_burnout,
    team_wellbeing,
    pam_buffer: pamWins,
  }

  // Second pass: evaluate win/fail with full context.
  for (const r of results) {
    const ctx = {
      ...r.metrics,
      company_productivity,
      team_burnout,
      team_wellbeing,
    }
    const sched = { ...r.weekly, target_weekly: r.target_weekly, days }
    r.win = !!ROLES[r.role].win(ctx, sched)
    r.summary = roleSummary(r, company)
  }

  return { results, company }
}

// A themed "score" line per role (open question #3 — badge + score).
function roleSummary(r, company) {
  switch (r.role) {
    case 'michael':
      return { label: 'Company income', value: `${company.company_income}/100` }
    case 'dwight': {
      const pct = r.target_weekly > 0 ? Math.round((r.weekly.deep / r.target_weekly) * 100) : 0
      const bonus = Math.round((pct / 100) * 4200)
      return { label: 'Bonus', value: `${pct}%  ·  €${bonus.toLocaleString()}` }
    }
    case 'pam':
      return { label: 'Team wellbeing', value: `${company.team_wellbeing}/100` }
    case 'toby':
      return { label: 'Compliance hours', value: `${round1(r.weekly.deep)}h / 8h` }
    case 'oscar': {
      const band = r.weekly.admin + r.weekly.deep
      return { label: 'Balance band', value: `${round1(band)}h (target 10–18h)` }
    }
    default:
      return { label: '', value: '' }
  }
}

function round1(n) {
  return Math.round(n * 10) / 10
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // no I/O to avoid confusion
export function makeRoomCode() {
  let s = ''
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return s
}

// Assign a role to the Nth joiner (0-indexed).
export function roleForIndex(i) {
  return ROLE_ORDER[i] || null
}

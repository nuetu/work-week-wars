// game.js — shared game logic: roles, metric formulas, win/fail, phase machine.
// No DOM, no Supabase. Imported by play.js and screen.js (and the calibration test).

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

// Assignment order (Michael is always player 1). With <5 players, fill from top.
export const ROLE_ORDER = ['michael', 'dwight', 'pam', 'toby', 'oscar']

// The whole team wins or loses together (see teamVerdict). Each role ALSO has a
// personal "medal" — a flavour achievement that never overrides the team result,
// so you can't win by optimising your own numbers while the company tanks.
//   goal     — the role's personal angle / motivation (flavour)
//   job      — the role's contribution to the shared team goal
//   weakness — what to watch out for (shown as "⚠️ Watch out for")
//   medal    — (metrics+team ctx, weekly totals) -> bool : personal achievement
//   medalLabel / target — the star's name and the bar to clear (shown on cards)
export const ROLES = {
  michael: {
    name: 'Michael Scott',
    title: 'Regional Manager',
    emoji: '🧑‍💼',
    color: '#2f6fb3',
    goal: 'Feel in control — your meetings must happen.',
    job: 'You set everyone’s meeting load and deep-work targets. Coordinate the team without stealing their focus time.',
    weakness: 'Too many meetings eat everyone’s focus hours and tank morale.',
    medalLabel: 'In Control',
    // Per-day so it scales with the round: ≥1.2h/day = 6h in R1, 4.8h in R2.
    medal: (m, s) => s.meet / s.days >= 1.2 && m.company_output >= OUTPUT_FLOOR,
    target: 'Meetings ≥ 1.2h/day  &  orders still delivered',
  },
  dwight: {
    name: 'Dwight Schrute',
    title: 'Sales Representative',
    emoji: '🥋',
    color: '#9c7a2e',
    goal: 'Maximize your bonus — hit Michael’s deep-work target.',
    job: 'The output engine — deliver the deep work that fills the orders, without torching yourself.',
    weakness: 'Deep work without rest spikes burnout hard.',
    medalLabel: 'Top Producer',
    medal: (m, s) => s.deep >= s.target_weekly && m.burnout < 80,
    target: 'Deep work ≥ target  &  burnout < 80',
  },
  pam: {
    name: 'Pam Beesly',
    title: 'Front Desk / People Ops',
    emoji: '🎨',
    color: '#b8552e',
    goal: 'Keep the team happy — you are the wellbeing buffer.',
    job: 'The morale buffer — your rest and support lift the whole team’s wellbeing.',
    weakness: 'Too much admin overloads you; your burnout climbs fast.',
    medalLabel: 'Morale MVP',
    medal: (m, s) => m.team_wellbeing >= 60 && m.burnout < 75,
    target: 'Team wellbeing ≥ 60  &  your burnout < 75',
  },
  toby: {
    name: 'Toby Flenderson',
    title: 'Human Resources',
    emoji: '📋',
    color: '#5a7d5a',
    goal: 'Hit HR compliance hours (your "deep work").',
    job: 'Keep HR & compliance covered so the company dodges fines.',
    weakness: 'Every meeting Michael schedules eats your compliance window.',
    medalLabel: 'Compliance Clear',
    medal: (m, s) => s.deep >= 8 && m.team_burnout < 65,
    target: 'Compliance ≥ 8h/wk  &  team burnout < 65',
  },
  oscar: {
    name: 'Oscar Martinez',
    title: 'Financial Analyst',
    emoji: '📊',
    color: '#3b6e6e',
    goal: 'Precision — keep admin + analysis in a stable band.',
    job: 'Keep hours efficient — steady analysis, no wasted admin, watch the budget.',
    weakness: 'Excess meetings spike your stress disproportionately.',
    medalLabel: 'Books Balanced',
    medal: (m, s) => {
      const band = s.admin + s.deep
      return band >= 10 && band <= 18 && m.stress < 70
    },
    target: 'Admin + deep work in 10–18h  &  stress < 70',
  },
}

// ---------------------------------------------------------------------------
// Shared team goal + the four-day-week story
// ---------------------------------------------------------------------------

// The headline objective every role shares.
export const TEAM_GOAL = {
  title: 'Keep Dunder Mifflin Scranton in business — together.',
  output: 'Deliver corporate’s paper orders (team output stays above the line)…',
  wellbeing: '…without burning the team out.',
}

// Intro narrative shown at the start of each round (big screen + phones).
export const ROUND_INTRO = {
  1: {
    pill: 'Round 1 · The 40-hour week',
    title: 'Welcome to Scranton',
    body: 'You work at Dunder Mifflin, a paper company in Scranton, Pennsylvania. Corporate wants every branch to submit a weekly schedule — five 8-hour days. Split your time between deep work, admin, learning and rest, keep the orders flowing, and try not to burn out. This is your normal week — the baseline everything else is measured against.',
  },
  2: {
    pill: 'Round 2 · The 32-hour week',
    title: 'Corporate tries something new',
    body: 'Corporate read about the four-day week and wants Scranton to pilot it: Fridays off, 32 hours, same order book. Submit a reduced schedule. The experiment only “works” if you keep output at the line AND the team ends up better off than your 40-hour baseline — less burnout, more wellbeing. Michael can only trim meetings and targets now, not raise them.',
  },
}

// ---------------------------------------------------------------------------
// Explainers — how the game works, surfaced before play and in the role overlay.
// Pure data so both the phone (play.js) and big screen (screen.js) render it.
// ---------------------------------------------------------------------------

// The three shared "team" numbers everyone is steering (the headline axes).
export const GLOSSARY = [
  { term: 'Output', emoji: '📦', short: 'Did the orders ship? — only deep work vs targets counts',
    desc: 'Did the orders ship? Driven ONLY by deep work measured against Michael’s targets, scaled by how productive you are. The team must clear the orders floor every round — corporate doesn’t shrink the order book just because you work fewer hours.' },
  { term: 'Burnout', emoji: '🔋', short: 'Team strain — up with work, down with rest',
    desc: 'Cumulative strain on the team. Pushed UP by deep work, meetings and admin; brought DOWN by rest. A brutal Round 1 even carries some fatigue into Round 2. Stay out of the red.' },
  { term: 'Wellbeing', emoji: '💚', short: 'How the week felt — rest & learning lift it',
    desc: 'How good the week actually felt. Lifted by rest and learning, dragged down by meetings and admin. The four-day week only “works” if wellbeing ends up HIGHER than your 40-hour baseline.' },
]

// How each control moves the dials — the "before you play" cause-and-effect guide.
export const CONTROL_GUIDE = {
  intro: 'Every weekday is 8 working hours. Michael skims some off the top for meetings; you split whatever’s left across four kinds of work. Nothing forces a minimum — you could rest the whole day — but the orders still have to ship, so the balance is the whole game.',
  controls: [
    { emoji: '📣', label: 'Meetings', who: 'Michael sets this, for everyone',
      effect: 'Coordination time taken off the top of everyone’s day before they allocate. A little keeps the team aligned; too much eats focus hours, spikes stress and drags wellbeing down.',
      dials: '↑ stress · ↓ wellbeing · fewer hours to allocate' },
    { emoji: '🎯', label: 'Deep work', who: 'You choose',
      effect: 'Focused, order-filling output — the only thing that moves company output toward the orders floor. High value, but each extra hour returns a bit less (diminishing returns) and pushes burnout up.',
      dials: '↑↑ output · ↑ burnout' },
    { emoji: '🗂️', label: 'Admin', who: 'You choose',
      effect: 'Reactive upkeep: email, filing, logistics, logging orders. Necessary glue, but it ships no orders and it drains you — keep it lean.',
      dials: '↑ burnout · ↓ wellbeing · no output' },
    { emoji: '📚', label: 'Learning', who: 'You choose',
      effect: 'Upskilling and development. Energising and lifts wellbeing, with a slow payoff to productivity — but it won’t lower today’s burnout.',
      dials: '↑↑ wellbeing · slow ↑ productivity' },
    { emoji: '☕', label: 'Rest', who: 'You choose',
      effect: 'Breaks, buffer, recovery. The main way to bring burnout and stress down and wellbeing up — but rest hours aren’t output, so overdo it and the orders slip.',
      dials: '↓↓ burnout · ↓↓ stress · ↑ wellbeing' },
  ],
  // Answers the two questions players actually ask at the table.
  faqs: [
    { q: 'Admin vs deep work — what’s the difference?',
      a: 'Deep work fills orders; it’s the only thing corporate actually counts. Admin is the upkeep AROUND the work — email, filing, logging sales — necessary but it ships nothing. Even the output engine (Dwight) needs a little admin to process what he sells; the trap is letting admin crowd out focus.' },
    { q: 'Learning vs rest — aren’t they both “time off”?',
      a: 'Both feel good, but they’re not the same. Rest actively lowers today’s burnout and stress. Learning doesn’t recover you — it lifts wellbeing and slowly raises productivity. Rest heals; learning invests.' },
    { q: 'Can someone really spend 7 hours resting?',
      a: 'Yes — your only hard limit is the hours left after meetings, and you may split them however you like. But output comes only from deep work, so a rest-heavy week tanks the orders and the team misses the floor. The freedom (and the temptation) is the point.' },
  ],
}

// Personal medals explained — flavour goals that never change the team result.
export const MEDAL_NOTE = 'A medal is a personal bonus goal — bragging rights for nailing your own brief. It never overrides the team result: you can’t “win” by polishing your own numbers while the company tanks.'

// Five thought-provoking discussion prompts shown one-per-screen at the very end
// (presentation style — host hits Next for each).
export const END_QUESTIONS = [
  { n: 1, q: 'Same pay, four days — would you take it? What if it cost you 20% of your salary?',
    sub: 'Most real-world trials kept pay flat. What would make the trade worth it for you?' },
  { n: 2, q: 'To fit five days into four, what did you cut first — and what does that say about which work actually mattered?',
    sub: 'Meetings? Admin? The “busy” work is usually first to go.' },
  { n: 3, q: 'Who gains the most from a four-day week — and who might get left behind?',
    sub: 'Parents and carers, shift and customer-facing roles, globally distributed teams…' },
  { n: 4, q: 'If output held with fewer hours, where was that time going before?',
    sub: 'Coordination overhead, context-switching, meetings — or slack capacity for the unexpected?' },
  { n: 5, q: 'Could your real team run this experiment next month? What’s the ONE thing that would have to change first?',
    sub: 'Be specific — a meeting, a metric, a manager, or a mindset.' },
]

// Team win thresholds (tuned in test/calibrate.mjs). Output is an absolute floor
// both rounds (corporate doesn't shrink the order book); the wellbeing axis in R2
// is judged RELATIVE to the round-1 baseline.
export const OUTPUT_FLOOR = 45 // company_output (0–100) needed to "deliver the orders"
export const BURNOUT_CAP = 62 // round-1 team burnout must stay at/below this

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
// `desc` is shown under each stepper, so it spells out what the category IS and
// which dials it moves — that's where players actually decide.
export const CATEGORIES = [
  { key: 'deep_work_hrs', short: 'deep', label: 'Deep work', emoji: '🎯',
    desc: 'Focused, order-filling output — the ONLY work that ships orders. ↑↑ output, but ↑ burnout.' },
  { key: 'admin_hrs', short: 'admin', label: 'Admin', emoji: '🗂️',
    desc: 'Email, filing, logistics, logging orders — necessary upkeep that ships nothing. Keep it lean: ↑ burnout, ↓ wellbeing.' },
  { key: 'learning_hrs', short: 'learn', label: 'Learning', emoji: '📚',
    desc: 'Upskilling & development. Energising: ↑↑ wellbeing and a slow ↑ to productivity — but it won’t lower today’s burnout.' },
  { key: 'rest_hrs', short: 'rest', label: 'Rest', emoji: '☕',
    desc: 'Breaks, buffer, recovery. The main way to bring burnout & stress DOWN and wellbeing UP — but rest isn’t output.' },
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
// The extra day off helps a bit automatically — but only a bit. It is deliberately
// NOT enough to "win" Round 2 by copying the Round-1 plan: a team has to actually
// rebalance (trade admin/grind for rest, trim meetings) to end up healthier than
// baseline. Tuned in test/calibrate.mjs so balanced-same loses while smart wins.
const RECOVERY_R2 = { burnout: -3, stress: -4, wellbeing: 2, productivity: 0 }

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

  // Company output ("did we deliver the orders"): average of (deep delivered vs
  // target, capped at 1) × productivity. This is the shared output axis.
  const company_output = Math.round(
    avg((r) => {
      const ratio = r.target_weekly > 0 ? Math.min(r.weekly.deep / r.target_weekly, 1) : 1
      return ratio * r.metrics.productivity
    })
  )

  // Pam's buffer: if Pam earns her medal (on the base team wellbeing) she adds +5
  // to the displayed team wellbeing aggregate.
  const pamResult = results.find((r) => r.role === 'pam')
  let pamWins = false
  if (pamResult) {
    pamWins =
      Math.round(team_wellbeing) >= 70 && pamResult.metrics.burnout < 75
  }
  team_wellbeing = Math.round(team_wellbeing + (pamWins ? 5 : 0))

  const company = {
    company_output,
    company_income: company_output, // 0–100 gauge, open question #2: reveal only
    team_burnout,
    team_wellbeing,
    pam_buffer: pamWins,
  }

  // Second pass: evaluate each role's personal MEDAL with full context.
  for (const r of results) {
    const ctx = {
      ...r.metrics,
      company_output,
      team_burnout,
      team_wellbeing,
    }
    const sched = { ...r.weekly, target_weekly: r.target_weekly, days }
    r.medal = !!ROLES[r.role].medal(ctx, sched)
    r.summary = roleSummary(r, company)
  }

  return { results, company }
}

// ---------------------------------------------------------------------------
// Team verdict — the headline win/lose, shared by everyone.
// ---------------------------------------------------------------------------
//
// Round 1 (40h) is the BASELINE: deliver the orders without the team burning out.
// Round 2 (32h) is judged against that baseline: hold output at the same floor
// AND end up healthier than round 1 (lower burnout + higher wellbeing). That's
// the only way the four-day week "works".
//
//   company  — the round's company aggregates (from evaluateRound)
//   round    — 1 | 2
//   baseline — round-1 { output, burnout, wellbeing } (required for round 2)
//
// Returns { round, win, delivered, healthy, output, burnout, wellbeing,
//           headline, detail }.
export function teamVerdict(company, round, baseline = null) {
  const output = company.company_output
  const burnout = company.team_burnout
  const wellbeing = company.team_wellbeing
  const delivered = output >= OUTPUT_FLOOR

  if (round === 1) {
    const healthy = burnout <= BURNOUT_CAP
    const win = delivered && healthy
    let headline, detail
    if (win) {
      headline = 'Solid normal week'
      detail = 'Orders out the door and the team’s holding up. This is your baseline — Round 2 has to beat it.'
    } else if (!delivered) {
      headline = 'Behind on orders'
      detail = 'Corporate isn’t happy — not enough got delivered. You’ll need more focused output.'
    } else {
      headline = 'Running too hot'
      detail = 'Orders shipped, but the team is burning out. Sustainable? Not really.'
    }
    return { round, win, delivered, healthy, output, burnout, wellbeing, headline, detail }
  }

  // Round 2: healthier than the round-1 baseline.
  const healthy = !!baseline && burnout < baseline.burnout && wellbeing > baseline.wellbeing
  const win = delivered && healthy
  let headline, detail
  if (win) {
    headline = 'The four-day week worked! 🎉'
    detail = 'Same orders out the door, and the team is genuinely better off than the 40-hour week — less burnout, more wellbeing. That’s the headline finding, lived.'
  } else if (delivered && !healthy) {
    headline = 'You just crammed it in'
    detail = 'Output held, but the team is no better off than Round 1 — you squeezed five days into four. The point of the shorter week was lost.'
  } else if (!delivered && healthy) {
    headline = 'Happier, but orders slipped'
    detail = 'The team feels better, but output dropped below the line. Corporate sees a productivity hit, not a win.'
  } else {
    headline = 'The experiment failed'
    detail = 'Output dropped AND the team isn’t better off. The shorter week didn’t deliver on either front.'
  }
  return { round, win, delivered, healthy, output, burnout, wellbeing, headline, detail }
}

// A themed "score" line per role (open question #3 — badge + score).
function roleSummary(r, company) {
  switch (r.role) {
    case 'michael':
      return { label: 'Company output', value: `${company.company_income}/100` }
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

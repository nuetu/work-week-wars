// play.js — player phone controller.

import {
  ROLES,
  ROLE_ORDER,
  CATEGORIES,
  METRICS,
  SLIDER_STEP,
  dailyAllocatable,
  daysInRound,
  computePersonal,
  evaluateRound,
  burnoutCarry,
  teamVerdict,
  TEAM_GOAL,
  ROUND_INTRO,
  CONTROL_GUIDE,
  GLOSSARY,
  MEDAL_NOTE,
} from './game.js'
import {
  getRoomByCode,
  getRoomById,
  joinRoom,
  getPlayers,
  setLock,
  setR1Burnout,
  saveSchedule,
  getSchedules,
  saveTargets,
  getTargets,
  setMeetingHrs,
  setPhase,
  resetLocks,
  subscribeRoom,
  subscribePlayers,
  subscribeReset,
} from './db.js'
import { avatarSVG } from './avatars.js'
import { sfx, resume as audioResume } from './audio.js'

const app = document.getElementById('app')
// Per-tab storage namespace. Add ?seat=2 (any value) to run a second independent
// player in the same browser — handy for testing/demoing multiple seats at once.
const SEAT = new URLSearchParams(location.search).get('seat')
const STORE_KEY = 'www_player' + (SEAT ? '_' + SEAT : '')

const state = {
  room: null,
  player: null, // our player row
  players: [],
  targets: {}, // role -> hrs/day for current round
  draft: blankDraft(), // current allocation (per day)
  locked: false,
  channels: [],
}

function blankDraft() {
  return { deep_work_hrs: 0, admin_hrs: 0, learning_hrs: 0, rest_hrs: 0 }
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

init()

async function init() {
  const params = new URLSearchParams(location.search)
  const codeParam = (params.get('code') || '').toUpperCase()

  const saved = loadSaved()
  if (saved && (!codeParam || saved.code === codeParam)) {
    try {
      await resume(saved)
      return
    } catch (e) {
      clearSaved()
    }
  }
  showJoin(codeParam)
}

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
  } catch {
    return null
  }
}
function save() {
  localStorage.setItem(
    STORE_KEY,
    JSON.stringify({ code: state.room.code, roomId: state.room.id, playerId: state.player.id })
  )
}
function clearSaved() {
  localStorage.removeItem(STORE_KEY)
}

async function resume(saved) {
  const data = await getRoomById(saved.roomId)
  if (!data) throw new Error('room gone')
  state.room = data
  const players = await getPlayers(data.id)
  const me = players.find((p) => p.id === saved.playerId)
  if (!me) throw new Error('player gone')
  state.players = players
  state.player = me
  subscribe()
  await onEnterPhase()
  // After onEnterPhase (which assumes a fresh round), restore the real lock flag
  // so a player who reloads mid-wait still sees the "locked in" screen.
  state.locked = state.room.round === 1 ? state.player.locked_r1 : state.player.locked_r2
  render()
}

// ---------------------------------------------------------------------------
// join
// ---------------------------------------------------------------------------

function showJoin(prefill) {
  app.innerHTML = `
    <div class="stack" style="padding-top:8vh">
      <div class="center stack">
        <div class="pill">The Office · 4-Day Week</div>
        <h1 style="font-size:2.2rem">Work Week Wars</h1>
      </div>
      <div class="card stack">
        <label class="muted">Room code</label>
        <input id="code" type="text" maxlength="4" placeholder="ABCD"
          value="${prefill || ''}"
          style="text-transform:uppercase;letter-spacing:.2em;font-weight:700;font-size:1.3em;text-align:center" />
        <label class="muted">Your name</label>
        <input id="name" type="text" maxlength="20" placeholder="e.g. Jim" />
        <button id="go" class="big">Join game →</button>
      </div>
      <footer class="foot">Roles are assigned in join order.</footer>
    </div>`
  const go = document.getElementById('go')
  go.addEventListener('click', onJoinClick)
}

async function onJoinClick() {
  const code = document.getElementById('code').value.trim().toUpperCase()
  const name = document.getElementById('name').value.trim()
  if (code.length !== 4) return toast('Enter the 4-letter room code')
  if (!name) return toast('Enter your name')
  audioResume() // this click is our gesture to unlock audio
  setBusy('go', true)
  try {
    const room = await getRoomByCode(code)
    if (!room) {
      setBusy('go', false)
      return toast('No room with that code')
    }
    const res = await joinRoom(room, name)
    if (res.error === 'full') {
      setBusy('go', false)
      return toast('This room is full (5 players max)')
    }
    if (res.error === 'started') {
      setBusy('go', false)
      return toast('That game has already started')
    }
    state.room = room
    state.player = res.player
    state.players = await getPlayers(room.id)
    save()
    subscribe()
    sfx.join()
    render()
  } catch (e) {
    console.error(e)
    setBusy('go', false)
    toast('Could not join — check the code')
  }
}

// ---------------------------------------------------------------------------
// realtime
// ---------------------------------------------------------------------------

function subscribe() {
  state.channels.push(
    subscribeRoom(state.room.id, async (room) => {
      const phaseChanged = room.phase !== state.room.phase
      state.room = room
      if (phaseChanged) {
        await onEnterPhase()
      }
      render()
    })
  )
  state.channels.push(
    subscribePlayers(state.room.id, async () => {
      state.players = await getPlayers(state.room.id)
      const me = state.players.find((p) => p.id === state.player.id)
      if (me) state.player = me
      // Re-render on roster/lock changes, but never while the user is mid-edit
      // on a screen full of sliders (allocation, or Michael's setup).
      const phase = state.room.phase
      const isMichael = state.player.role === 'michael'
      const editing =
        ((phase === 'allocating' || phase === 'round2_allocating') && !state.locked) ||
        ((phase === 'michael_sets' || phase === 'round2_setup') && isMichael)
      if (!editing) render()
    })
  )
  // Host pressed "New game" → wipe our stored session and return to the join screen.
  state.channels.push(
    subscribeReset(state.room.id, () => {
      clearSaved()
      location.reload()
    })
  )
}

// Runs once whenever we land on a new phase.
async function onEnterPhase() {
  const phase = state.room.phase
  // Reset synchronously, BEFORE any await, so a re-render triggered mid-await (e.g.
  // by a players realtime event from resetLocks) can't briefly show a stale "locked"
  // state. Arriving at an allocation phase via a transition is always a fresh round.
  // (resume() restores the real flag afterwards for page reloads.)
  if (phase === 'allocating' || phase === 'round2_allocating') {
    state.draft = blankDraft()
    state.locked = false
  }

  state.players = await getPlayers(state.room.id)
  const me = state.players.find((p) => p.id === state.player.id)
  if (me) state.player = me

  if (phase === 'allocating' || phase === 'round2_allocating') {
    state.targets = await getTargets(state.room.id, state.room.round)
  } else if (phase === 'michael_sets' || phase === 'round2_setup') {
    // Round-1 targets act as defaults (round 1) and as the can-only-reduce caps (round 2).
    state.targets = await getTargets(state.room.id, 1)
  }
}

// ---------------------------------------------------------------------------
// render switch
// ---------------------------------------------------------------------------

function render() {
  renderPhase()
  syncRoleUI()
}

function renderPhase() {
  const phase = state.room.phase
  if (state.player.role === 'spectator') return renderSpectator()
  const isMichael = state.player.role === 'michael'
  switch (phase) {
    case 'lobby':
      return renderLobby()
    case 'michael_sets':
      return isMichael ? renderMichaelSetup(false) : renderRolePage('Michael is planning the week')
    case 'allocating':
    case 'round2_allocating':
      return state.locked ? renderLocked() : renderAllocating()
    case 'reveal':
      return renderResult(1)
    case 'round2_setup':
      return isMichael ? renderMichaelSetup(true) : renderRolePage('Michael is adjusting the schedule')
    case 'final':
      return renderFinal()
    default:
      return renderWaiting('Stand by', '📺')
  }
}

// ---------------------------------------------------------------------------
// lobby — role card
// ---------------------------------------------------------------------------

// The shared team goal — shown on every role card so the co-op objective leads.
function teamGoalHTML() {
  return `
    <div class="team-goal-card">
      <div class="tg-title">🎯 Team goal: ${TEAM_GOAL.title}</div>
      <div class="tg-line">${TEAM_GOAL.output} ${TEAM_GOAL.wellbeing}</div>
      <div class="tg-sub">You win or lose <strong>as a team</strong>.</div>
    </div>`
}

// Shared role explainer used on the lobby card, the "Michael is setting up" page,
// and the in-game "ℹ️ Role" overlay. Leads with the team goal, then this role's
// job on the team and its personal medal (flavour — never overrides the team result).
function roleCardHTML(role) {
  const r = ROLES[role]
  return `
    ${teamGoalHTML()}
    <div class="card stack role-${role}">
      <div class="role-head">
        <div class="avatar role-${role}">${avatarSVG(role)}</div>
        <div>
          <div class="name">${r.name}</div>
          <div class="title">${r.title}</div>
        </div>
      </div>
      <p><strong>🧩 Your job.</strong> ${r.job}</p>
      <p><strong>⚠️ Watch out for.</strong> ${r.weakness}</p>
      <div class="medal-note">
        <div class="medal-head">🏅 Your medal — ${r.medalLabel}</div>
        <div class="medal-target">Earn it by: ${r.target}</div>
        <div class="medal-fine">${MEDAL_NOTE}</div>
      </div>
    </div>`
}

// How-it-works explainer: the control→dials guide + the two FAQs (admin vs deep,
// learning vs rest, "why 7h rest?"). Reused on the wait page and role overlay.
function controlGuideHTML() {
  const rows = CONTROL_GUIDE.controls
    .map(
      (c) => `
      <div class="cg-row">
        <div class="cg-head"><span class="cg-label">${c.emoji} ${c.label}</span><span class="cg-who">${c.who}</span></div>
        <div class="cg-effect">${c.effect}</div>
        <div class="cg-dials">${c.dials}</div>
      </div>`
    )
    .join('')
  const faqs = CONTROL_GUIDE.faqs
    .map((f) => `<p class="cg-faq"><strong>${f.q}</strong><br/>${f.a}</p>`)
    .join('')
  return `
    <details class="card explain">
      <summary><strong>📖 How your choices move the dials</strong></summary>
      <p class="muted" style="margin-top:10px">${CONTROL_GUIDE.intro}</p>
      <div class="cg-list">${rows}</div>
      <div class="cg-faqs">${faqs}</div>
    </details>`
}

// The three team numbers everyone is steering (output / burnout / wellbeing).
function glossaryHTML() {
  const items = GLOSSARY.map(
    (g) => `<p class="gl-item"><strong>${g.emoji} ${g.term}.</strong> ${g.desc}</p>`
  ).join('')
  return `
    <details class="card explain">
      <summary><strong>🎚️ The three numbers you’re steering</strong></summary>
      <div style="margin-top:8px">${items}</div>
    </details>`
}

function renderLobby() {
  app.innerHTML = `
    <div class="stack" style="padding-top:6vh">
      <div class="center"><div class="pill">Room ${state.room.code} · You're in!</div></div>
      ${roleCardHTML(state.player.role)}
      <div class="center muted">Waiting for the host to start the game…</div>
    </div>`
}

// Shown to non-Michael players while Michael sets up (both rounds): the round's
// story intro, then the team goal + this player's role, so the wait is useful.
function renderRolePage(footerMsg) {
  const intro = ROUND_INTRO[state.room.round] || ROUND_INTRO[1]
  app.innerHTML = `
    <div class="stack" style="padding-top:3vh">
      <div class="card stack intro-card">
        <div class="pill">${intro.pill}</div>
        <h2 style="margin:.2em 0">${intro.title}</h2>
        <p class="muted" style="font-size:.95rem;line-height:1.5">${intro.body}</p>
      </div>
      ${roleCardHTML(state.player.role)}
      ${glossaryHTML()}
      ${controlGuideHTML()}
      <div class="center muted">${footerMsg}<span class="dots"></span></div>
    </div>`
}

// ---------------------------------------------------------------------------
// Michael's setup (meetings + per-role deep-work targets)
// ---------------------------------------------------------------------------

function renderMichaelSetup(isRound2) {
  const employees = state.players.filter((p) => p.role !== 'michael')
  // Round 1 defaults; round 2 caps at round-1 values (can only reduce).
  const meetingMax = isRound2 ? state.room.meeting_hrs : 4
  const meetingStart = isRound2 ? state.room.meeting_hrs : 1.5
  const days = daysInRound(isRound2 ? 2 : 1)

  // One config per stepper (meetings + a deep-work target per teammate). Uses the
  // same +/- stepper UI players get during allocation, so the controls match.
  const steppers = [
    { id: 'meet', kind: 'meet', label: '📣 Daily meeting hours (everyone)', min: 0, max: meetingMax, step: SLIDER_STEP, value: meetingStart },
  ]
  for (const p of employees) {
    const r = ROLES[p.role]
    const prev = state.targets[p.role]
    const tMax = isRound2 && prev != null ? prev : 6
    const tStart = prev != null ? prev : 3
    steppers.push({
      id: 'tgt-' + p.role,
      kind: 'target',
      role: p.role,
      label: `${r.emoji} ${r.name} <span class="muted">(${p.display_name})</span>`,
      min: 0, max: tMax, step: SLIDER_STEP, value: tStart,
    })
  }
  const byId = Object.fromEntries(steppers.map((s) => [s.id, s]))

  const stepperHTML = (s) => `
    <div class="stepper-row">
      <div class="stepper-top">
        <span class="slider-label">${s.label}</span>
        <span class="slider-hrs" data-out="${s.id}">${s.value.toFixed(1)}h</span>
      </div>
      <div class="stepper">
        <button type="button" class="step-btn" data-step="${s.id}" data-dir="-1" aria-label="Less">−</button>
        <div class="step-bar"><div class="step-fill" data-bar="${s.id}"></div></div>
        <button type="button" class="step-btn" data-step="${s.id}" data-dir="1" aria-label="More">+</button>
      </div>
      ${s.kind === 'meet' ? '<div class="slider-desc" data-week></div>' : ''}
    </div>`

  app.innerHTML = `
    <div class="stack">
      <div class="center"><div class="pill">${isRound2 ? 'Round 2 · 32-hour week' : 'Round 1 · 40-hour week'}</div></div>
      <h2>${isRound2 ? 'Trim the schedule' : 'Set the schedule'}</h2>
      ${teamGoalHTML()}
      <p class="muted">
        <strong>🧩 Your job.</strong> ${ROLES.michael.job}
        ${
          isRound2
            ? ' Friday is gone — you may only <em>reduce</em> meetings and targets, not raise them.'
            : ' Your meeting hours apply to everyone, every day, and are deducted before anyone allocates.'
        }
      </p>

      <div class="card explain-inline stack">
        <p style="margin:0"><strong>📣 Why you set meetings.</strong> Meeting hours come out of everyone’s day <em>before</em> they plan, so a little keeps the team aligned — but every hour you add is an hour of focus you take away, and it lifts stress and lowers wellbeing across the whole team.</p>
        <p style="margin:0"><strong>🎯 Why you set deep-work targets.</strong> Targets tell each teammate how much focused output you need from them to fill corporate’s orders. Aim too high and they burn out chasing it; too low and the orders slip below the line — you’re balancing output against the team’s health.</p>
      </div>

      ${stepperHTML(byId.meet)}

      <h3 style="margin-top:8px">Deep-work targets <span class="muted" style="font-weight:400">(hrs/day per person)</span></h3>
      <div class="stack">${steppers.filter((s) => s.kind === 'target').map(stepperHTML).join('')}</div>

      <button id="lock" class="big">${isRound2 ? 'Lock & start Round 2' : 'Lock in & unlock the team'}</button>
    </div>`

  const refresh = (s) => {
    document.querySelector(`[data-out="${s.id}"]`).textContent = s.value.toFixed(1) + 'h'
    document.querySelector(`[data-bar="${s.id}"]`).style.width =
      s.max > s.min ? ((s.value - s.min) / (s.max - s.min)) * 100 + '%' : '0%'
    document.querySelector(`.step-btn[data-step="${s.id}"][data-dir="-1"]`).disabled = s.value <= s.min + 1e-9
    document.querySelector(`.step-btn[data-step="${s.id}"][data-dir="1"]`).disabled = s.value >= s.max - 1e-9
    if (s.kind === 'meet') {
      document.querySelector('[data-week]').textContent =
        `= ${(s.value * days).toFixed(1)}h/week of meetings · leaves ${dailyAllocatable(s.value).toFixed(1)}h/day for each person to allocate`
    }
  }

  document.querySelectorAll('.step-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = byId[btn.dataset.step]
      const next = s.value + parseFloat(btn.dataset.dir) * s.step
      s.value = clampStep(next, s.min, s.max)
      sfx.tick()
      refresh(s)
    })
  })
  steppers.forEach(refresh)

  document.getElementById('lock').addEventListener('click', async () => {
    audioResume()
    sfx.lock()
    setBusy('lock', true)
    const meetingHrs = byId.meet.value
    const targetsByRole = {}
    for (const s of steppers) if (s.kind === 'target') targetsByRole[s.role] = s.value
    try {
      await setMeetingHrs(state.room.id, meetingHrs)
      await saveTargets(state.room.id, isRound2 ? 2 : 1, targetsByRole)
      const nextRound = isRound2 ? 2 : 1
      await resetLocks(state.room.id, nextRound)
      await setPhase(state.room.id, isRound2 ? 'round2_allocating' : 'allocating')
    } catch (e) {
      console.error(e)
      setBusy('lock', false)
      toast('Could not save — try again')
    }
  })
}

// ---------------------------------------------------------------------------
// allocation
// ---------------------------------------------------------------------------

function renderAllocating() {
  const r = ROLES[state.player.role]
  const round = state.room.round
  const meeting = state.room.meeting_hrs
  const budget = dailyAllocatable(meeting)
  const days = daysInRound(round)
  const myTarget = state.targets[state.player.role]

  app.innerHTML = `
    <div class="alloc-split">
      <div class="center alloc-pill"><div class="pill">${round === 1 ? 'Round 1 · 40h week' : 'Round 2 · 32h week'} · ${r.name}</div></div>

      <!-- Top half: live "week at a glance" — stays pinned while you adjust below. -->
      <div class="alloc-glance">
        <div class="glance-head">
          <h3 class="glance-title">📊 Your week at a glance</h3>
          <div class="budget-mini" id="budget"><span>Left today</span><span class="left-hrs" id="left">0.0h</span></div>
        </div>
        <div class="gauges" id="gauges"></div>
      </div>

      <!-- Bottom half: the schedule setters. -->
      <div class="alloc-setters stack">
        <div class="muted center" style="font-size:.9rem;margin-top:2px">
          Meetings take ${meeting.toFixed(1)}h/day · you allocate ${budget.toFixed(1)}h/day × ${days} days, however you like.
        </div>
        ${myTarget != null && myTarget > 0
          ? `<div class="target-note">📣 Michael expects <strong>${myTarget.toFixed(1)}h/day</strong> of deep work from you (${(myTarget * days).toFixed(1)}h/week).</div>`
          : ''}
        <div class="target-note" style="background:var(--panel-2);border-color:var(--line)">
          <strong>🎯 Team:</strong> deliver the orders without burning out. <strong>🏅 You:</strong> ${r.target}
        </div>

        <div class="stack" id="steppers"></div>

        <button id="lock" class="big" disabled>Lock in my week</button>
      </div>
    </div>`

  // +/- steppers (one per category) — nicer than sliders on a phone.
  const stepWrap = document.getElementById('steppers')
  CATEGORIES.forEach((c) => {
    const row = document.createElement('div')
    row.className = 'stepper-row'
    row.innerHTML = `
      <div class="stepper-top">
        <span class="slider-label">${c.emoji} ${c.label}</span>
        <span class="slider-hrs" data-out="${c.key}">0.0h</span>
      </div>
      <div class="stepper">
        <button type="button" class="step-btn" data-dir="-1" data-key="${c.key}" aria-label="Less ${c.label}">−</button>
        <div class="step-bar"><div class="step-fill" data-bar="${c.key}"></div></div>
        <button type="button" class="step-btn" data-dir="1" data-key="${c.key}" aria-label="More ${c.label}">+</button>
      </div>
      <div class="slider-desc">${c.desc}</div>`
    stepWrap.appendChild(row)
  })

  const gaugeWrap = document.getElementById('gauges')
  METRICS.forEach((m) => {
    const g = document.createElement('div')
    g.className = 'gauge'
    g.innerHTML = `
      <div class="gauge-top"><span>${m.label}</span><span class="gauge-val" data-g="${m.key}">50</span></div>
      <div class="track"><div class="fill" data-fill="${m.key}"></div></div>`
    gaugeWrap.appendChild(g)
  })

  const lockBtn = document.getElementById('lock')
  const catTotal = () => CATEGORIES.reduce((s, c) => s + (state.draft[c.key] || 0), 0)

  const recompute = () => {
    const total = catTotal()
    const left = budget - total
    CATEGORIES.forEach((c) => {
      const v = state.draft[c.key] || 0
      stepWrap.querySelector(`[data-out="${c.key}"]`).textContent = v.toFixed(1) + 'h'
      stepWrap.querySelector(`[data-bar="${c.key}"]`).style.width =
        budget > 0 ? Math.min(100, (v / budget) * 100) + '%' : '0%'
    })
    // Enable/disable each button: no negative hours, never exceed the budget.
    stepWrap.querySelectorAll('.step-btn').forEach((btn) => {
      const v = state.draft[btn.dataset.key] || 0
      btn.disabled = btn.dataset.dir === '-1' ? v <= 0 : left < SLIDER_STEP - 1e-9
    })
    document.getElementById('left').textContent = left.toFixed(1) + 'h'
    document.getElementById('budget').classList.toggle('low', left < SLIDER_STEP - 1e-9)

    const carry = round === 2 ? burnoutCarry(state.player.r1_burnout) : 0
    const { metrics } = computePersonal(state.draft, meeting, round, carry)
    METRICS.forEach((m) => {
      const v = metrics[m.key]
      gaugeWrap.querySelector(`[data-g="${m.key}"]`).textContent = v
      const fill = gaugeWrap.querySelector(`[data-fill="${m.key}"]`)
      fill.style.width = v + '%'
      fill.style.background = gaugeColor(m, v)
    })
    lockBtn.disabled = total <= 0
  }

  stepWrap.querySelectorAll('.step-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key
      const dir = parseFloat(btn.dataset.dir)
      const cur = state.draft[key] || 0
      if (dir > 0) {
        if (catTotal() + SLIDER_STEP > budget + 1e-9) return // no hours left
        state.draft[key] = cur + SLIDER_STEP
      } else {
        state.draft[key] = Math.max(0, cur - SLIDER_STEP)
      }
      sfx.tick()
      recompute()
    })
  })
  recompute()

  lockBtn.addEventListener('click', async () => {
    audioResume()
    sfx.lock()
    setBusy('lock', true)
    try {
      await saveSchedule(state.player.id, round, state.draft)
      if (round === 1) {
        // Stash round-1 burnout so round 2 can apply the carryover.
        const r1b = computePersonal(state.draft, meeting, 1).metrics.burnout
        state.player.r1_burnout = r1b
        await setR1Burnout(state.player.id, r1b)
      }
      await setLock(state.player.id, round, true)
      state.locked = true
      render()
    } catch (e) {
      console.error(e)
      setBusy('lock', false)
      toast('Could not lock in — try again')
    }
  })
}

function renderLocked() {
  const real = state.players.filter((p) => ROLE_ORDER.includes(p.role))
  const lockedCount = real.filter((p) => (state.room.round === 1 ? p.locked_r1 : p.locked_r2)).length
  app.innerHTML = `
    <div class="waiting-splash stack">
      <div class="avatar role-${state.player.role}">✅</div>
      <h2>Locked in!</h2>
      <p class="muted">Waiting for the others…<br/>${lockedCount} / ${real.length} ready</p>
    </div>`
}

function renderSpectator() {
  const started = state.room.phase !== 'lobby'
  app.innerHTML = `
    <div class="waiting-splash stack">
      <div class="avatar">📺</div>
      <h2>You're spectating</h2>
      <p class="muted">Room ${state.room.code} — all five seats are taken.<br/>
      ${started ? 'Follow the action on the big screen.' : 'Watch the big screen once the game starts.'}</p>
    </div>`
}

function renderWaiting(msg, emoji) {
  app.innerHTML = `
    <div class="waiting-splash stack">
      <div class="avatar">${emoji}</div>
      <h2>${msg}<span class="dots"></span></h2>
      <p class="muted">Hang tight — your turn is coming.</p>
    </div>`
}

// ---------------------------------------------------------------------------
// results (reveal + final)
// ---------------------------------------------------------------------------

async function computeRound(round) {
  const players = state.players.filter((p) => ROLE_ORDER.includes(p.role))
  const schedRows = await getSchedules(state.room.id, round)
  const targets = await getTargets(state.room.id, round)
  const prior = {}
  if (round === 2) for (const p of players) prior[p.role] = p.r1_burnout
  const entries = players.map((p) => {
    const s = schedRows.find((row) => row.player_id === p.id)
    return {
      role: p.role,
      schedule: s
        ? {
            deep_work_hrs: s.deep_work_hrs,
            admin_hrs: s.admin_hrs,
            learning_hrs: s.learning_hrs,
            rest_hrs: s.rest_hrs,
          }
        : blankDraft(),
      target_per_day: targets[p.role] || 0,
    }
  })
  return evaluateRound(entries, state.room.meeting_hrs, round, prior)
}

async function renderResult(round) {
  renderWaiting('Tallying the results', '📊')
  let me, verdict
  try {
    const { results, company } = await computeRound(round)
    me = results.find((r) => r.role === state.player.role)
    verdict = teamVerdict(company, 1) // round-1 baseline verdict
  } catch (e) {
    console.error(e)
    return renderWaiting('Waiting for the reveal', '📊')
  }
  verdict.win ? sfx.win() : sfx.fail()
  const r = ROLES[state.player.role]
  app.innerHTML = `
    <div class="stack">
      <div class="team-result ${verdict.win ? 'win' : 'fail'} stack center">
        <div class="pill">Team result</div>
        <h2 style="margin:.1em 0">${verdict.win ? '🎉 ' : ''}${verdict.headline}</h2>
        <p class="muted" style="margin:0">${verdict.detail}</p>
      </div>
      <div class="result-hero stack role-${state.player.role}">
        <div class="avatar role-${state.player.role}">${avatarSVG(state.player.role)}</div>
        <h2 style="margin:0">${r.name}</h2>
        <div class="title muted">${r.title}</div>
        <div><span class="badge ${me.medal ? 'win' : 'fail'}">${me.medal ? '🏅 ' + r.medalLabel : '— no medal'}</span></div>
        <div class="medal-result muted">${me.medal ? '✅ Earned' : '❌ Missed'} · ${r.target}</div>
        <div class="pill">${me.summary.label}: ${me.summary.value}</div>
        ${me.carry > 0 ? `<div class="muted">🔋 +${Math.round(me.carry)} burnout carried from Round 1</div>` : ''}
      </div>
      <div class="card">
        <div class="gauges" id="g"></div>
      </div>
      <div class="center muted">Watch the big screen for the full reveal.</div>
    </div>`
  const g = document.getElementById('g')
  METRICS.forEach((m) => {
    const v = me.metrics[m.key]
    const node = document.createElement('div')
    node.className = 'gauge'
    node.innerHTML = `
      <div class="gauge-top"><span>${m.label}</span><span class="gauge-val">${v}</span></div>
      <div class="track"><div class="fill" style="width:${v}%;background:${gaugeColor(m, v)}"></div></div>`
    g.appendChild(node)
  })
}

async function renderFinal() {
  renderWaiting('Comparing your two weeks', '📈')
  let r1, r2
  try {
    r1 = await computeRound(1)
    r2 = await computeRound(2)
  } catch (e) {
    console.error(e)
    return renderWaiting('Waiting for the final reveal', '📈')
  }
  const role = state.player.role
  const a = r1.results.find((x) => x.role === role)
  const b = r2.results.find((x) => x.role === role)
  const r = ROLES[role]
  const baseline = {
    output: r1.company.company_output,
    burnout: r1.company.team_burnout,
    wellbeing: r1.company.team_wellbeing,
  }
  const verdict = teamVerdict(r2.company, 2, baseline)
  verdict.win ? sfx.win() : sfx.fail()

  app.innerHTML = `
    <div class="stack">
      <div class="team-result ${verdict.win ? 'win' : 'fail'} stack center">
        <div class="pill">The verdict · 32-hour week</div>
        <h2 style="margin:.1em 0">${verdict.win ? '🎉 ' : ''}${verdict.headline}</h2>
        <p class="muted" style="margin:0">${verdict.detail}</p>
      </div>
      <div class="result-hero stack role-${role}">
        <div class="avatar role-${role}">${avatarSVG(role)}</div>
        <h2 style="margin:0">${r.name}</h2>
        <div class="row" style="display:flex;gap:10px;justify-content:center">
          <span class="badge ${a.medal ? 'win' : 'fail'}">R1 ${a.medal ? '🏅' : '—'}</span>
          <span class="badge ${b.medal ? 'win' : 'fail'}">R2 ${b.medal ? '🏅' : '—'}</span>
        </div>
        <div class="muted">${r.medalLabel}</div>
      </div>
      <div class="card stack">
        <h3 style="margin:0">40-hour week → 32-hour week</h3>
        <div id="cmp" class="stack"></div>
      </div>
      <div class="card center stack">
        <h3 style="margin:0">💬 Discuss</h3>
        <p>What did you cut first — and would you keep the four-day week?</p>
      </div>
    </div>`
  const cmp = document.getElementById('cmp')
  METRICS.forEach((m) => {
    const v1 = a.metrics[m.key]
    const v2 = b.metrics[m.key]
    const node = document.createElement('div')
    node.innerHTML = `
      <div style="display:flex;justify-content:space-between"><strong>${m.label}</strong><span class="muted">${v1} → ${v2}</span></div>
      <div class="cmp-bars" style="margin:4px 0 10px">
        <div class="cmp-bar r1"><span style="width:${v1}%"></span><small>R1 ${v1}</small></div>
        <div class="cmp-bar r2"><span style="width:${v2}%"></span><small>R2 ${v2}</small></div>
      </div>`
    cmp.appendChild(node)
  })
}

// ---------------------------------------------------------------------------
// in-game role overlay — a floating "ℹ️ Role" button that reopens the role
// card during play, so a player can re-check their goal without leaving.
// ---------------------------------------------------------------------------

// Phases where a real (non-spectator) player is actively playing and may want
// to re-read their role. The lobby + "Michael is setting up" pages already show
// the full role card, so the button would be redundant there.
const ROLE_FAB_PHASES = ['allocating', 'round2_allocating', 'reveal', 'final']

function ensureRoleUI() {
  if (document.getElementById('roleFab')) return
  const fab = document.createElement('button')
  fab.id = 'roleFab'
  fab.className = 'role-fab'
  fab.type = 'button'
  fab.innerHTML = 'ℹ️ Role'
  fab.addEventListener('click', () => openRoleModal())
  document.body.appendChild(fab)

  const backdrop = document.createElement('div')
  backdrop.id = 'roleModal'
  backdrop.className = 'modal-backdrop'
  backdrop.hidden = true
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) closeRoleModal()
  })
  document.body.appendChild(backdrop)
}

function openRoleModal() {
  const backdrop = document.getElementById('roleModal')
  if (!backdrop) return
  backdrop.innerHTML = `
    <div class="modal-card stack" role="dialog" aria-modal="true">
      ${roleCardHTML(state.player.role)}
      ${glossaryHTML()}
      ${controlGuideHTML()}
      <button class="big ghost" data-close type="button">Close</button>
    </div>`
  backdrop.hidden = false
}

function closeRoleModal() {
  const backdrop = document.getElementById('roleModal')
  if (backdrop) backdrop.hidden = true
}

// Show the floating button only when a real player is mid-game; hide (and close
// any open modal) otherwise. Called from render() after every phase paint.
function syncRoleUI() {
  const role = state.player?.role
  const show = role && role !== 'spectator' && ROLE_FAB_PHASES.includes(state.room.phase)
  if (!show) return hideRoleUI()
  ensureRoleUI()
  document.getElementById('roleFab').hidden = false
}

function hideRoleUI() {
  document.getElementById('roleFab')?.setAttribute('hidden', '')
  closeRoleModal()
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function gaugeColor(metric, value) {
  // goodness 0..100 — higher = healthier, then map red→green.
  const goodness = metric.good === 'low' ? 100 - value : value
  const hue = (goodness / 100) * 125 // 0=red .. 125=green
  return `hsl(${hue}, 65%, 48%)`
}

function setBusy(id, busy) {
  const b = document.getElementById(id)
  if (b) b.disabled = busy
}

// Clamp a stepped value into [min, max], rounding tiny float drift to the step grid.
function clampStep(v, min, max) {
  const snapped = Math.round(v * 2) / 2 // SLIDER_STEP = 0.5
  return Math.max(min, Math.min(max, snapped))
}

let toastTimer
function toast(msg) {
  document.querySelector('.toast')?.remove()
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  document.body.appendChild(t)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.remove(), 3000)
}

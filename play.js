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
  const phase = state.room.phase
  if (state.player.role === 'spectator') return renderSpectator()
  const isMichael = state.player.role === 'michael'
  switch (phase) {
    case 'lobby':
      return renderLobby()
    case 'michael_sets':
      return isMichael ? renderMichaelSetup(false) : renderWaiting('Michael is planning the week', '🧑‍💼')
    case 'allocating':
    case 'round2_allocating':
      return state.locked ? renderLocked() : renderAllocating()
    case 'reveal':
      return renderResult(1)
    case 'round2_setup':
      return isMichael ? renderMichaelSetup(true) : renderWaiting('Michael is adjusting the schedule', '🧑‍💼')
    case 'final':
      return renderFinal()
    default:
      return renderWaiting('Stand by', '📺')
  }
}

// ---------------------------------------------------------------------------
// lobby — role card
// ---------------------------------------------------------------------------

function renderLobby() {
  const r = ROLES[state.player.role]
  app.innerHTML = `
    <div class="stack" style="padding-top:6vh">
      <div class="center"><div class="pill">Room ${state.room.code} · You're in!</div></div>
      <div class="card stack role-${state.player.role}">
        <div class="role-head">
          <div class="avatar role-${state.player.role}">${avatarSVG(state.player.role)}</div>
          <div>
            <div class="name">${r.name}</div>
            <div class="title">${r.title}</div>
          </div>
        </div>
        <p><strong>🎯 Goal.</strong> ${r.goal}</p>
        <p><strong>⚠️ Weakness.</strong> ${r.weakness}</p>
        <p class="target-note"><strong>To win:</strong> ${r.target}</p>
      </div>
      <div class="center muted">Waiting for the host to start the game…</div>
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

  app.innerHTML = `
    <div class="stack">
      <div class="center"><div class="pill">${isRound2 ? 'Round 2 · 32-hour week' : 'Round 1 · 40-hour week'}</div></div>
      <h2>${isRound2 ? 'Trim the schedule' : 'Set the schedule'}</h2>
      <p class="muted">
        ${
          isRound2
            ? 'Friday is gone. You may only reduce meetings and targets — not raise them.'
            : 'Your meeting hours apply to everyone, every day, and are deducted before anyone allocates.'
        }
      </p>

      <div class="slider-row">
        <div class="slider-top">
          <span class="slider-label">📣 Daily meeting hours (everyone)</span>
          <span class="slider-hrs" id="meet-hrs">${meetingStart.toFixed(1)}h</span>
        </div>
        <input id="meet" type="range" min="0" max="${meetingMax}" step="${SLIDER_STEP}" value="${meetingStart}" />
        <div class="slider-desc" id="meet-week"></div>
      </div>

      <h3 style="margin-top:8px">Deep-work targets <span class="muted" style="font-weight:400">(hrs/day per person)</span></h3>
      <div class="stack" id="targets"></div>

      <button id="lock" class="big">${isRound2 ? 'Lock & start Round 2' : 'Lock in & unlock the team'}</button>
    </div>`

  const targetWrap = document.getElementById('targets')
  for (const p of employees) {
    const r = ROLES[p.role]
    const prev = state.targets[p.role]
    const tMax = isRound2 && prev != null ? prev : 6
    const tStart = prev != null ? prev : 3
    const row = document.createElement('div')
    row.className = 'slider-row'
    row.innerHTML = `
      <div class="slider-top">
        <span class="slider-label">${r.emoji} ${r.name} <span class="muted">(${p.display_name})</span></span>
        <span class="slider-hrs" data-out="${p.role}">${tStart.toFixed(1)}h</span>
      </div>
      <input type="range" data-role="${p.role}" min="0" max="${tMax}" step="${SLIDER_STEP}" value="${tStart}" />`
    targetWrap.appendChild(row)
  }

  const meet = document.getElementById('meet')
  const meetOut = document.getElementById('meet-hrs')
  const meetWeek = document.getElementById('meet-week')
  const days = daysInRound(isRound2 ? 2 : 1)
  const updateMeet = () => {
    const v = parseFloat(meet.value)
    meetOut.textContent = v.toFixed(1) + 'h'
    meetWeek.textContent = `= ${(v * days).toFixed(1)}h/week of meetings · leaves ${dailyAllocatable(v).toFixed(1)}h/day to allocate`
  }
  meet.addEventListener('input', updateMeet)
  updateMeet()

  targetWrap.querySelectorAll('input[type=range]').forEach((inp) => {
    inp.addEventListener('input', () => {
      targetWrap.querySelector(`[data-out="${inp.dataset.role}"]`).textContent =
        parseFloat(inp.value).toFixed(1) + 'h'
    })
  })

  document.getElementById('lock').addEventListener('click', async () => {
    audioResume()
    sfx.lock()
    setBusy('lock', true)
    const meetingHrs = parseFloat(meet.value)
    const targetsByRole = {}
    targetWrap.querySelectorAll('input[type=range]').forEach((inp) => {
      targetsByRole[inp.dataset.role] = parseFloat(inp.value)
    })
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
    <div class="stack">
      <div class="center"><div class="pill">${round === 1 ? 'Round 1 · 40h week' : 'Round 2 · 32h week'} · ${r.name}</div></div>

      <div class="budget" id="budget">
        <span>Hours left today</span>
        <span class="left-hrs" id="left">0.0h</span>
      </div>
      <div class="muted center" style="margin-top:-6px">
        Meetings take ${meeting.toFixed(1)}h/day · you allocate ${budget.toFixed(1)}h/day × ${days} days
      </div>

      ${myTarget != null && myTarget > 0
        ? `<div class="target-note">📣 Michael expects <strong>${myTarget.toFixed(1)}h/day</strong> of deep work from you (${(myTarget * days).toFixed(1)}h/week).</div>`
        : ''}
      <div class="target-note" style="background:var(--panel-2);border-color:var(--line)"><strong>Win:</strong> ${r.target}</div>

      <div class="stack" id="sliders"></div>

      <div class="card stack">
        <h3 style="margin:0">Your week at a glance</h3>
        <div class="gauges" id="gauges"></div>
      </div>

      <button id="lock" class="big" disabled>Lock in my week</button>
    </div>`

  const sliderWrap = document.getElementById('sliders')
  CATEGORIES.forEach((c) => {
    const row = document.createElement('div')
    row.className = 'slider-row'
    row.innerHTML = `
      <div class="slider-top">
        <span class="slider-label">${c.emoji} ${c.label}</span>
        <span class="slider-hrs" data-out="${c.key}">0.0h</span>
      </div>
      <input type="range" data-key="${c.key}" min="0" max="${budget}" step="${SLIDER_STEP}" value="0" />
      <div class="slider-desc">${c.desc}</div>`
    sliderWrap.appendChild(row)
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

  const inputs = [...sliderWrap.querySelectorAll('input[type=range]')]
  const lockBtn = document.getElementById('lock')

  const recompute = (changed) => {
    // clamp total to budget by trimming the slider just moved
    let total = inputs.reduce((s, i) => s + parseFloat(i.value), 0)
    if (total > budget + 1e-9 && changed) {
      const others = total - parseFloat(changed.value)
      changed.value = Math.max(0, budget - others)
      total = inputs.reduce((s, i) => s + parseFloat(i.value), 0)
    }
    inputs.forEach((i) => {
      state.draft[i.dataset.key] = parseFloat(i.value)
      sliderWrap.querySelector(`[data-out="${i.dataset.key}"]`).textContent =
        parseFloat(i.value).toFixed(1) + 'h'
    })
    const left = budget - total
    const leftEl = document.getElementById('left')
    leftEl.textContent = left.toFixed(1) + 'h'
    document.getElementById('budget').classList.toggle('over', left < -1e-9)

    const carry = round === 2 ? burnoutCarry(state.player.r1_burnout) : 0
    const { metrics } = computePersonal(state.draft, meeting, round, carry)
    METRICS.forEach((m) => {
      const v = metrics[m.key]
      gaugeWrap.querySelector(`[data-g="${m.key}"]`).textContent = v
      const fill = gaugeWrap.querySelector(`[data-fill="${m.key}"]`)
      fill.style.width = v + '%'
      fill.style.background = gaugeColor(m, v)
    })
    lockBtn.disabled = total <= 0 || left < -1e-9
  }

  inputs.forEach((i) => i.addEventListener('input', () => recompute(i)))
  recompute(null)

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
  let me, company
  try {
    const { results, company: co } = await computeRound(round)
    company = co
    me = results.find((r) => r.role === state.player.role)
  } catch (e) {
    console.error(e)
    return renderWaiting('Waiting for the reveal', '📊')
  }
  me.win ? sfx.win() : sfx.fail()
  const r = ROLES[state.player.role]
  app.innerHTML = `
    <div class="stack">
      <div class="result-hero stack role-${state.player.role}">
        <div class="avatar role-${state.player.role}">${avatarSVG(state.player.role)}</div>
        <h2 style="margin:0">${r.name}</h2>
        <div class="title muted">${r.title}</div>
        <div><span class="badge ${me.win ? 'win' : 'fail'}">${me.win ? '✓ Goal met' : '✗ Goal missed'}</span></div>
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

  app.innerHTML = `
    <div class="stack">
      <div class="result-hero stack role-${role}">
        <div class="avatar role-${role}">${avatarSVG(role)}</div>
        <h2 style="margin:0">${r.name}</h2>
        <div class="row" style="display:flex;gap:10px;justify-content:center">
          <span class="badge ${a.win ? 'win' : 'fail'}">R1 ${a.win ? '✓' : '✗'}</span>
          <span class="badge ${b.win ? 'win' : 'fail'}">R2 ${b.win ? '✓' : '✗'}</span>
        </div>
      </div>
      <div class="card stack">
        <h3 style="margin:0">40-hour week → 32-hour week</h3>
        <div id="cmp" class="stack"></div>
      </div>
      <div class="card center stack">
        <h3 style="margin:0">💬 Discuss</h3>
        <p>What did you cut first — and why?</p>
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

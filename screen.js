// screen.js — big-screen / host controller.

import {
  ROLES,
  ROLE_ORDER,
  METRICS,
  CATEGORIES,
  daysInRound,
  evaluateRound,
  teamVerdict,
  TEAM_GOAL,
  ROUND_INTRO,
  OUTPUT_FLOOR,
  BURNOUT_CAP,
} from './game.js'
import {
  createRoom,
  getRoomByCode,
  getPlayers,
  getSchedules,
  getTargets,
  setPhase,
  subscribeRoom,
  subscribePlayers,
} from './db.js'
import { avatarSVG } from './avatars.js'
import { sfx, resume as audioResume, toggleMuted, isMuted } from './audio.js'

const app = document.getElementById('app')
const STORE_KEY = 'www_screen'

const state = {
  room: null,
  players: [],
  revealIdx: 0, // slide index during reveal / final
  slides: [], // built when entering reveal/final
  channels: [],
  autoAdvance: false, // when on, allocation auto-advances once all players lock
}

// Real (non-spectator) players, in join order.
const realPlayers = () => state.players.filter((p) => ROLE_ORDER.includes(p.role))

init()

async function init() {
  const params = new URLSearchParams(location.search)
  const codeParam = (params.get('code') || '').toUpperCase()
  try {
    if (codeParam) {
      state.room = await getRoomByCode(codeParam)
    } else {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
      if (saved) state.room = await getRoomByCode(saved.code)
    }
    if (!state.room) state.room = await createRoom()
  } catch (e) {
    console.error(e)
    state.room = await createRoom()
  }
  localStorage.setItem(STORE_KEY, JSON.stringify({ code: state.room.code, id: state.room.id }))
  state.players = await getPlayers(state.room.id)
  subscribe()
  window.addEventListener('keydown', onKey)
  buildControls()
  await onEnterPhase()
  render()
}

// Persistent on-screen control bar (mirrors the Space / A / M keys) — useful on
// touchscreens and for automated testing.
function buildControls() {
  const bar = document.createElement('div')
  bar.className = 'controls'
  bar.innerHTML = `
    <button id="c-next" title="Advance (Space)">Next ▶</button>
    <button id="c-auto" class="ghost" title="Toggle auto-advance (A)">Auto: off</button>
    <button id="c-mute" class="ghost" title="Mute (M)">🔊</button>`
  document.body.appendChild(bar)
  bar.querySelector('#c-next').onclick = () => {
    audioResume()
    advance()
  }
  bar.querySelector('#c-auto').onclick = () => {
    audioResume()
    state.autoAdvance = !state.autoAdvance
    updateControls()
    maybeAutoAdvance()
    render()
  }
  bar.querySelector('#c-mute').onclick = () => {
    audioResume()
    toggleMuted()
    updateControls()
  }
  updateControls()
}

function updateControls() {
  const a = document.getElementById('c-auto')
  if (a) a.textContent = 'Auto: ' + (state.autoAdvance ? 'on' : 'off')
  const m = document.getElementById('c-mute')
  if (m) m.textContent = isMuted() ? '🔇' : '🔊'
}

function subscribe() {
  state.channels.push(
    subscribeRoom(state.room.id, async (room) => {
      const phaseChanged = room.phase !== state.room.phase
      state.room = room
      if (phaseChanged) await onEnterPhase()
      render()
    })
  )
  state.channels.push(
    subscribePlayers(state.room.id, async () => {
      const prev = state.players.length
      state.players = await getPlayers(state.room.id)
      if (state.players.length > prev && state.room.phase === 'lobby') sfx.join()
      // live updates to lobby roster + lock grid
      if (['lobby', 'allocating', 'round2_allocating'].includes(state.room.phase)) render()
      maybeAutoAdvance()
    })
  )
}

async function onEnterPhase() {
  state.players = await getPlayers(state.room.id)
  state.revealIdx = 0
  state.slides = []
  const phase = state.room.phase
  if (phase === 'reveal') {
    state.slides = await buildRevealSlides(1, false)
  } else if (phase === 'final') {
    state.slides = await buildRevealSlides(2, true)
  }
}

// ---------------------------------------------------------------------------
// host controls
// ---------------------------------------------------------------------------

function onKey(e) {
  audioResume() // browsers need a user gesture before audio can play
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowRight') {
    e.preventDefault()
    advance()
  } else if (e.code === 'KeyM') {
    flash('Sound ' + (toggleMuted() ? 'muted' : 'on'))
    updateControls()
  } else if (e.code === 'KeyA') {
    state.autoAdvance = !state.autoAdvance
    flash('Auto-advance ' + (state.autoAdvance ? 'ON' : 'OFF'))
    updateControls()
    maybeAutoAdvance()
    render()
  }
}

// Advance automatically once every real player has locked, if enabled.
function maybeAutoAdvance() {
  const phase = state.room.phase
  if (!state.autoAdvance) return
  if (phase !== 'allocating' && phase !== 'round2_allocating') return
  const real = realPlayers()
  const key = state.room.round === 1 ? 'locked_r1' : 'locked_r2'
  if (real.length > 0 && real.every((p) => p[key])) advance()
}

async function advance() {
  const phase = state.room.phase
  switch (phase) {
    case 'lobby':
      if (realPlayers().length < 2) return flash('Need at least 2 players')
      return setPhase(state.room.id, 'michael_sets')
    case 'michael_sets':
    case 'round2_setup':
      return flash('Waiting for Michael to lock in…')
    case 'allocating':
      return setPhase(state.room.id, 'reveal')
    case 'round2_allocating':
      return setPhase(state.room.id, 'final')
    case 'reveal':
      if (state.revealIdx < state.slides.length - 1) {
        state.revealIdx++
        return render()
      }
      return setPhase(state.room.id, 'round2_setup')
    case 'final':
      if (state.revealIdx < state.slides.length - 1) {
        state.revealIdx++
        return render()
      }
      return flash('That’s the whole game — thanks for playing!')
  }
}

// ---------------------------------------------------------------------------
// render switch
// ---------------------------------------------------------------------------

function stage(inner, hint) {
  app.innerHTML = `
    <div class="stage">
      <div class="stage-head">
        <div class="brand">📎 Work Week Wars</div>
        <div class="muted">Room ${state.room.code}</div>
      </div>
      <div class="stage-body">${inner}</div>
      <div class="hint">${hint || ''}</div>
    </div>`
}

const SPACE_HINT = 'Press <kbd>Space</kbd> to continue'

function render() {
  switch (state.room.phase) {
    case 'lobby':
      return renderLobby()
    case 'michael_sets':
      return renderIntro(1)
    case 'allocating':
    case 'round2_allocating':
      return renderAllocating()
    case 'reveal':
    case 'final':
      return renderSlide()
    case 'round2_setup':
      return renderRound2Setup()
  }
}

// ---------------------------------------------------------------------------
// lobby
// ---------------------------------------------------------------------------

function renderLobby() {
  // Base = current directory URL (drop the last path segment, whatever it is:
  // "screen.html", a clean "/screen" rewrite, or "" for a trailing slash).
  const base = location.href.split('?')[0].replace(/[^/]*$/, '')
  const joinUrl = base + 'play.html?code=' + state.room.code
  stage(
    `
    <div class="lobby-grid">
      <div>
        <div class="muted" style="font-size:1.4rem">Join at this code</div>
        <div class="joincode">${state.room.code}</div>
        <div class="joinurl">${joinUrl.replace(/^https?:\/\//, '')}</div>
      </div>
      <div id="qrcode"></div>
    </div>
    ${renderPlayerSlots()}
  `,
    realPlayers().length >= 2
      ? `${realPlayers().length} players in · ${SPACE_HINT} to start · <kbd>M</kbd> mutes sound`
      : 'Waiting for players to join… (need at least 2)'
  )

  const qr = document.getElementById('qrcode')
  if (qr && window.QRCode) {
    qr.innerHTML = ''
    new window.QRCode(qr, { text: joinUrl, width: 200, height: 200, colorDark: '#14181f', colorLight: '#ffffff' })
  }
}

function renderPlayerSlots() {
  const real = realPlayers()
  const tiles = ROLE_ORDER.map((role) => {
    const p = real.find((x) => x.role === role)
    const r = ROLES[role]
    if (!p) {
      return `<div class="player-tile empty">
        <div class="avatar">＋</div>
        <div class="pname">Open seat</div>
        <div class="prole">${r.name}</div>
      </div>`
    }
    return `<div class="player-tile role-${role}" style="--c:var(--${role})">
      <div class="avatar role-${role}">${avatarSVG(role)}</div>
      <div class="pname">${escapeHtml(p.display_name)}</div>
      <div class="prole">${r.name}</div>
    </div>`
  }).join('')
  const specs = state.players.length - real.length
  const specBadge = specs > 0
    ? `<div class="center muted" style="margin-top:16px;font-size:1.3rem">👀 ${specs} spectator${specs > 1 ? 's' : ''} watching</div>`
    : ''
  return `<div class="player-grid">${tiles}</div>${specBadge}`
}

// ---------------------------------------------------------------------------
// thinking / waiting
// ---------------------------------------------------------------------------

// Round intro narrative (Dunder Mifflin framing) shown on the big screen while
// Michael sets up. The shared team goal sits underneath so everyone sees it.
function renderIntro(round) {
  const intro = ROUND_INTRO[round]
  stage(
    `<div class="intro">
      <div class="pill">${intro.pill}</div>
      <h1 class="intro-title">${intro.title}</h1>
      <p class="intro-body">${intro.body}</p>
      <div class="team-goal">
        <div class="tg-title">🎯 ${TEAM_GOAL.title}</div>
        <div class="tg-line">${TEAM_GOAL.output} ${TEAM_GOAL.wellbeing}</div>
      </div>
      <p class="muted" style="font-size:1.3rem;margin-top:2vh">${
        round === 1 ? 'Michael is setting meetings and deep-work targets' : 'Michael is trimming meetings and targets'
      }<span class="dots"></span></p>
    </div>`,
    'Waiting for Michael…'
  )
}

// ---------------------------------------------------------------------------
// allocating — lock grid
// ---------------------------------------------------------------------------

function renderAllocating() {
  const round = state.room.round
  const lockedKey = round === 1 ? 'locked_r1' : 'locked_r2'
  const real = realPlayers()
  const lockedCount = real.filter((p) => p[lockedKey]).length
  const tiles = real
    .map((p) => {
      const r = ROLES[p.role]
      const done = p[lockedKey]
      return `<div class="player-tile role-${p.role} ${done ? 'locked' : ''}" style="--c:var(--${p.role})">
        <div class="tick">✅</div>
        <div class="avatar role-${p.role}">${avatarSVG(p.role)}</div>
        <div class="pname">${escapeHtml(p.display_name)}</div>
        <div class="prole">${r.name}</div>
        <div class="status ${done ? 'done' : 'waiting'}">${done ? 'Locked in' : 'Choosing…'}</div>
      </div>`
    })
    .join('')
  const all = lockedCount === real.length && real.length > 0
  const auto = `Auto-advance: <strong>${state.autoAdvance ? 'ON' : 'OFF'}</strong> (press <kbd>A</kbd>)`
  const hint = state.autoAdvance
    ? (all ? 'Revealing…' : auto)
    : `${all ? 'Everyone’s ready — ' : ''}${SPACE_HINT} to reveal · ${auto}`
  stage(
    `<h1 class="center">${round === 1 ? 'Round 1 · 40-hour week' : 'Round 2 · 32-hour week'}</h1>
     <p class="center muted" style="font-size:1.5rem">Allocating the week — ${lockedCount} / ${real.length} locked in</p>
     <div class="player-grid">${tiles}</div>`,
    hint
  )
}

// ---------------------------------------------------------------------------
// round 2 setup — calendar
// ---------------------------------------------------------------------------

function renderRound2Setup() {
  const intro = ROUND_INTRO[2]
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const cal = days
    .map((d) => `<div class="day ${d === 'Fri' ? 'struck' : ''}">${d}</div>`)
    .join('')
  stage(
    `<div class="intro">
      <div class="pill">${intro.pill}</div>
      <h1 class="intro-title">${intro.title}</h1>
      <div class="calendar">${cal}</div>
      <p class="intro-body">${intro.body}</p>
      <div class="team-goal">
        <div class="tg-title">🎯 Beat your 40-hour baseline</div>
        <div class="tg-line">Hold output at the line, and end up <strong>healthier</strong> than Round 1 — less burnout, more wellbeing.</div>
      </div>
      <p class="muted" style="font-size:1.3rem;margin-top:2vh">Michael is trimming meetings and targets<span class="dots"></span></p>
    </div>`,
    'Waiting for Michael…'
  )
}

// ---------------------------------------------------------------------------
// reveal / final slides
// ---------------------------------------------------------------------------

async function buildRevealSlides(round, isFinal) {
  let evals1 = null
  const evalRound = await computeRound(round)
  if (isFinal) evals1 = await computeRound(1)

  const slides = []
  for (const r of evalRound.results) {
    slides.push({ type: 'player', round, result: r, compareTo: isFinal ? evals1.results.find((x) => x.role === r.role) : null })
  }
  slides.push({ type: 'company', round, company: evalRound.company })

  // Team verdict — the headline. R1 = baseline; R2 judged vs the R1 baseline.
  const baseline = isFinal ? baselineFrom(evals1.company) : null
  const verdict = teamVerdict(evalRound.company, round, baseline)
  slides.push({ type: 'team', round, verdict })

  if (isFinal) {
    slides.push({ type: 'compare', r1: evals1, r2: evalRound })
    slides.push({
      type: 'debrief',
      v1: teamVerdict(evals1.company, 1),
      v2: verdict,
      r1: evals1.company,
      r2: evalRound.company,
    })
  }
  return slides
}

function baselineFrom(c) {
  return { output: c.company_output, burnout: c.team_burnout, wellbeing: c.team_wellbeing }
}

async function computeRound(round) {
  const players = (await getPlayers(state.room.id)).filter((p) => ROLE_ORDER.includes(p.role))
  const schedRows = await getSchedules(state.room.id, round)
  const targets = await getTargets(state.room.id, round)
  const prior = {}
  if (round === 2) for (const p of players) prior[p.role] = p.r1_burnout
  const entries = players.map((p) => {
    const s = schedRows.find((row) => row.player_id === p.id)
    return {
      role: p.role,
      schedule: s
        ? { deep_work_hrs: s.deep_work_hrs, admin_hrs: s.admin_hrs, learning_hrs: s.learning_hrs, rest_hrs: s.rest_hrs }
        : { deep_work_hrs: 0, admin_hrs: 0, learning_hrs: 0, rest_hrs: 0 },
      target_per_day: targets[p.role] || 0,
    }
  })
  return evaluateRound(entries, state.room.meeting_hrs, round, prior)
}

function renderSlide() {
  const slide = state.slides[state.revealIdx]
  if (!slide) return stage('<h1 class="center">…</h1>', SPACE_HINT)
  const last = state.revealIdx === state.slides.length - 1
  const hint =
    state.room.phase === 'reveal'
      ? last
        ? `${SPACE_HINT} to Round 2`
        : SPACE_HINT
      : last
        ? 'That’s a wrap 🎬'
        : SPACE_HINT

  // Play sounds once per distinct slide (not on incidental re-renders).
  const soundKey = state.room.phase + ':' + state.revealIdx
  const newSlide = state._soundKey !== soundKey
  state._soundKey = soundKey

  if (slide.type === 'player') {
    stage(playerCardHtml(slide), hint)
    animateCard()
    if (newSlide) (slide.result.medal ? sfx.win() : sfx.fail())
    return
  }
  if (slide.type === 'company') {
    stage(companyCardHtml(slide), hint)
    animateCard()
    if (newSlide) sfx.fanfare()
    return
  }
  if (slide.type === 'team') {
    stage(teamCardHtml(slide), hint)
    animateCard()
    if (newSlide) {
      if (slide.verdict.win) {
        sfx.win()
        confetti()
      } else sfx.fail()
    }
    return
  }
  if (slide.type === 'compare') return stage(compareHtml(slide), hint)
  if (slide.type === 'debrief') {
    stage(debriefHtml(slide), hint)
    if (newSlide && slide.v2.win) confetti()
    return
  }
}

// Animate any [data-fill] bars from 0 and count up any [data-count] numbers.
function animateCard() {
  document.querySelectorAll('[data-fill]').forEach((el) => {
    requestAnimationFrame(() => (el.style.width = el.dataset.fill + '%'))
  })
  document.querySelectorAll('[data-count]').forEach((el) => {
    const target = +el.dataset.count
    const dur = 700
    const t0 = performance.now()
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur)
      const eased = 0.5 - Math.cos(k * Math.PI) / 2
      el.textContent = Math.round(target * eased)
      if (k < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

// A quick confetti burst from the centre of the screen.
function confetti() {
  const cvs = document.createElement('canvas')
  cvs.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:60'
  cvs.width = innerWidth
  cvs.height = innerHeight
  document.body.appendChild(cvs)
  const cx = cvs.getContext('2d')
  const colors = ['#2f6fb3', '#4caf72', '#e2b03b', '#c2603a', '#3b8e8e', '#ffffff']
  const parts = Array.from({ length: 150 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 240,
    y: innerHeight * 0.42,
    vx: (Math.random() - 0.5) * 13,
    vy: Math.random() * -13 - 4,
    g: 0.4 + Math.random() * 0.3,
    s: 6 + Math.random() * 9,
    c: colors[(Math.random() * colors.length) | 0],
    rot: Math.random() * 6,
    vr: (Math.random() - 0.5) * 0.5,
  }))
  let frames = 0
  const tick = () => {
    frames++
    cx.clearRect(0, 0, cvs.width, cvs.height)
    for (const p of parts) {
      p.vy += p.g
      p.x += p.vx
      p.y += p.vy
      p.rot += p.vr
      cx.save()
      cx.translate(p.x, p.y)
      cx.rotate(p.rot)
      cx.fillStyle = p.c
      cx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6)
      cx.restore()
    }
    if (frames < 130) requestAnimationFrame(tick)
    else cvs.remove()
  }
  tick()
}

function playerCardHtml(slide) {
  const r = ROLES[slide.result.role]
  const res = slide.result
  const maxWeek = 40
  const cats = [
    { label: 'Deep work', key: 'deep', color: 'var(--good)' },
    { label: 'Meetings', key: 'meet', color: 'var(--muted)' },
    { label: 'Admin', key: 'admin', color: 'var(--warn)' },
    { label: 'Learning', key: 'learn', color: 'var(--accent-2)' },
    { label: 'Rest', key: 'rest', color: 'var(--pam)' },
  ]
  const bars = cats
    .map((c) => {
      const wk = res.weekly[c.key]
      return `<div class="sched-bar">
        <span>${c.label}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, (wk / maxWeek) * 100)}%;background:${c.color}"></div></div>
        <span style="text-align:right">${round1(wk)}h</span>
      </div>`
    })
    .join('')

  const gauges = METRICS.map((m) => {
    const v = res.metrics[m.key]
    return `<div class="gauge">
      <div class="gauge-top"><span>${m.label}</span><span class="gauge-val" data-count="${v}">0</span></div>
      <div class="track"><div class="fill" style="width:0;background:${gaugeColor(m, v)}" data-fill="${v}"></div></div>
    </div>`
  }).join('')

  return `
    <div class="reveal-card role-${res.role}" style="--c:var(--${res.role})">
      <div class="role-head">
        <div class="avatar role-${res.role}">${avatarSVG(res.role)}</div>
        <div style="flex:1">
          <div class="name">${r.name}</div>
          <div class="title">${r.title} · ${escapeHtml(playerName(res.role))}</div>
        </div>
        <span class="badge ${res.medal ? 'win' : 'fail'}">${res.medal ? '🏅 ' + r.medalLabel : '— no medal'}</span>
      </div>
      <div class="reveal-grid">
        <div>
          <h3>Weekly schedule</h3>
          <div class="sched-bars">${bars}</div>
          <p class="muted" style="margin-top:14px">${res.summary.label}: <strong style="color:var(--text)">${res.summary.value}</strong></p>
          ${res.carry > 0 ? `<p class="muted" style="margin-top:6px">🔋 +${Math.round(res.carry)} burnout carried from Round 1</p>` : ''}
        </div>
        <div>
          <h3>Metrics</h3>
          <div class="gauges">${gauges}</div>
        </div>
      </div>
    </div>`
}

function companyCardHtml(slide) {
  const c = slide.company
  const delivered = c.company_output >= OUTPUT_FLOOR
  return `
    <div class="company">
      <h1>Dunder Mifflin — Company Output</h1>
      <p class="muted" style="font-size:1.5rem">Orders delivered, driven by deep work against Michael’s targets.</p>
      <div class="bigmeter">
        <div class="floor-mark" style="left:${OUTPUT_FLOOR}%" title="Orders floor"></div>
        <div class="fill" id="cofill" data-fill="${c.company_output}"></div>
      </div>
      <div class="bigmeter-val"><span data-count="${c.company_output}">0</span>/100
        <span class="muted" style="font-size:1.4rem">· orders floor ${OUTPUT_FLOOR} ${delivered ? '✓' : '✗'}</span>
      </div>
      <div class="legend" style="margin-top:18px">
        <span>Team wellbeing <strong>${c.team_wellbeing}</strong>${c.pam_buffer ? ' <span class="muted">(+5 Pam buffer)</span>' : ''}</span>
        <span>Team burnout <strong>${c.team_burnout}</strong></span>
        <span>Output <strong>${c.company_output}</strong></span>
      </div>
    </div>`
}

// The headline team verdict — win/lose for everyone, with the two axes shown.
function teamCardHtml(slide) {
  const v = slide.verdict
  const axes =
    v.round === 1
      ? `<div class="axis ${v.delivered ? 'pass' : 'fail'}">📦 Orders delivered — output ${v.output} (need ≥ ${OUTPUT_FLOOR}) ${v.delivered ? '✓' : '✗'}</div>
         <div class="axis ${v.healthy ? 'pass' : 'fail'}">🔋 Team out of burnout — ${v.burnout} (need ≤ ${BURNOUT_CAP}) ${v.healthy ? '✓' : '✗'}</div>`
      : `<div class="axis ${v.delivered ? 'pass' : 'fail'}">📦 Held the orders — output ${v.output} (need ≥ ${OUTPUT_FLOOR}) ${v.delivered ? '✓' : '✗'}</div>
         <div class="axis ${v.healthy ? 'pass' : 'fail'}">💚 Healthier than the 40h week — burnout & wellbeing both improved ${v.healthy ? '✓' : '✗'}</div>`
  return `
    <div class="team-verdict ${v.win ? 'win' : 'fail'}">
      <div class="pill">${v.round === 1 ? 'Round 1 · Team result' : 'Round 2 · The verdict'}</div>
      <h1 class="verdict-headline">${v.win ? '🎉 ' : ''}${v.headline}</h1>
      <div class="axes">${axes}</div>
      <p class="verdict-detail">${v.detail}</p>
    </div>`
}

function compareHtml(slide) {
  const rows = state.players
    .map((p) => {
      const a = slide.r1.results.find((x) => x.role === p.role)
      const b = slide.r2.results.find((x) => x.role === p.role)
      if (!a || !b) return ''
      const r = ROLES[p.role]
      const metricRows = METRICS.map((m) => {
        const v1 = a.metrics[m.key]
        const v2 = b.metrics[m.key]
        return `<div class="compare-metric">
          <span class="muted">${m.label}</span>
          <div class="cmp-bars">
            <div class="cmp-bar r1"><span style="width:${v1}%"></span><small>${v1}</small></div>
            <div class="cmp-bar r2"><span style="width:${v2}%"></span><small>${v2}</small></div>
          </div>
        </div>`
      }).join('')
      return `<div class="compare-row">
        <div class="role-head"><div class="avatar role-${p.role}">${avatarSVG(p.role)}</div><div><div style="font-weight:800">${r.name.split(' ')[0]}</div><div class="muted">${a.medal ? 'R1 🏅' : 'R1 —'} · ${b.medal ? 'R2 🏅' : 'R2 —'}</div></div></div>
        <div class="stack" style="display:grid;gap:8px">${metricRows}</div>
      </div>`
    })
    .join('')
  return `
    <div class="compare">
      <h1 class="center">40-hour week vs 32-hour week</h1>
      <div class="legend"><span><i class="r1" style="background:var(--accent)"></i>Round 1 (40h)</span><span><i class="r2" style="background:var(--good)"></i>Round 2 (32h)</span></div>
      ${rows}
    </div>`
}

// Data-driven debrief: the R1→R2 deltas, the verdict, and a tailored "what would
// have helped" prompt keyed to how the team actually lost (if it did).
function debriefHtml(slide) {
  const { v1, v2, r1, r2 } = slide
  const delta = (a, b, goodLow) => {
    const d = b - a
    const good = goodLow ? d < 0 : d > 0
    const arrow = d === 0 ? '→' : d > 0 ? '▲' : '▼'
    return `<span class="delta ${d === 0 ? '' : good ? 'good' : 'bad'}">${arrow} ${a} → ${b}</span>`
  }

  let lesson
  if (v2.win) {
    lesson =
      'You did it. Same orders out the door, and the team is genuinely better off — that’s the real four-day-week finding: shorter hours, focused work, healthier people, no loss of output.'
  } else if (v2.delivered && !v2.healthy) {
    lesson =
      'You held output but just crammed five days into four — burnout didn’t fall. What would have helped: trim Michael’s meetings/targets and trade some deep-work hours for rest, trusting the focus bonus to carry output.'
  } else if (!v2.delivered && v2.healthy) {
    lesson =
      'The team felt better but the orders slipped. What would have helped: protect a bit more deep work (and have Michael keep targets realistic) so output stayed above the line.'
  } else {
    lesson =
      'Output fell and the team wasn’t better off. What would have helped: cut meeting overhead, then rebalance — enough focused deep work to deliver, enough rest to recover.'
  }

  return `
    <div class="debrief">
      <div class="pill">Debrief · 40-hour → 32-hour</div>
      <div class="debrief-stats">
        <div class="dstat"><span class="muted">Output</span>${delta(r1.company_output, r2.company_output, false)}</div>
        <div class="dstat"><span class="muted">Team burnout</span>${delta(r1.team_burnout, r2.team_burnout, true)}</div>
        <div class="dstat"><span class="muted">Team wellbeing</span>${delta(r1.team_wellbeing, r2.team_wellbeing, false)}</div>
      </div>
      <h1 class="verdict-headline ${v2.win ? 'win' : 'fail'}">${v2.win ? '🎉 ' : ''}${v2.headline}</h1>
      <p class="intro-body" style="max-width:60ch;margin:2vh auto 0">${lesson}</p>
      <p class="muted" style="font-size:1.4rem;margin-top:3vh">💬 What did you cut first — and would you keep the four-day week?</p>
    </div>`
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function playerName(role) {
  const p = state.players.find((x) => x.role === role)
  return p ? p.display_name : ''
}

function gaugeColor(metric, value) {
  const goodness = metric.good === 'low' ? 100 - value : value
  const hue = (goodness / 100) * 125
  return `hsl(${hue}, 65%, 48%)`
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

let flashTimer
function flash(msg) {
  document.querySelector('.toast')?.remove()
  const t = document.createElement('div')
  t.className = 'toast'
  t.style.background = 'var(--accent)'
  t.textContent = msg
  document.body.appendChild(t)
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => t.remove(), 2500)
}

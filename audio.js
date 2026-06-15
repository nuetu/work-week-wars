// audio.js — tiny Web Audio synth. No audio files: every sound is generated, so
// there's nothing to host. Call resume() from a user gesture before playing.

let ctx = null
let muted = false

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (AC) ctx = new AC()
  }
  return ctx
}

export function resume() {
  try {
    ac()?.resume()
  } catch {}
}
export function setMuted(m) {
  muted = m
}
export function toggleMuted() {
  muted = !muted
  return muted
}
export function isMuted() {
  return muted
}

// One enveloped oscillator note.
function note(freq, start, dur, { type = 'sine', gain = 0.18 } = {}) {
  const a = ac()
  if (!a) return
  const t0 = a.currentTime + start
  const osc = a.createOscillator()
  const g = a.createGain()
  osc.type = type
  osc.frequency.value = freq
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(a.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

// A short filtered-noise burst (clicks / swoosh).
function noise(start, dur, { gain = 0.12, hp = 800 } = {}) {
  const a = ac()
  if (!a) return
  const t0 = a.currentTime + start
  const n = Math.floor(a.sampleRate * dur)
  const buf = a.createBuffer(1, n, a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n)
  const src = a.createBufferSource()
  src.buffer = buf
  const filt = a.createBiquadFilter()
  filt.type = 'highpass'
  filt.frequency.value = hp
  const g = a.createGain()
  g.gain.value = gain
  src.connect(filt).connect(g).connect(a.destination)
  src.start(t0)
}

function guard(fn) {
  return (...args) => {
    if (muted) return
    resume()
    try {
      fn(...args)
    } catch {}
  }
}

export const sfx = {
  join: guard(() => note(660, 0, 0.12, { type: 'triangle' })),
  lock: guard(() => {
    note(523.25, 0, 0.1, { type: 'triangle' })
    note(783.99, 0.09, 0.16, { type: 'triangle' })
  }),
  tick: guard(() => noise(0, 0.05, { gain: 0.06, hp: 1500 })),
  reveal: guard(() => {
    noise(0, 0.25, { gain: 0.08, hp: 600 })
    note(392, 0, 0.18, { type: 'sawtooth', gain: 0.06 })
  }),
  win: guard(() => {
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, i * 0.09, 0.28, { type: 'triangle' }))
  }),
  fail: guard(() => {
    note(311.13, 0, 0.22, { type: 'sawtooth', gain: 0.14 })
    note(233.08, 0.16, 0.34, { type: 'sawtooth', gain: 0.14 })
  }),
  fanfare: guard(() => {
    ;[523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
      note(f, i * 0.11, 0.4, { type: 'triangle', gain: 0.16 })
    )
  }),
}

// avatars.js — original SVG character avatars (not the copyrighted show likenesses;
// stylized office workers differentiated by hair, glasses, colour, and expression).

const COLORS = {
  michael: '#2f6fb3',
  dwight: '#9c7a2e',
  pam: '#c2603a',
  toby: '#5a7d5a',
  oscar: '#3b8e8e',
}

const FACE = {
  michael: { skin: '#f0c8a0', hair: '#5a3b22', long: false, glasses: false, mouth: 'grin', stache: false },
  dwight: { skin: '#e7b78f', hair: '#6b4a2b', long: false, glasses: false, mouth: 'flat', stache: false },
  pam: { skin: '#f0c8a0', hair: '#9a5a2b', long: true, glasses: false, mouth: 'smile', stache: false },
  toby: { skin: '#e2b48e', hair: '#8d8d8d', long: false, glasses: true, mouth: 'frown', stache: true },
  oscar: { skin: '#c68a64', hair: '#1f140d', long: false, glasses: true, mouth: 'flat', stache: false },
}

function mouthPath(kind) {
  if (kind === 'grin')
    return '<path d="M40 60 q10 12 20 0" fill="#fff" stroke="#7a3b2b" stroke-width="2"/>'
  if (kind === 'smile')
    return '<path d="M41 61 q9 8 18 0" fill="none" stroke="#9c4a3a" stroke-width="3" stroke-linecap="round"/>'
  if (kind === 'frown')
    return '<path d="M41 64 q9 -7 18 0" fill="none" stroke="#7a3b2b" stroke-width="3" stroke-linecap="round"/>'
  return '<line x1="42" y1="62" x2="58" y2="62" stroke="#7a3b2b" stroke-width="3" stroke-linecap="round"/>'
}

// Returns an inline SVG string sized to fill its container.
export function avatarSVG(role) {
  const f = FACE[role]
  if (!f) return '📺'
  const c = COLORS[role]
  const hair = f.long
    ? `<path d="M16 52 q-2 -40 34 -40 q36 0 34 40 q0 -6 -6 -8 l0 26 q-4 -34 -28 -34 q-24 0 -28 34 l0 -26 q-6 2 -6 8 z" fill="${f.hair}"/>`
    : `<path d="M22 44 q0 -30 28 -30 q28 0 28 30 q-6 -14 -28 -14 q-22 0 -28 14 z" fill="${f.hair}"/>`
  const glasses = f.glasses
    ? `<g fill="none" stroke="#2a2a2a" stroke-width="2.4">
         <circle cx="39" cy="45" r="8"/><circle cx="61" cy="45" r="8"/>
         <line x1="47" y1="45" x2="53" y2="45"/></g>`
    : ''
  const stache = f.stache ? `<path d="M40 57 q10 7 20 0 q-10 3 -20 0z" fill="${f.hair}"/>` : ''
  return `<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <circle cx="50" cy="50" r="50" fill="${c}"/>
    <circle cx="50" cy="84" r="30" fill="${f.skin}"/>
    <circle cx="50" cy="46" r="28" fill="${f.skin}"/>
    ${hair}
    <circle cx="39" cy="45" r="2.6" fill="#2a2a2a"/>
    <circle cx="61" cy="45" r="2.6" fill="#2a2a2a"/>
    ${glasses}
    ${stache}
    ${mouthPath(f.mouth)}
  </svg>`
}

// Team-model balance check. Simulates a 5-player team under several strategies
// and prints the team verdict, so we can tune OUTPUT_FLOOR / BURNOUT_CAP.
//   node test/calibrate.mjs
import {
  ROLE_ORDER,
  evaluateRound,
  teamVerdict,
  OUTPUT_FLOOR,
  BURNOUT_CAP,
  dailyAllocatable,
} from '../game.js'

const MEET = 1.5 // Michael's daily meeting hours
const TARGET = 3 // deep-work target per day (per role)

// Build entries: every role uses the same per-day allocation [deep, admin, learn, rest].
function team(alloc) {
  const [d, a, l, r] = alloc
  return ROLE_ORDER.map((role) => ({
    role,
    schedule: { deep_work_hrs: d, admin_hrs: a, learning_hrs: l, rest_hrs: r },
    target_per_day: TARGET,
  }))
}

function run(label, round, alloc, prior = {}) {
  const sum = alloc.reduce((x, y) => x + y, 0)
  const { results, company } = evaluateRound(team(alloc), MEET, round, prior)
  const base = round === 2 ? prior._baseline : null
  const v = teamVerdict(company, round, base)
  const medals = results.filter((r) => r.medal).map((r) => r.role).join(',') || '—'
  console.log(
    `${label.padEnd(22)} R${round} alloc[d/a/l/r]=${alloc.join('/')} (=${sum}h, budget ${dailyAllocatable(MEET)}h)`
  )
  console.log(
    `   output=${company.company_output}  burnout=${company.team_burnout}  wellbeing=${company.team_wellbeing}` +
      `  ->  ${v.win ? 'WIN ' : 'LOSE'}  "${v.headline}"`
  )
  console.log(`   medals: ${medals}`)
  return { company, results }
}

console.log(`thresholds: OUTPUT_FLOOR=${OUTPUT_FLOOR}  BURNOUT_CAP=${BURNOUT_CAP}\n`)

console.log('=== ROUND 1 (40h, 5 days) — sets the baseline ===')
const r1balanced = run('R1 balanced', 1, [3, 1, 1, 1.5])
run('R1 grind', 1, [5, 1, 0, 0.5])
run('R1 slack', 1, [1, 1, 2, 2.5])

// Use the balanced R1 as the baseline the four-day week is judged against.
const priorBurnout = {}
for (const r of r1balanced.results) priorBurnout[r.role] = r.metrics.burnout
const baseline = {
  output: r1balanced.company.company_output,
  burnout: r1balanced.company.team_burnout,
  wellbeing: r1balanced.company.team_wellbeing,
}
const prior2 = { ...priorBurnout, _baseline: baseline }

console.log('\nbaseline from R1 balanced:', baseline)

console.log('\n=== ROUND 2 (32h, 4 days) — judged vs baseline ===')
run('R2 smart 4-day', 2, [3, 0.5, 1, 2], prior2)
run('R2 cram', 2, [5, 1, 0, 0.5], prior2)
run('R2 slack', 2, [1, 1, 2, 2.5], prior2)
run('R2 balanced-same', 2, [3, 1, 1, 1.5], prior2)

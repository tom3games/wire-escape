// 警察と犯人を CPU だけで何回も走らせ、結末（逮捕・逃げ切り・隠れ家）と時間を数える。
// node tools/sim-chase.mjs [回数] [警察の数]
import { createWorld } from '../public/shared/track.js'
import { Chase } from '../public/shared/chase.js'
import { GAME } from '../public/shared/config.js'
const N = Number(process.argv[2] || 8), COPS = Number(process.argv[3] || 3)
const tally = {}
for (let k = 0; k < N; k++) {
  const w = createWorld('city')
  const ch = new Chase(w, { seed: Number(process.env.SEED || 1000) + k * 77 })
  ch.addBots(1, 'robber'); ch.addBots(COPS, 'cop')
  let steps = 0, maxBust = 0, minD = 1e9, downs = 0, shots = 0, hits = 0, spk = 0, flats = 0
  const t0 = Date.now()
  while (ch.phase !== 'done' && steps < 60 * 240) {
    ch.stepFixed(GAME.step); steps++
    const r = ch.robbers[0]; maxBust = Math.max(maxBust, r.bust); minD = Math.min(minD, ch.nearestCopDist(r.car))
    for (const e of ch.entries) e.car.events.length = 0
    downs += ch.events.filter(e => e.t === 'copDown').length
    for (const e of ch.events) { if (e.t === 'shot') { shots++; if (e.hit.length) hits++ } if (e.t === 'spike') spk++; if (e.t === 'punctured') flats++ }
    ch.events.length = 0
  }
  const o = ch.outcome || { winner: '?', reason: 'timeout' }
  const key = o.winner + ':' + o.reason
  tally[key] = (tally[key] || 0) + 1
  const r = ch.robbers[0]
  console.log(`#${k} ${key} t=${o.t?.toFixed?.(1)} heat=${ch.heat} body=${Math.round(r.car.dmg.body * 100)}% maxBust=${maxBust.toFixed(2)} minCopDist=${minD.toFixed(1)} copDowns=${downs} shots=${shots} hits=${hits} spikes=${spk} flats=${flats} cpuMs/step=${((Date.now() - t0) / steps).toFixed(3)}`)
}
console.log(tally)

// ワイヤーの人（犯人）と CPU の警察を描画なしで戦わせ、勝ち負けの割合を見る
//   node tools/sim-runner.mjs [回数=12] [警察=5] [bot|still|ground]
import { createWorld } from '../public/shared/track.js'
import { Chase } from '../public/shared/chase.js'
import { setTrafficSpeed } from '../public/shared/traffic.js'
setTrafficSpeed(0.55)
const N = +(process.argv[2] || 12), COPS = +(process.argv[3] || 5), KIND = process.argv[4] || 'bot'
const world = createWorld('city')
const tally = {}
const cnt = {}
let stomps = 0, hits = 0, lost = 0, shots = 0, shotHits = 0, blasts = 0, wires = 0, downs = 0
const t0 = Date.now()
for (let k = 0; k < N; k++) {
  const ch = new Chase(world, { seed: 100 + k, footCops: true })
  if (KIND === 'bot') ch.addBots(1, 'robber', { runner: true })
  else ch.addHuman({ id: 'me', name: 'me', role: 'robber', runner: true })
  ch.addBots(COPS, 'cop')
  const me = ch.robbers[0]
  let steps = 0
  while (ch.phase !== 'done' && steps < 60 * 200) {
    const inp = KIND === 'ground' ? { me: { throttle: 1, steer: Math.sin(steps / 200) } } : {}
    ch.stepFixed(1 / 60, inp)
    for (const e of ch.entries) { for (const ev of e.car.events) { if (ev.t === 'stomp' && ev.cop) stomps++; if (ev.t === 'carhit' && e.car.isRunner) hits++; if (ev.t === 'wire') wires++; if (ev.t === 'wreck' && e.car.isRunner) downs++ } e.car.events.length = 0 }
    for (const ev of ch.events) { if (ev.t === 'lost') lost++; if (ev.t === 'shot') { shots++; if (ev.hit.length) shotHits++ } if (ev.t === 'blast' && ev.hit.length) blasts++; if (['netFire', 'netHit', 'pitWarn', 'pitFall', 'bust', 'scream', 'witness', 'tackle', 'witnessHeat'].includes(ev.t)) cnt[ev.t] = (cnt[ev.t] || 0) + 1 }
    ch.events.length = 0
    steps++
  }
  const o = ch.outcome || { winner: '?', reason: 'none' }
  const key = o.winner + ':' + o.reason
  tally[key] = (tally[key] || 0) + 1
  console.log(`#${k} ${key} ${Math.round(o.t || 0)}秒 体力${Math.round(me.car.dmg.body * 100)}% 手配度${ch.heat}`)
}
console.log(tally)
console.log(cnt)
console.log({ stomps, hits, downs, lost, wires, shots, shotHits, blasts, sec: ((Date.now() - t0) / 1000).toFixed(1) })

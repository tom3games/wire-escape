// ヘリのランチャーと修理工場を CPU だけで確かめる。node tools/sim-heli.mjs [回数]
// 手配度を3から始め（ヘリがすぐ出る）、撃った数・当たった数・避けた数、修理の回数を数える
import { createWorld } from '../public/shared/track.js'
import { Chase } from '../public/shared/chase.js'
import { GAME, CHASE } from '../public/shared/config.js'
const N = Number(process.argv[2] || 6)
let shots = 0, hits = 0, repairs = 0, minBody = 1, wrecksByMissile = 0
for (let k = 0; k < N; k++) {
  const ch = new Chase(createWorld('city'), { seed: 3000 + k * 31 })
  ch.addBots(1, 'robber'); ch.addBots(3, 'cop')
  ch.heatBonus = 2
  let s = 0
  while (ch.phase !== 'done' && s < 60 * 200) {
    ch.stepFixed(GAME.step); s++
    const rob = ch.robbers[0].car
    for (const ev of ch.events) {
      if (ev.t === 'strikeWarn') shots++
      if (ev.t === 'blast' && ev.hit.length) { hits++; minBody = Math.min(minBody, rob.dmg.body); if (rob.dmg.body <= 0) wrecksByMissile++ }
      if (ev.t === 'repaired') repairs++
    }
    for (const e of ch.entries) e.car.events.length = 0
    ch.events.length = 0
  }
  console.log(`#${k} ${ch.outcome?.winner}:${ch.outcome?.reason} t=${ch.outcome?.t.toFixed(0)} 撃った累計 ${shots} 当たった累計 ${hits} 修理累計 ${repairs}`)
}
console.log({ shots, hits, missed: shots - hits, hitRate: (hits / shots).toFixed(2), repairs, minBodyAfterHit: minBody.toFixed(2), wrecksByMissile, warn: CHASE.strikeWarn, damage: CHASE.strikeDamage })

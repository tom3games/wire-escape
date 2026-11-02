// CPU のワイヤーの人の速さの分布（ワイヤーを変えた前後で比べる）。node tools/speed-dist.mjs [回数=8]
import { createWorld } from '../public/shared/track.js'
import { Chase } from '../public/shared/chase.js'
import { setTrafficSpeed } from '../public/shared/traffic.js'
setTrafficSpeed(0.55)
const N = +(process.argv[2] || 8), world = createWorld('city')
const sp = [], air = []; let wires = 0, escapes = 0, secs = 0, ropeLen = []
for (let k = 0; k < N; k++) {
  const ch = new Chase(world, { seed: 100 + k, footCops: true })
  ch.addBots(1, 'robber', { runner: true }); ch.addBots(5, 'cop')
  const me = ch.robbers[0].car; let steps = 0
  while (ch.phase !== 'done' && steps < 60 * 200) {
    ch.stepFixed(1 / 60, {})
    const v = Math.hypot(me.vx, me.vz); sp.push(v); if (!me.grounded) air.push(v)
    if (me.rope && steps % 30 === 0) ropeLen.push(Math.hypot(me.rope.x - me.x, me.rope.y - me.y, me.rope.z - me.z))
    for (const e of ch.entries) { for (const ev of e.car.events) if (ev.t === 'wire' && e.car === me) wires++; e.car.events.length = 0 }
    ch.events.length = 0; steps++
  }
  secs += steps / 60; if (ch.outcome && ch.outcome.winner === 'robber') escapes++
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * p)] || 0 }
const f = a => `平均${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)} 中央${q(a, 0.5).toFixed(1)} 上位10%${q(a, 0.9).toFixed(1)} 最高${q(a, 0.999).toFixed(1)}`
console.log(`全体 m/s: ${f(sp)}`)
console.log(`空中 m/s: ${f(air)}（空中の割合 ${(air.length / sp.length * 100).toFixed(0)}%）`)
console.log(`ワイヤー ${(wires / secs * 60).toFixed(1)}回/分  掛けた距離 ${f(ropeLen)}  逃げ切り ${escapes}/${N}`)

// 犯人が全力で警察車に体当たりして、何回で大破するか（後ろから・横から）。警察が犯人に当てたときの自損も測る。
// node tools/ram-test.mjs
import { createWorld } from '../public/shared/track.js'
import { Chase } from '../public/shared/chase.js'
import { step, speedOf } from '../public/shared/physics.js'
import { GAME } from '../public/shared/config.js'
const w = createWorld('city')
function trial(kind, run = 34) {
  const ch = new Chase(w, { seed: 5 })
  ch.addBots(1, 'robber'); ch.addBots(1, 'cop')
  const rob = ch.robbers[0].car, cop = ch.cops[0].car
  // 長い直線: 交差点から隣の交差点
  const n = ch.nav.list.find(n => n.adj.some(a => { const b = ch.nav.nodes.get(a); return Math.hypot(b.x - n.x, b.z - n.z) > 120 }))
  const b = ch.nav.nodes.get(n.adj.find(a => { const b = ch.nav.nodes.get(a); return Math.hypot(b.x - n.x, b.z - n.z) > 120 }))
  const yaw = Math.atan2(b.x - n.x, b.z - n.z), fx = Math.sin(yaw), fz = Math.cos(yaw)
  let hits = 0, speeds = []
  for (let k = 0; k < 8; k++) {
    // 警察は直線の先 run m、犯人は手前から全速
    const place = (c, d, y, v) => { c.x = n.x + fx * d; c.z = n.z + fz * d; c.y = 0.6 + w.groundAt(c.x, c.z, 5).h; c.yaw = y; c.vx = Math.sin(y) * v; c.vz = Math.cos(y) * v; c.vy = 0; c.wreck = 0; c.freeze = 0; c.knock = false; c.pitch = c.roll = 0 }
    if (kind === 'rear') { place(cop, run + 40, yaw, 0); place(rob, 0, yaw, 44) }
    if (kind === 'side') { place(cop, run + 40, yaw + Math.PI / 2, 0); place(rob, 0, yaw, 44) }
    if (kind === 'copRams') { place(rob, run + 40, yaw, 0); place(cop, 0, yaw, 44) }
    let hitSpeed = 0
    for (let i = 0; i < 60 * 3; i++) {
      step(rob, kind === 'copRams' ? {} : { throttle: 1 }, GAME.step, w, [cop])
      step(cop, kind === 'copRams' ? { throttle: 1 } : {}, GAME.step, w, [rob])
      for (const ev of [...rob.events, ...cop.events]) if (ev.t === 'carhit') hitSpeed = Math.max(hitSpeed, ev.speed)
      rob.events.length = 0
      const wr = cop.events.some(e => e.t === 'wreck' && e.kind !== 'knock'); cop.events.length = 0
      if (wr) { hits++; speeds.push(hitSpeed.toFixed(0)); return { kind, hits, speeds, cop: 0, rob: Math.round(rob.dmg.body * 100) } }
    }
    hits++; speeds.push(hitSpeed.toFixed(0))
    if (kind === 'copRams' && hits >= 6) break
  }
  return { kind, hits: hits + (kind === 'copRams' ? '' : '+ (no wreck)'), speeds, cop: Math.round(cop.dmg.body * 100), rob: Math.round(rob.dmg.body * 100) }
}
for (const k of ['rear', 'side', 'copRams']) console.log(JSON.stringify(trial(k)))

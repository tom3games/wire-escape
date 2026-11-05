// 地面ワイヤーの数字: 25m/s までの秒・掛けている間の最高速・外れた後に上がる高さ・着地後の上向き
//   node tools/groundwire-num.mjs
import { createWorld } from '../public/shared/track.js?v=11'
import { createRunner, stepRunner, RUN } from '../public/shared/runner.js?v=11'
import { createNav } from '../public/shared/citynav.js?v=11'
const world = createWorld('city'), nav = createNav(world), dt = 1 / 60
const n = nav.list.find(n => n.i === 4 && n.j === 4)
const rows = []
for (const [y, vz, ahead] of [[16, 8, 25], [10, 10, 30], [6, 12, 22], [20, 6, 35]]) {
  const r = createRunner({ id: 'me', spawn: { x: n.x, z: n.z, yaw: 0, y } }); Object.assign(r, { y, vz, grounded: false })
  const pt = { x: r.x, y: world.groundAt(r.x, r.z + ahead, 0).h, z: r.z + ahead, ground: true }
  let t25 = null, vMax = 0, relY = null, relFloor = null, riseAfter = 0, landVy = 0, landed = false, maxStep = 0
  for (let i = 0; i < 4 * 60; i++) {
    const x0 = r.x, y0 = r.y, z0 = r.z
    stepRunner(r, { wire: i === 0, wireAt: i === 0 ? pt : null }, dt, world)
    if (r.rope) maxStep = Math.max(maxStep, Math.hypot(r.x - x0, r.y - y0, r.z - z0))   // 掛けている間（着地で床に吸いつく分は数えない）
    const v = Math.hypot(r.vx, r.vy, r.vz)
    if (r.rope) { vMax = Math.max(vMax, v); if (t25 == null && v >= 25) t25 = (i + 1) * dt }
    for (const e of r.events) if (e.t === 'unwire' && e.ground && relY == null) { relY = r.y; relFloor = r.groundY }
    if (relY != null) { riseAfter = Math.max(riseAfter, r.y - relY); if (r.grounded) { if (landed) landVy = Math.max(landVy, r.vy); landed = true } }
    r.events.length = 0
    if (landed && i > 30 && r.grounded && relY != null && r.vy <= 0 && (i * dt) > 2.5) break
  }
  rows.push({ start: `y${y} v${vz} 先${ahead}m`, t25: t25 && +t25.toFixed(2), vMax: +vMax.toFixed(1), relAbove: relY != null ? +(relY - relFloor).toFixed(1) : null, riseAfter: +riseAfter.toFixed(2), landVy: +landVy.toFixed(2), stepOK: maxStep <= RUN.maxSpeed * dt + 1e-6 })
}
console.table(rows)

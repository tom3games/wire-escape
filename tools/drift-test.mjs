// ドリフトの効き: 平らな地面で 30m/s（108km/h）から90度曲がる距離・最大の横滑り角・抜けてから直進に戻るまでの時間
// node tools/drift-test.mjs
import { createCar, step } from '../public/shared/physics.js'
import { GAME } from '../public/shared/config.js'
const flat = { groundAt: () => ({ h: 0, surf: null }), nearby: () => [], destroyed: new Set(), slabActive: () => true, breakObj() {}, pitRegen: false, inRepair: () => false, fallY: -100 }
const dt = GAME.step
function run(name, inp) {
  const c = createCar({ id: 't', name: 't', carId: 'runner', levels: {}, paint: 0, spawn: { x: 0, z: 0, yaw: 0, y: 0 } })
  c.freeze = 0
  for (let i = 0; i < 300; i++) { step(c, { throttle: 1 }, dt, flat); const v = Math.hypot(c.vx, c.vz); if (v > 30) break }
  const y0 = Math.atan2(c.vx, c.vz)
  let dist = 0, maxAng = 0, t = 0
  while (t < 8) {
    step(c, inp, dt, flat); t += dt; dist += Math.hypot(c.vx, c.vz) * dt
    const vh = Math.atan2(c.vx, c.vz)
    let a = Math.abs(vh - c.yaw); while (a > Math.PI) a = Math.abs(a - 2 * Math.PI)
    maxAng = Math.max(maxAng, a)
    let turned = Math.abs(vh - y0); while (turned > Math.PI) turned = Math.abs(turned - 2 * Math.PI)
    if (turned >= Math.PI / 2) break
  }
  const vExit = Math.hypot(c.vx, c.vz)
  // 手を離してアクセルだけ: 横滑り角が3度未満になるまで
  let rec = 0
  for (; rec < 5; rec += dt) {
    step(c, { throttle: 1 }, dt, flat)
    let a = Math.abs(Math.atan2(c.vx, c.vz) - c.yaw); while (a > Math.PI) a = Math.abs(a - 2 * Math.PI)
    if (a < 3 * Math.PI / 180) break
  }
  console.log(`${name.padEnd(10)} 90度: ${dist.toFixed(1)}m ${t.toFixed(2)}s 出口 ${(vExit * 3.6).toFixed(0)}km/h  最大横滑り角 ${(maxAng * 180 / Math.PI).toFixed(0)}度  立て直し ${rec.toFixed(2)}s`)
}
run('ハンドル', { throttle: 1, steer: 1 })
run('ブレーキ', { brake: 1, steer: 1 })
run('ドリフト', { throttle: 1, steer: 1, handbrake: true })

// 描画なしでコースを走らせる検証。ルートごとの所要時間、橋のジャンプの成否、加速と最高速を測る。
// 使い方: node tools/sim.mjs            （全部）
//         node tools/sim.mjs routes     （ルート比較だけ）
import { createWorld } from '../public/shared/track.js'
import { createCar, step, speedOf } from '../public/shared/physics.js'
import { createDriver, drive, planRoute } from '../public/shared/ai.js'
import { crossedGate, gateAt, totalGates } from '../public/shared/track.js'
import { GAME } from '../public/shared/config.js'
import { mulberry } from '../public/shared/race.js'

const DT = GAME.step
const world = createWorld(process.env.STAGE || 'touge')
import { pathToFileURL } from 'node:url'
const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
const what = direct ? (process.argv[2] || 'all') : 'none'

export function runRoute(force, { carId = 'runner', levels = {}, maxT = 600, seed = 1, log = false } = {}) {
  world.reset()
  const car = createCar({ id: 'p', carId, levels, spawn: world.grid[0] })
  const plan = planRoute(world, mulberry(seed), 0.5, force)
  const dr = createDriver(world, car, plan, 1)
  let cp = 0, t = 0, px = car.x, pz = car.z
  const splits = [], ev = { falls: 0, wrecks: 0, breaks: 0, respawns: 0, hits: 0, lands: [] }
  while (t < maxT && cp < totalGates(world)) {
    const inp = drive(dr, world)
    step(car, inp, DT, world)
    t += DT
    for (const e of car.events) {
      if (e.t === 'fall') ev.falls++
      if (e.t === 'wreck') ev.wrecks++
      if (e.t === 'break') ev.breaks++
      if (e.t === 'respawn') ev.respawns++
      if (e.t === 'hit') ev.hits++
      if (e.t === 'land' && e.air > 0.5) ev.lands.push(`${e.air.toFixed(1)}s/${e.impact.toFixed(0)}`)
      if (log && e.t !== 'land' && e.t !== 'takeoff' && e.t !== 'scrape') console.log(t.toFixed(1), e.t, JSON.stringify(e).slice(0, 120), car.x.toFixed(0), car.z.toFixed(0))
    }
    car.events.length = 0
    const g = gateAt(world, cp)
    if (crossedGate(g, px, pz, car.x, car.z) >= 0) { cp++; car.respawnPoint = { ...g.respawn }; splits.push(t) }
    px = car.x; pz = car.z
  }
  return { t, done: cp >= totalGates(world), splits, ev, body: car.dmg, picks: plan.picks, car }
}

function fmt(r) {
  const s = r.splits.map((x, i) => (i ? x - r.splits[i - 1] : x).toFixed(1)).join(' / ')
  const d = Object.entries(r.body).map(([k, v]) => `${k[0]}${Math.round(v * 100)}`).join(' ')
  return `${r.done ? 'GOAL' : 'DNF '} ${r.t.toFixed(1)}s  区間[${s}]  落下${r.ev.falls} 大破${r.ev.wrecks} 復帰${r.ev.respawns} 破壊${r.ev.breaks} 衝突${r.ev.hits} 着地[${r.ev.lands.join(' ')}]  ${d}`
}

if (what === 'all' || what === 'accel') {
  world.reset()
  for (const carId of ['runner', 'bruiser', 'dart']) for (const boost of [false, true]) {
    const c = createCar({ id: 'a', carId, spawn: { x: 0, z: 640, yaw: -Math.PI / 2 } })
    let t = 0, t100 = null
    while (t < 7) { step(c, { throttle: 1, boost: boost && t > 0 }, DT, world); t += DT; if (!t100 && speedOf(c) * 3.6 >= 100) t100 = t }
    console.log(`${carId} ${boost ? 'ブーストあり' : 'ブーストなし'}: 0-100km/h ${t100?.toFixed(2)}s  7秒後 ${(speedOf(c) * 3.6).toFixed(0)}km/h`)
  }
}

if (what === 'all' || what === 'routes') {
  const base = ['A', 'A', 'A', 'A', 'A', 'A']
  console.log('全部 A:', fmt(runRoute(base)))
  const alt = [['B', 'D'], ['B', 'C'], ['D', 'E'], ['D', 'BE'], ['D']]
  alt.forEach((opts, si) => opts.forEach(o => {
    const f = [...base]; f[si] = o
    console.log(`区間${si + 1}=${o}:`, fmt(runRoute(f)))
  }))
}

if (what === 'all' || what === 'bridge') {
  // 崩れた橋: ブーストなし／ありで手前から全開で入る
  for (const boost of [false, true]) {
    world.reset()
    const c = createCar({ id: 'b', spawn: { x: 0, z: 560, yaw: 0 } })
    let t = 0, out = 'timeout'
    while (t < 20) {
      step(c, { throttle: 1, boost: boost && c.z > 600 }, DT, world); t += DT
      for (const e of c.events) {
        if (e.t === 'fall') out = `落下 (z=${c.z.toFixed(0)})`
        if (e.t === 'land' && e.air > 0.6 && out === 'timeout') out = `着地 z=${c.z.toFixed(0)} 滞空${e.air.toFixed(2)}s 衝撃${e.impact.toFixed(1)} 車体${Math.round(c.dmg.body * 100)}%`
      }
      c.events.length = 0
      if (out !== 'timeout') break
    }
    console.log(`崩れた橋 ${boost ? 'ブーストあり' : 'ブーストなし'}: ${out}`)
  }
}

if (what === 'log') console.log(fmt(runRoute(process.argv.slice(3, 9), { log: true })))

// 物理・コース・レース判定の単体テスト（描画なし）
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld, crossedGate, normalizeGates } from '../public/shared/track.js'
import { createCar, step, speedOf } from '../public/shared/physics.js'
import { Race } from '../public/shared/race.js'
import { buildStats, GAME } from '../public/shared/config.js'
import { runRoute } from '../tools/sim.mjs'

const DT = GAME.step

function hitWallAt(speed, opts = {}) {
  // 西の大通り沿いの建物（x -106 の壁）へ真横から当てる
  const w = createWorld()
  const c = createCar({ id: 't', spawn: { x: -96, z: 200, yaw: Math.PI / 2 }, ...opts }) // 西向き... yaw +90° は +x 向き
  c.yaw = -Math.PI / 2 // -x（西）向き
  c.vx = -speed
  for (let i = 0; i < 60 && !c.events.some(e => e.t === 'hit'); i++) step(c, {}, DT, w)
  return c
}

test('軽い接触と高速の激突でダメージが大きく違う', () => {
  const slow = hitWallAt(7), fast = hitWallAt(35)
  assert.ok(slow.events.some(e => e.t === 'hit' || e.t === 'scrape') || slow.vx > -7, '遅い方も実際に壁に当たっている')
  assert.ok(fast.events.some(e => e.t === 'hit'), '速い方は衝突イベントが出ている')
  assert.ok(Math.abs(slow.vx) < 7, `遅い方も跳ね返っている vx=${slow.vx}`)
  const lossSlow = 1 - slow.dmg.body, lossFast = 1 - fast.dmg.body
  assert.ok(lossSlow < 0.03, `7m/s の損傷 ${lossSlow}`)
  // 2026-10-26 耐久を約3倍に（本人「耐久値上げて」）。それでも速い衝突ははっきり傷む
  assert.ok(lossFast > 0.05 && lossFast > lossSlow * 5, `35m/s の損傷 ${lossFast}`)
})

test('正面衝突はエンジンと冷却を傷める', () => {
  const c = hitWallAt(28)
  assert.ok(c.dmg.engine < 0.98 && c.dmg.cool < 0.98 && c.dmg.susp === 1, JSON.stringify(c.dmg))
})

test('損傷で最高速が落ちる', () => {
  const w = createWorld()
  const top = dmg => {
    const c = createCar({ id: 'a', spawn: { x: 0, z: 640, yaw: -Math.PI / 2 } })
    c.dmg.engine = dmg
    for (let i = 0; i < 60 * 7; i++) step(c, { throttle: 1 }, DT, w)
    return speedOf(c)
  }
  const healthy = top(1), broken = top(0.2)
  assert.ok(broken < healthy * 0.8, `${healthy} -> ${broken}`)
})

test('崩れた橋: ブーストなしでは届かず、ありなら越えられる', () => {
  const w = createWorld()
  const run = boost => {
    w.reset()
    const c = createCar({ id: 'b', spawn: { x: 0, z: 560, yaw: 0 } })
    for (let i = 0; i < 60 * 12; i++) {
      step(c, { throttle: 1, boost: boost && c.z > 600 }, DT, w)
      if (c.events.some(e => e.t === 'fall' || e.t === 'wreck')) return 'fail'
      c.events.length = 0
      if (c.z > 800) return 'ok'
    }
    return 'timeout'
  }
  assert.equal(run(false), 'fail')
  assert.equal(run(true), 'ok')
})

test('壊せる壁は遅いと止められ、速いと突き抜けて道が開く', () => {
  const w = createWorld()
  const wall = w.objects.find(o => o.type === 'wall')
  const go = speed => {
    w.reset()
    const c = createCar({ id: 'w', spawn: { x: 0, z: wall.cz - 8, yaw: 0 } })
    c.vz = speed
    for (let i = 0; i < 60; i++) step(c, {}, DT, w)
    return { broken: w.destroyed.has(wall.id), z: c.z }
  }
  const slow = go(15), fast = go(40)
  assert.equal(slow.broken, false)
  assert.ok(slow.z < wall.cz, '遅いと壁の手前で止まる')
  assert.equal(fast.broken, true)
  assert.ok(fast.z > wall.cz + 2, '速いと壁の向こうへ抜ける')
})

test('鉄塔を倒すと、倒れ切ってから板の橋が渡れるようになる', () => {
  const w = createWorld()
  const tower = w.objects.find(o => o.type === 'tower')
  const plank = w.slabs.find(s => s.kind === 'plank')
  assert.equal(w.slabActive(plank), false)
  w.time = 10
  w.breakObj(tower.id)
  assert.equal(w.slabActive(plank), false, '倒れている途中は渡れない')
  w.time = 12
  assert.equal(w.slabActive(plank), true)
  assert.ok(w.groundAt(59.6, 470, 9).h > 7.5, '切れ目の上に足場がある')
})

test('改造は何かが上がると何かが下がる', () => {
  const base = buildStats('runner', {})
  const eng = buildStats('runner', { engine: 3 })
  assert.ok(eng.maxSpeed > base.maxSpeed && eng.grip < base.grip && eng.heat > base.heat)
  const arm = buildStats('runner', { armor: 3 })
  assert.ok(arm.durability > base.durability && arm.accel < base.accel)
  const lite = buildStats('runner', { weight: 3 })
  assert.ok(lite.accel > base.accel && lite.durability < base.durability)
  // 範囲外の段数は丸める
  assert.deepEqual(buildStats('runner', { engine: 99 }), buildStats('runner', { engine: 3 }))
})

test('ゲートは南から北へ横切ったときだけ数える', () => {
  const [g] = normalizeGates([{ z: 100, x0: -10, x1: 10, respawn: { x: 0, z: 101 } }])
  assert.ok(crossedGate(g, 0, 99, 0, 101) >= 0)
  assert.equal(crossedGate(g, 0, 101, 0, 99), -1)
  assert.equal(crossedGate(g, 30, 99, 30, 101), -1)
})

test('チェックポイントは順番どおりでないと進まない（ゴールへ直行しても勝てない）', () => {
  const w = createWorld()
  const r = new Race(w)
  r.addHuman({ id: 'h', name: 'h' })
  r.t = 1; r.phase = 'racing'
  const e = r.entry('h')
  // いきなりゴールの線を横切る
  e.px = 0; e.pz = 1160
  r.observe(e, 0, 1180)
  assert.equal(e.cp, 0)
  assert.equal(e.finished, false)
})

test('どのルートでも完走できる（CPU 運転）', () => {
  const combos = [['A', 'A', 'A', 'A', 'A', 'A'], ['B', 'B', 'D', 'D', 'D', 'A'], ['D', 'C', 'E', 'BE', 'A', 'A']]
  for (const f of combos) {
    const r = runRoute(f)
    assert.ok(r.done, `${f.join('')} が完走しない ${r.t}`)
    assert.ok(r.t < 240, `${f.join('')} が遅すぎる ${r.t}`)
  }
})

test('固定ステップなので、画面のフレームレートが違っても同じ距離を走る', () => {
  const w = createWorld()
  const run = hz => {
    const c = createCar({ id: 'f', spawn: { x: 0, z: 640, yaw: -Math.PI / 2 } })
    let acc = 0
    for (let f = 0; f < 4 * hz; f++) { acc += 1 / hz; while (acc >= DT) { step(c, { throttle: 1 }, DT, w); acc -= DT } }
    return c.x
  }
  const a = run(30), b = run(60), c = run(120)
  assert.ok(Math.max(a, b, c) - Math.min(a, b, c) < 1.5, `${a} ${b} ${c}`)
})

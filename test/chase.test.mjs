// 警察と犯人の判定の単体テスト（描画なし）
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorld } from '../public/shared/track.js'
import { Chase } from '../public/shared/chase.js'
import { createNav } from '../public/shared/citynav.js'
import { createCar, step, speedOf } from '../public/shared/physics.js'
import { createTraffic } from '../public/shared/traffic.js'
import { CHASE, GAME } from '../public/shared/config.js'

const DT = GAME.step
const city = () => createWorld('city')
const run = (ch, sec, inputs = {}) => { for (let i = 0; i < sec * 60 && ch.phase !== 'done'; i++) { ch.stepFixed(DT, inputs); for (const e of ch.entries) e.car.events.length = 0 } }
function chase({ cops = 1, seed = 5 } = {}) {
  const ch = new Chase(city(), { seed })
  const rob = ch.addHuman({ id: 'r', name: 'R', role: 'robber' })
  const copCars = []
  for (let i = 0; i < cops; i++) copCars.push(ch.addHuman({ id: 'c' + i, name: 'C' + i, role: 'cop' }))
  return { ch, rob, copCars }
}

test('道の網: 99の交差点がつながり、運河は橋のある通りでしか渡れない', () => {
  const w = city(), nav = createNav(w)
  assert.equal(nav.list.length, 99)
  const { canal, bridges } = w.nav
  for (const n of nav.list) for (const id of n.adj) {
    const m = nav.nodes.get(id)
    const cross = (n.z < canal.z0) !== (m.z < canal.z0)
    if (cross) assert.ok(bridges.includes(n.x) && n.x === m.x, `運河を橋のない所で渡っている x=${n.x}`)
  }
  const p = nav.path(nav.nearest(-500, 40), nav.nearest(500, 1400))
  assert.ok(p.length > 5 && p[p.length - 1].x > 400)
})

test('スタート: 警察は犯人から 220〜420m 離れた別々の交差点', () => {
  const { ch, rob } = chase({ cops: 4 })
  const seen = new Set()
  for (const e of ch.cops) {
    const d = Math.hypot(e.car.x - rob.x, e.car.z - rob.z)
    assert.ok(d >= CHASE.copSpawnMin - 1 && d <= CHASE.copSpawnMax + 1, `距離 ${d}`)
    const k = `${e.car.x},${e.car.z}`
    assert.ok(!seen.has(k), '同じ場所に2台')
    seen.add(k)
  }
  assert.ok(Math.hypot(ch.hideout.x - rob.x, ch.hideout.z - rob.z) > 650, '隠れ家は遠く')
})

test('逮捕: 犯人のすぐそばで犯人が止まっていると約2.4秒で逮捕。離れるとゲージは減る', () => {
  const { ch, rob, copCars } = chase()
  run(ch, GAME.countdownSec + 0.1)
  const cop = copCars[0]
  // 警察を犯人の横に置く（止まったまま）
  const park = () => { cop.x = rob.x + 5; cop.z = rob.z; cop.vx = cop.vz = 0; rob.vx = rob.vz = 0 }
  park(); run(ch, 1.0, {})
  const r = ch.entry('r')
  assert.ok(r.bust > 0.3 && r.bust < 0.6, `1秒でゲージ ${r.bust}`)
  // 離れる
  cop.x = rob.x + 80; run(ch, 0.5, {})
  const after = r.bust
  assert.ok(after < 0.42, `離れたら減る ${after}`)
  park(); run(ch, 3, {})
  assert.equal(r.arrested, true)
  assert.equal(ch.phase, 'done')
  assert.equal(ch.outcome.winner, 'cop')
  assert.equal(ch.outcome.reason, 'bust')
  const res = ch.results()
  assert.equal(res.find(x => x.id === 'c0').won, true)
  assert.equal(res.find(x => x.id === 'r').arrested, true)
})

test('速く（時速108km）走っている犯人は、警察がくっついていても逮捕ゲージがたまらない', () => {
  const { ch, rob, copCars } = chase()
  run(ch, GAME.countdownSec + 0.1)
  for (let i = 0; i < 60; i++) { copCars[0].x = rob.x + 4; copCars[0].z = rob.z; rob.vx = Math.sin(rob.yaw) * 30; rob.vz = Math.cos(rob.yaw) * 30; ch.judge(DT) }
  assert.equal(ch.entry('r').bust, 0)
})

test('犯人の車が警察の近くで大破すると逮捕。遠くなら戻って続く', () => {
  const near = chase()
  run(near.ch, GAME.countdownSec + 0.1)
  near.copCars[0].x = near.rob.x + 20; near.copCars[0].z = near.rob.z
  near.rob.events.push({ t: 'wreck', kind: 'wall' })
  near.ch.afterStep(near.ch.entry('r'))
  assert.equal(near.ch.outcome.reason, 'wreck')
  const far = chase()
  run(far.ch, GAME.countdownSec + 0.1)
  far.rob.events.push({ t: 'wreck', kind: 'wall' })
  far.ch.afterStep(far.ch.entry('r'))
  assert.equal(far.ch.phase, 'racing')
})

test('時間切れまで逃げ切れば犯人の勝ち', () => {
  const ch = new Chase(city(), { seed: 9, timeLimit: 8 })
  ch.addHuman({ id: 'r', name: 'R', role: 'robber' })
  ch.addHuman({ id: 'c', name: 'C', role: 'cop' })
  run(ch, GAME.countdownSec + 9)
  assert.equal(ch.outcome.winner, 'robber')
  assert.equal(ch.outcome.reason, 'time')
})

test('隠れ家: 開く前と、警察に見られているときは入れない。開いた後に見られずに入れば勝ち', () => {
  const { ch, rob, copCars } = chase()
  run(ch, GAME.countdownSec + 0.1)
  const into = () => { rob.x = ch.hideout.x; rob.z = ch.hideout.z; rob.vx = rob.vz = 0; ch.judge(DT) }
  into()
  assert.equal(ch.phase, 'racing', '開く前は入れない')
  rob.x += 300 // いったん離れてから開くのを待つ
  ch.t = CHASE.hideoutOpenAt + 0.5; ch.stepFixed(DT, {})
  assert.equal(ch.hideout.open, true)
  copCars[0].x = ch.hideout.x + 10; copCars[0].z = ch.hideout.z
  into()
  assert.equal(ch.phase, 'racing', '警察が近いと入れない')
  copCars[0].x = ch.hideout.x + 200
  into()
  assert.equal(ch.outcome.winner, 'robber')
  assert.equal(ch.outcome.reason, 'hideout')
})

test('手配度は時間で上がり、犯人が警察を大破させるとさらに上がる（最大5）', () => {
  const { ch, rob, copCars } = chase()
  run(ch, GAME.countdownSec + CHASE.heatEvery + 0.5, {})
  assert.equal(ch.heat, 2)
  copCars[0].lastHitBy = 'r'; copCars[0].lastHitAt = copCars[0].t
  copCars[0].events.push({ t: 'wreck', kind: 'car' })
  ch.afterStep(ch.entry('c0'))
  copCars[0].events.length = 0
  ch.stepFixed(DT, {})
  assert.equal(ch.heat, 3)
  assert.equal(ch.entry('r').takedowns, 1)
})

test('CPU だけで何回か遊ぶと、逮捕と逃げ切りの両方が起きる', () => {
  const outcomes = new Set()
  for (let k = 0; k < 8 && outcomes.size < 2; k++) {
    const ch = new Chase(city(), { seed: 1000 + k * 77 })
    ch.addBots(1, 'robber'); ch.addBots(3, 'cop')
    run(ch, 200)
    assert.equal(ch.phase, 'done', `seed ${k}: 3分で決着がつく`)
    outcomes.add(ch.outcome.winner)
  }
  assert.deepEqual([...outcomes].sort(), ['cop', 'robber'])
})

test('車は丈夫: 時速100kmで壁に当てても車体の傷みは15%未満', () => {
  const w = city()
  // 西の外周の建物へ真横から
  const c = createCar({ id: 't', spawn: { x: w.nav.XS[0] + 8, z: w.nav.ZS[3], yaw: -Math.PI / 2 } })
  c.vx = -28
  for (let i = 0; i < 90 && !c.events.some(e => e.t === 'hit'); i++) step(c, {}, DT, w)
  assert.ok(c.events.some(e => e.t === 'hit'), '当たっている')
  assert.ok(1 - c.dmg.body < 0.15, `傷み ${1 - c.dmg.body}`)
})

test('一般車は軽い: 同じ速さで後ろから押してもどかせて、こちらはほとんど止まらない', () => {
  const w = city()
  const tr = createTraffic(w)
  tr.update(10, DT)
  const t0 = tr.cars[0]
  const c = createCar({ id: 'p', spawn: { x: t0.x - Math.sin(t0.yaw) * 4.6, z: t0.z - Math.cos(t0.yaw) * 4.6, yaw: t0.yaw } })
  c.vx = t0.vx; c.vz = t0.vz
  const v0 = speedOf(c)
  let knocked = false
  for (let i = 0; i < 60; i++) {
    tr.update(10 + i * DT, DT)
    step(c, { throttle: 1 }, DT, w, [c, ...tr.cars.filter(x => x.knocked <= 0)])
    if (tr.hitBy(c)) knocked = true
  }
  assert.ok(knocked, '一般車がどいた')
  assert.ok(speedOf(c) > v0 * 0.9, `こちらの速さ ${v0} -> ${speedOf(c)}`)
})

test('一般車は遠いと高さの計算を省く（近くだけ正確）', () => {
  const w = city()
  const tr = createTraffic(w)
  tr.update(5, DT, [[0, 200]])
  const far = tr.cars.filter(c => c.far).length, near = tr.cars.filter(c => !c.far).length
  assert.ok(far > near && near > 0, `遠い ${far} / 近い ${near}`)
})

test('修理工場: 中で3秒止まると全回復し、40秒は使えない。犯人は警察に見られていると直せず、直すと手配度が下がる', () => {
  const { ch, rob, copCars } = chase()
  run(ch, GAME.countdownSec + 0.1)
  const shop = ch.shops[0]
  const park = () => { rob.x = shop.x; rob.z = shop.z; rob.vx = rob.vz = 0 }
  rob.dmg.body = 0.3; rob.dmg.engine = 0.4
  // 警察を道の上、修理工場から 25m 先に置く（建物の中に置くと押し出されて動く）
  copCars[0].x = shop.x; copCars[0].z = shop.z + 25
  park(); run(ch, 4)
  assert.equal(rob.dmg.body, 0.3, '警察が25mにいると直らない')
  assert.equal(ch.entry('r').repSeen, true)
  copCars[0].z = shop.z + 300
  ch.heatBonus = 1; run(ch, 0.1) // 手配度2（ヘリはまだ出ない）
  const heat0 = ch.heat
  park(); run(ch, CHASE.repairSec - 0.4)
  assert.ok(rob.dmg.body < 1, '3秒たつまでは直らない')
  park(); run(ch, 0.6)
  assert.equal(rob.dmg.body, 1); assert.equal(rob.dmg.engine, 1)
  assert.equal(ch.heat, heat0 - 1, '手配度が1下がる')
  assert.equal(ch.entry('r').lastSeen, null, '警察は見失う')
  rob.dmg.body = 0.5
  park(); run(ch, 5)
  assert.equal(rob.dmg.body, 0.5, '使ったあとはしばらく使えない')
  assert.ok(ch.entry('r').repairCd > 30)
})

test('警察ヘリ: 手配度3で現れ、赤い円で予告してから1.8秒後に着弾。当たると吹き飛んで傷むが大破しない。避ければ無傷', async () => {
  const { ch, rob, copCars } = chase()
  run(ch, GAME.countdownSec + 0.1)
  copCars[0].x = rob.x + 400
  ch.heatBonus = 2
  let warn = null
  for (let i = 0; i < 60 * 12 && !warn; i++) { ch.stepFixed(DT, {}); warn = ch.events.find(e => e.t === 'strikeWarn'); ch.events.length = 0; rob.events.length = 0 }
  assert.ok(warn, 'ヘリが撃った')
  assert.equal(ch.heli.active, true)
  // 当たる: 予告の円の真ん中で止まって待つ
  rob.x = warn.x; rob.z = warn.z; rob.vx = rob.vz = 0
  const t0 = ch.t
  let blastEv = null
  for (let i = 0; i < 60 * 3 && !blastEv; i++) { rob.x = warn.x; rob.z = warn.z; ch.stepFixed(DT, {}); blastEv = ch.events.find(e => e.t === 'blast'); ch.events.length = 0; rob.events.length = 0 }
  assert.ok(Math.abs(ch.t - t0 - CHASE.strikeWarn) < 0.1, `予告から着弾まで ${ch.t - t0}秒`)
  assert.deepEqual(blastEv.hit, ['r'])
  assert.ok(rob.dmg.body < 0.8 && rob.dmg.body >= 0.08, `傷む ${rob.dmg.body}`)
  assert.ok(rob.vy > 3, '吹き飛ぶ')
  // 何発当たっても大破しない
  for (let k = 0; k < 6; k++) { const e = ch.entry('r'); rob.y = 0.55; rob.vy = 0; const s = { x: rob.x, z: rob.z, r: CHASE.strikeRadius } ; ch.events.length = 0; (await import('../public/shared/chase.js')).blast(rob, s) }
  assert.ok(rob.dmg.body >= 0.08 && rob.wreck === 0, '大破しない')
  // 避ける: 次の予告の円から 20m 離れる
  let w2 = null
  for (let i = 0; i < 60 * 8 && !w2; i++) { ch.stepFixed(DT, {}); w2 = ch.events.find(e => e.t === 'strikeWarn'); ch.events.length = 0; rob.events.length = 0 }
  rob.dmg.body = 1
  let b2 = null
  for (let i = 0; i < 60 * 3 && !b2; i++) { rob.x = w2.x + 20; rob.z = w2.z; rob.vx = rob.vz = 0; ch.stepFixed(DT, {}); b2 = ch.events.find(e => e.t === 'blast'); ch.events.length = 0; rob.events.length = 0 }
  assert.deepEqual(b2.hit, [], '避けたら当たらない')
  assert.equal(rob.dmg.body, 1)
})

test('警察車: 犯人の全力の体当たり2〜3回で大破し、その場で燃えて数秒残ってから犯人から離れた交差点へ戻る。手配度が上がる', () => {
  const { ch, rob, copCars } = chase()
  run(ch, GAME.countdownSec + 0.1)
  const cop = copCars[0], ce = ch.entry('c0')
  // 長い直線（交差点から120m以上先の交差点へ）
  const n = ch.nav.list.find(n => n.adj.some(a => { const b = ch.nav.nodes.get(a); return Math.hypot(b.x - n.x, b.z - n.z) > 120 }))
  const b = ch.nav.nodes.get(n.adj.find(a => { const b = ch.nav.nodes.get(a); return Math.hypot(b.x - n.x, b.z - n.z) > 120 }))
  const yaw = Math.atan2(b.x - n.x, b.z - n.z), fx = Math.sin(yaw), fz = Math.cos(yaw)
  const place = (c, d, v) => { c.x = n.x + fx * d; c.z = n.z + fz * d; c.y = 0.6 + ch.world.groundAt(c.x, c.z, 5).h; c.yaw = yaw; c.vx = fx * v; c.vz = fz * v; c.vy = 0; c.wreck = 0; c.freeze = 0; c.knock = false; c.pitch = c.roll = 0 }
  const heat0 = ch.heatBonus
  let rams = 0, down = null
  for (; rams < 6 && !down; rams++) {
    place(cop, 70, 0); place(rob, 0, 44)
    for (let i = 0; i < 120 && !down; i++) {
      ch.stepFixed(DT, { r: { throttle: 1 }, c0: {} })
      down = ch.events.find(e => e.t === 'copDown')
      ch.events.length = 0
      for (const e of ch.entries) e.car.events.length = 0
    }
  }
  assert.ok(down, '大破しない')
  assert.ok(rams >= 2 && rams <= 3, `体当たり ${rams} 回`)
  assert.ok(ch.heatBonus > heat0, '手配度が上がらない')
  assert.ok(ch.entry('r').takedowns >= 1)
  // 数秒その場に残る
  const x0 = cop.x, z0 = cop.z
  rob.x += 300; run(ch, CHASE.copWreckSec - 1, { r: {}, c0: {} })
  assert.ok(cop.wreck > 0 && Math.hypot(cop.x - x0, cop.z - z0) < 15, '早く戻りすぎ')
  run(ch, 2.5, { r: {}, c0: {} })
  assert.equal(cop.wreck, 0)
  const d = Math.hypot(cop.x - rob.x, cop.z - rob.z)
  assert.ok(d >= CHASE.copBackMin - 5, `犯人から ${d.toFixed(0)}m に戻った`)
  assert.ok(cop.dmg.body > 0.5, '直って戻る')
  // 警察が犯人に当てても自分は壊れにくい（6回で大破しない）
  assert.ok(ce)
})

test('結果の車体は決着した瞬間の値（大破で逮捕されたあと復帰で直っても 0% のまま）', () => {
  const { ch, rob, copCars } = chase()
  run(ch, GAME.countdownSec + 0.1)
  copCars[0].x = rob.x + 20; copCars[0].z = rob.z
  rob.dmg.body = 0
  ch.arrest(ch.entry('r'), 'wreck', 'c0')
  rob.dmg.body = 1 // 復帰で直った
  run(ch, 1, {})
  const r = ch.results().find(x => x.id === 'r')
  assert.equal(r.body, 0)
})

test('拳銃: 手配度1では撃たず、2から CPU の警察が近くの犯人を撃つ。建物の陰には当たらず、弾だけでは大破しない', () => {
  const ch = new Chase(city(), { seed: 5, backup: false })
  const rob = ch.addHuman({ id: 'r', name: 'R', role: 'robber' })
  ch.addBots(1, 'cop')
  const cop = ch.cops[0].car
  run(ch, GAME.countdownSec + 3.2)
  // 開けた道の上: 犯人の 25m 後ろに警察を置き続ける
  const hold = (dx, dz) => { rob.vx = rob.vz = 0; cop.x = rob.x + dx; cop.z = rob.z + dz; cop.y = rob.y; cop.vx = cop.vz = 0 }
  const shotsFor = (sec, dx, dz) => {
    const out = []
    for (let i = 0; i < sec * 60; i++) { hold(dx, dz); ch.stepFixed(DT, {}); out.push(...ch.events.filter(e => e.t === 'shot')); ch.events.length = 0; rob.events.length = 0; cop.events.length = 0; ch.robbers[0].bust = 0 }
    return out
  }
  const open = [[25, 0], [-25, 0], [0, 25], [0, -25]].find(([dx, dz]) => ch.clearShot(rob.x + dx, rob.z + dz, rob.x, rob.z))
  assert.ok(open, '開けた向きがある')
  assert.equal(ch.heat, 1)
  assert.equal(shotsFor(4, ...open).length, 0, '手配度1では撃たない')
  ch.heatBonus = 1
  rob.dmg.body = 1
  const shots = shotsFor(6, ...open)
  assert.equal(ch.heat, 2)
  assert.ok(shots.length >= 3, `撃つ ${shots.length}`)
  assert.ok(shots.some(s => s.hit.includes('r')), '当たる弾がある')
  assert.ok(rob.dmg.body < 1, '当たると傷む')
  // 何発当たっても大破しない
  ch.heatBonus = 4
  shotsFor(60, ...open)
  assert.ok(rob.dmg.body >= CHASE.gunFloor - 1e-9 && !(rob.wreck > 0), `大破しない ${rob.dmg.body}`)
  // 建物の向こう: 撃たない
  const wall = ch.walls.find(w => w.hw > 10 && w.hl > 10 && !w.yaw)
  assert.ok(wall, '建物がある')
  assert.equal(ch.clearShot(wall.cx - wall.hw - 5, wall.cz, wall.cx + wall.hw + 5, wall.cz), false, '建物が弾を遮る')
  assert.equal(ch.clearShot(wall.cx - wall.hw - 5, wall.cz - wall.hl - 5, wall.cx + wall.hw + 5, wall.cz - wall.hl - 5), true, '建物の外側は通る')
  // 遠い（射程の外）と撃たない
  assert.equal(shotsFor(4, open[0] * 4, open[1] * 4).length, 0, '射程の外では撃たない')
})

test('スパイクベルト: 手配度4から犯人の行く手の道に敷き、踏むとパンク（遅く滑る）。空いた側は通れる。警察は踏んでも平気。修理で直る', async () => {
  const { puncture } = await import('../public/shared/chase.js')
  const { ch, rob, copCars } = chase()
  run(ch, GAME.countdownSec + 0.1)
  for (const c of copCars) { c.x = rob.x + 500; c.z = rob.z }
  // 長くまっすぐな道の上を走らせる
  const sg = ch.world.segs.filter(s => s.surf === 'road').sort((a, b) => Math.hypot(b.bx - b.ax, b.bz - b.az) - Math.hypot(a.bx - a.ax, a.bz - a.az))[0]
  const L = Math.hypot(sg.bx - sg.ax, sg.bz - sg.az), ux = (sg.bx - sg.ax) / L, uz = (sg.bz - sg.az) / L
  const put = u => { rob.x = sg.ax + ux * u; rob.z = sg.az + uz * u; rob.vx = ux * 30; rob.vz = uz * 30; rob.yaw = Math.atan2(ux, uz) }
  const spikesFor = (sec, u) => { const out = []; for (let i = 0; i < sec * 60; i++) { put(u); ch.stepFixed(DT, {}); out.push(...ch.events.filter(e => e.t === 'spike')); ch.events.length = 0; rob.events.length = 0 } return out }
  ch.heatBonus = 2 // 手配度3
  assert.equal(spikesFor(3, 40).length, 0, '手配度3では敷かない')
  ch.heatBonus = 3 // 手配度4
  const sp = spikesFor(3, 40)[0]
  assert.ok(sp, '手配度4で敷く')
  const d = Math.hypot(sp.x - rob.x, sp.z - rob.z)
  assert.ok(d >= CHASE.spikeAheadMin * 0.8 && d < 140, `行く手に置く ${d.toFixed(1)}m`)
  // 道の上（真ん中の線から道幅の内側）
  const along = (sp.x - sg.ax) * ux + (sp.z - sg.az) * uz
  const off = Math.abs((sp.x - sg.ax) * -uz + (sp.z - sg.az) * ux)
  assert.ok(along > 0 && along < L && off < sg.hw, `道の上 off=${off.toFixed(1)} hw=${sg.hw}`)
  // 踏む: スパイクの真ん中に置く
  const hit = () => { ch.stepFixed(DT, {}); const e = ch.events.find(e => e.t === 'punctured'); ch.events.length = 0; rob.events.length = 0; return e }
  rob.x = sp.x; rob.z = sp.z; rob.vx = ux * 20; rob.vz = uz * 20
  assert.ok(hit(), 'パンクする')
  assert.equal(rob.flat, true)
  assert.ok(rob.dmg.tires <= 0.15)
  // 同じ帯で2回は数えない
  rob.x = sp.x; rob.z = sp.z
  assert.equal(hit(), undefined)
  // パンクすると最高速が落ちる
  const top = flat => { const c = createCar({ id: 't', name: 'T', spawn: { x: sg.ax + ux * 60, z: sg.az + uz * 60, yaw: Math.atan2(ux, uz), y: 0 } }); if (flat) puncture(c); for (let i = 0; i < 60 * 8; i++) step(c, { throttle: 1 }, DT, ch.world, []); return speedOf(c) }
  const v0 = top(false), v1 = top(true)
  assert.ok(v1 < v0 * 0.85, `パンクで遅い ${v0.toFixed(1)} → ${v1.toFixed(1)}`)
  // 空いた側を通れば踏まない（帯の端から道の反対側へ 1.5m 外）
  ch.spikeHits.clear(); rob.flat = false; rob.dmg.tires = 1
  const s2 = ch.spikes[0]
  const tx = Math.sin(s2.yaw), tz = Math.cos(s2.yaw)
  const toCenter = Math.sign((sg.ax + ux * along - s2.x) * tx + (sg.az + uz * along - s2.z) * tz) || 1
  rob.x = s2.x + tx * toCenter * (s2.len / 2 + 2.5); rob.z = s2.z + tz * toCenter * (s2.len / 2 + 2.5)
  assert.equal(hit(), undefined, '空いた側は通れる')
  // 警察の車は踏んでもパンクしない
  const cc = copCars[0]; cc.x = s2.x; cc.z = s2.z
  ch.stepFixed(DT, {}); ch.events.length = 0
  assert.ok(!cc.flat, '警察はパンクしない')
  // 修理で直る
  rob.flat = true
  ch.completeRepair(ch.entry('r'))
  assert.equal(rob.flat, false)
})

test('応援のパトカー: 手配度が上がるたびに犯人から離れた所に足される（上限まで）。止めれば増えない', () => {
  const ch = new Chase(city(), { seed: 7 })
  const rob = ch.addHuman({ id: 'r', name: 'R', role: 'robber' })
  ch.addBots(3, 'cop')
  run(ch, GAME.countdownSec + 1)
  assert.equal(ch.cops.length, 3)
  const added = []
  const watch = sec => { for (let i = 0; i < sec * 60; i++) { rob.vx = rob.vz = 0; ch.stepFixed(DT, {}); added.push(...ch.events.filter(e => e.t === 'backup')); ch.events.length = 0; for (const e of ch.entries) e.car.events.length = 0; ch.robbers[0].bust = 0 } }
  for (const c of ch.cops) { c.car.x = rob.x + 600; c.car.z = rob.z }
  ch.heatBonus = 2; watch(1) // 手配度3
  assert.equal(ch.cops.length, 3 + CHASE.backup[3])
  ch.heatBonus = 4; watch(1) // 手配度5
  assert.equal(ch.cops.length, 3 + CHASE.backup[5])
  assert.equal(added.length, CHASE.backup[5])
  for (const ev of added) {
    const c = ch.entry(ev.id).car
    const d = Math.hypot(c.x - rob.x, c.z - rob.z)
    assert.ok(d >= CHASE.copBackMin - 30, `犯人の近くには出ない ${d.toFixed(0)}m`)
  }
  // 上限
  const big = new Chase(city(), { seed: 7 })
  big.addHuman({ id: 'r', name: 'R', role: 'robber' }); big.addBots(CHASE.maxCpuStart, 'cop')
  run(big, GAME.countdownSec + 1); big.heatBonus = 4; run(big, 1)
  assert.ok(big.cops.length <= CHASE.maxCops, `上限 ${big.cops.length}`)
  // backup: false なら増えない（オンライン）
  const off = new Chase(city(), { seed: 7, backup: false })
  off.addHuman({ id: 'r', name: 'R', role: 'robber' }); off.addBots(3, 'cop')
  run(off, GAME.countdownSec + 1); off.heatBonus = 4; run(off, 1)
  assert.equal(off.cops.length, 3)
})

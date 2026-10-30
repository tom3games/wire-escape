// オンラインの警察と犯人（サーバー側）。権威の分け方:
//   自分の車の動き   … その人の画面が計算して送る（操作の遅れを出さないため）。サーバーは速さと瞬間移動を検査する
//   役（犯人・警察）  … サーバーがランダムに決める（犯人1人、6人以上なら2人。残りは警察、空きは CPU の警察）
//   逮捕・逃げ切り・隠れ家・手配度 … サーバーが、受け取った位置と速さで決める
//   壊れた物          … 画面からの申告をサーバーが距離と速さで検査し、通ったものだけ全員に配る
//   CPU の車          … サーバーが shared/ の物理で動かす
import { GAME, PHYS, CARS, clampLevel, PAINTS } from '../public/shared/config.js'
import { createWorld } from '../public/shared/track.js'
import { Chase, mulberry } from '../public/shared/chase.js'
import { CHASE } from '../public/shared/config.js'
import { packCar } from '../public/shared/physics.js'

export const meta = { id: 'break-the-route', title: 'BREAK THE ROUTE', minPlayers: 1, maxPlayers: GAME.maxPlayers, tickHz: 30 }

const SNAP_MS = 1000 / GAME.snapHz

// 画面から届いた車の設定を検査して使える形にする（改造の購入履歴はサーバーに無いので段数の範囲だけ守る）
export function cleanCar(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const carId = CARS[r.carId] ? r.carId : 'runner'
  const levels = {}
  for (const k of ['engine', 'turbo', 'tires', 'suspension', 'armor', 'weight']) levels[k] = clampLevel(r.levels?.[k])
  const paint = PAINTS.includes(r.paint) ? r.paint : CARS[carId].color
  return { carId, levels, paint }
}

const num = v => typeof v === 'number' && Number.isFinite(v)
const SOLID = new Set(['building', 'whouse', 'wall', 'bound', 'pylon', 'sidewall', 'container', 'pillar'])

// 前回の位置から今回の位置までに、壊れない建物の中を通っていないか（壁抜けの検査）
export function passesThroughWall(world, x0, y0, z0, x1, y1, z1) {
  const L = Math.hypot(x1 - x0, z1 - z0)
  const n = Math.max(1, Math.ceil(L / 1.5))
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = y0 + (y1 - y0) * t
    for (const o of world.nearby(x, z)) {
      if (!SOLID.has(o.kind) || y + 0.5 < o.y0 || y - 0.3 > o.y1) continue
      const cs = Math.cos(o.yaw || 0), sn = Math.sin(o.yaw || 0)
      const dx = x - o.cx, dz = z - o.cz
      const u = dx * cs - dz * sn, v = dx * sn + dz * cs
      // 0.6m の余裕を持たせる（ぶつかって少しめり込むのは正常）
      if (Math.abs(u) < o.hw - 0.6 && Math.abs(v) < o.hl - 0.6) return true
    }
  }
  return false
}

export function createGame(players, opts = {}) {
  const world = createWorld('city')
  const seed = ((opts.round || 1) * 7919 + players.length * 31 + Math.floor(Math.random() * 1e6)) >>> 0
  // 検証用に制限時間だけ環境変数で短くできる（画面からは変えられない）
  const timeLimit = Number(process.env.BTR_CHASE_LIMIT) > 0 ? Number(process.env.BTR_CHASE_LIMIT) : CHASE.timeLimit
  const race = new Chase(world, { seed, timeLimit, backup: false }) // 応援はオフラインだけ（途中で増える車を画面へ配る仕組みがない）
  // 役: 犯人はランダムで1人（6人以上なら2人）
  const rng = mulberry(seed ^ 0x5bd1e995)
  const order = players.map(p => p.id)
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  const robbers = new Set(order.slice(0, players.length >= 6 ? 2 : 1))
  for (const role of ['robber', 'cop']) for (const p of players) {
    if ((robbers.has(p.id) ? 'robber' : 'cop') !== role) continue
    const car = race.addHuman({ id: p.id, name: p.name, ...cleanCar(p.car), remote: true, role })
    const e = race.entry(p.id)
    e.connected = true
    e.lastOk = { x: car.x, y: car.y, z: car.z, at: 0 }
    e.allowTo = null
    e.strikes = 0
    e.wasWreck = false
  }
  const cpu = Math.max(0, Math.min(GAME.maxPlayers - players.length, Math.round(Number(opts.cpu) || 0)))
  race.addBots(cpu, 'cop')

  let snapAcc = 0, acc = 0, now = 0
  const newBreaks = []     // 次のスナップショットで配る壊れた物
  const corrections = []   // { id, state } 位置を戻させる
  const unbreaks = []      // { id, objId } 申告を却下した
  let dirty = true

  // CPU が壊した物も配る
  const collectBotBreaks = () => {
    for (const e of race.entries) if (e.bot) {
      for (const ev of e.car.events) if (ev.t === 'break') newBreaks.push({ id: ev.id, by: e.id, dx: ev.dx, dz: ev.dz })
      e.car.events.length = 0
    }
  }

  function input(id, msg) {
    const e = race.entry(id)
    if (!e || e.left || !msg || typeof msg !== 'object') return { error: 'bad_input' }
    if (msg.k === 'state') return onState(e, msg)
    if (msg.k === 'break') return onBreak(e, msg)
    if (msg.k === 'respawn') return onRespawn(e, msg)
    return { error: 'unknown_input' }
  }

  function onRespawn(e, m) {
    // 復帰先: 画面が言う「少し前に走っていた道の上」。最後に受け付けた位置から 150m 以内だけ認める。無ければスタート位置
    const g = e.spawn
    let to = { x: g.x, z: g.z }
    if (m && num(m.x) && num(m.z) && Math.hypot(m.x - e.lastOk.x, m.z - e.lastOk.z) < 150) to = { x: m.x, z: m.z }
    // 大破した警察車は離れた交差点へ戻る（道の交差点の上なら距離を問わない）
    else if (m && num(m.x) && num(m.z) && e.role === 'cop' && race.nav.list.some(n => Math.hypot(n.x - m.x, n.z - m.z) < 1.5)) to = { x: m.x, z: m.z }
    e.allowTo = { x: to.x, z: to.z, until: now + 3 }
    e.car.respawnPoint = { ...g }
    return { ok: true }
  }

  function onState(e, m) {
    const s = m.s
    if (!s || !['x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'pitch', 'roll'].every(k => num(s[k]))) return { error: 'bad_state' }
    const c = e.car
    const last = e.lastOk
    const dt = Math.max(0.03, now - last.at)
    const dist = Math.hypot(s.x - last.x, s.z - last.z)
    let ok = true
    if (race.phase === 'countdown') {
      const slot = e.spawn
      if (Math.hypot(s.x - slot.x, s.z - slot.z) > 3) ok = false
    } else if (dist > PHYS.maxPlausibleSpeed * (dt + 0.25) + 4) {
      // 速すぎる移動。ただしリスポーン先への移動は許す
      if (e.allowTo && now < e.allowTo.until && Math.hypot(s.x - e.allowTo.x, s.z - e.allowTo.z) < 12) { e.allowTo = null; e.px = s.x; e.pz = s.z; e.justRespawned = true }
      else ok = false
    }
    if (Math.hypot(s.vx, s.vz) > PHYS.maxPlausibleSpeed) ok = false
    if (ok && !e.justRespawned && passesThroughWall(world, last.x, last.y, last.z, s.x, s.y, s.z)) ok = false
    if (!ok) {
      e.strikes++
      corrections.push({ id: e.id, state: { x: last.x, y: last.y, z: last.z, yaw: c.yaw } })
      return { error: 'rejected' }
    }
    // 受け付け
    Object.assign(c, { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, yaw: s.yaw, pitch: s.pitch, roll: s.roll })
    c.boosting = !!s.b; c.grounded = !!s.g; c.wreck = s.w ? 1 : 0; c.knock = !!s.k
    if (Array.isArray(s.d) && s.d.length === 5 && s.d.every(num)) {
      ;['body', 'engine', 'tires', 'susp', 'cool'].forEach((k, i) => { c.dmg[k] = Math.max(0, Math.min(1, s.d[i])) })
    }
    if (num(s.br)) c.breaks = Math.max(c.breaks, Math.min(999, s.br | 0))
    if (num(s.air)) c.maxAir = Math.max(c.maxAir, Math.min(20, s.air))
    e.lastOk = { x: s.x, y: s.y, z: s.z, at: now }
    e.justRespawned = false
    race.observe(e, s.x, s.z)
    // 犯人の車が大破した瞬間、近くに警察がいれば逮捕
    // 体当たりでスピンしただけ（ノックダウン）は大破ではない
    const wreck = !!s.w && !s.k
    if (e.role === 'robber' && wreck && !e.wasWreck && race.phase === 'racing' && race.nearestCopDist(c) < CHASE.wreckBustDist) { race.arrest(e, 'wreck', race.nearestCopId(c)); dirty = true }
    if (e.role === 'cop' && wreck && !e.wasWreck && race.phase === 'racing') { race.remoteCopDown(e); dirty = true }
    e.wasWreck = wreck
    return { ok: true }
  }

  function onBreak(e, m) {
    const o = world.objectById.get(m.id)
    if (!o) return { error: 'no_object' }
    if (world.destroyed.has(o.id)) return { ok: true }
    const c = e.car
    const reach = Math.max(o.hw, o.hl) + PHYS.carRadius + 6 + Math.hypot(c.vx, c.vz) * 0.25
    const near = Math.hypot(c.x - o.cx, c.z - o.cz) <= reach
    const sp = num(m.sp) ? m.sp : 0
    const carSpeed = Math.hypot(c.vx, c.vz)
    const strongEnough = sp * c.stats.mass * 1.15 >= o.def.breakAt * 0.85 && sp <= carSpeed + 12
    if (race.phase !== 'racing' || !near || !strongEnough) {
      unbreaks.push({ id: e.id, objId: o.id })
      return { error: 'break_rejected' }
    }
    world.breakObj(o.id)
    newBreaks.push({ id: o.id, by: e.id, dx: num(m.dx) ? m.dx : 0, dz: num(m.dz) ? m.dz : 0 })
    return { ok: true }
  }

  function tick(dt) {
    now += dt
    acc += dt
    let n = 0
    const phase0 = race.phase
    while (acc >= GAME.step && n < 8) {
      race.stepFixed(GAME.step)
      collectBotBreaks()
      acc -= GAME.step
      n++
    }
    if (race.phase !== phase0) dirty = true
    snapAcc += dt * 1000
  }

  // 20Hz で配る差分。サーバーのループが takeSnapshot を呼ぶ
  function takeSnapshot() {
    if (snapAcc < SNAP_MS) return null
    snapAcc = 0
    const snap = {
      t: 'snap', rt: Math.round(race.t * 1000) / 1000, phase: race.phase,
      cars: race.entries.map(e => ({ ...packCar(e.car), l: e.left ? 1 : 0, c: e.connected === false ? 0 : 1 })),
      br: newBreaks.splice(0),
      ch: race.summary()
    }
    return snap
  }

  // 人ごとに送る分（位置の巻き戻し・申告の却下）
  function privateFor(id) {
    const out = []
    for (let i = corrections.length - 1; i >= 0; i--) if (corrections[i].id === id) out.push({ t: 'correct', s: corrections.splice(i, 1)[0].state })
    for (let i = unbreaks.length - 1; i >= 0; i--) if (unbreaks[i].id === id) out.push({ t: 'unbreak', id: unbreaks.splice(i, 1)[0].objId })
    return out
  }

  return {
    race, world, input, tick, takeSnapshot, privateFor,
    get dirty() { const d = dirty; dirty = false; return d },
    setConnected(id, on) { const e = race.entry(id); if (e) { e.connected = on; dirty = true } },
    removePlayer(id) { race.removePlayer(id); dirty = true; race.checkOver() },
    isOver: () => race.phase === 'done',
    result: () => ({ list: race.results(), outcome: race.outcome }),
    // 部屋の状態に載せる分（入室・再接続した人が全体を復元できる量）
    view(viewerId) {
      const me = race.entry(viewerId)
      return {
        phase: race.phase, rt: race.t, stage: world.stage, seed, timeLimit, hideout: race.hideout, chase: race.summary(),
        entries: race.entries.map((e, i) => ({ id: e.id, name: e.car.name, bot: e.bot, role: e.role, spawn: e.spawn, carId: e.car.carId, paint: e.car.paint ?? null, levels: e.car.levels, slot: i, left: e.left })),
        destroyed: [...world.destroyed].map(id => [id, world.destroyedAt.get(id)]),
        you: me ? { x: me.lastOk?.x ?? me.car.x, y: me.lastOk?.y ?? me.car.y, z: me.lastOk?.z ?? me.car.z, yaw: me.car.yaw, dmg: me.car.dmg, respawn: me.car.respawnPoint } : null
      }
    }
  }
}

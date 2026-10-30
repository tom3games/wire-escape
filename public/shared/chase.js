// 警察と犯人（2026-10-26 本人「レースではなく警察と犯人に。警察は捕まえたら勝ち」）。
// オフラインではブラウザが、オンラインではサーバーがこれを持つ。どちらも同じ判定になる。
//
// 勝ち負け
//   警察: 犯人を逮捕したら勝ち。逮捕は「犯人のすぐそば（10m）に警察がいて、犯人が遅い（時速40km未満。2台以上に
//         囲まれていれば時速72km未満）」状態が合わせて約2秒（逮捕ゲージ。離れるとゆっくり減る）か、
//         犯人の車が大破したとき近く（45m）に警察がいたとき
//   犯人: 制限時間（3分）を逃げ切るか、90秒後に開く隠れ家に入れば勝ち（警察に見られていない＝30m 以内にいないとき）
// 手配度（1〜5）は時間と、犯人が警察の車を大破させるたびに上がる。上がるほど警察の CPU が速く、無線の目撃情報が増え、
// 3 からはヘリが犯人を照らし（警察の地図にずっと出る）、ランチャーを撃ってくる（赤い円で予告してから着弾）。
// 手配度2からは、警察の CPU が拳銃を撃ってくる（近く・建物の陰でないときだけ。弾だけでは大破しない）。
// 手配度4からは、犯人の行く手の道にスパイクベルトを敷く（踏むとパンクして遅く・滑りやすくなる。修理工場で直る）。
// 修理工場（街に4か所）: 中で3秒止まると全回復。犯人は警察に見られていると直せず、直すと手配度が1下がり警察は見失う

import { GAME, CHASE, REWARD } from './config.js'
import { createCar, step, respawn, speedOf } from './physics.js'
import { createDriver, drive, densify } from './ai.js'
import { createTraffic } from './traffic.js'
import { createNav, areaName, headingName } from './citynav.js'
import { createRunner, stepRunner, hitByCar, blocked, down as runnerDown, RUN } from './runner.js'
import { runnerBot } from './runnerbot.js'
import { createPeds, PED } from './peds.js'
import { copRunnerBot } from './copbot.js'

export const COP_NAMES = ['タツミ巡査', 'ミサキ巡査', 'ガンテツ警部', 'ヒバナ巡査', 'ROOK', 'VEGA', 'BOLT']
export const ROBBER_NAMES = ['ナイトフォックス', 'カラス', 'ゴースト']
const COP_CARS = ['runner', 'bruiser', 'runner', 'runner', 'bruiser', 'runner', 'runner']
export const COP_PAINT = 0xf2f2f2
export const ROBBER_PAINT = 0x2b2b30

export function mulberry(seed) {
  let a = seed >>> 0
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}

export class Chase {
  constructor(world, { seed = 1, timeLimit = CHASE.timeLimit, backup = true, footCops = false } = {}) {
    this.footCops = footCops // 警察が走る人（WIRE ESCAPE）。false なら元の車
    this.world = world
    world.reset()
    this.mode = 'chase'
    this.rng = mulberry(seed)
    this.nav = createNav(world)
    this.entries = []
    this.t = -GAME.countdownSec
    this.phase = 'countdown'      // countdown | racing | done（画面との約束で「racing」を追跡中の意味で使う）
    this.timeLimit = timeLimit
    this.events = []
    this.outcome = null           // { winner: 'cop'|'robber', reason, by }
    this.heat = 1
    this.heatBonus = 0
    this.nextPing = 1.5 // 最初の通報はすぐ
    this.pingUntil = -1
    this.traffic = world.trafficLoops ? createTraffic(world) : null
    // 犯人のスタート地点と隠れ家（毎回変わる）
    const L = this.nav.list
    const inner = L.filter(n => n.i >= 2 && n.i <= 6 && n.j >= 2 && n.j <= 8)
    this.robberStart = inner[Math.floor(this.rng() * inner.length)]
    const far = L.filter(n => Math.hypot(n.x - this.robberStart.x, n.z - this.robberStart.z) > 650 && (n.i === 0 || n.i === 8 || n.j === 0 || n.j === 10))
    const hn = far[Math.floor(this.rng() * far.length)] || L[0]
    this.hideout = { x: hn.x, z: hn.z, node: hn.id, open: false, area: areaName(world, hn.x, hn.z) }
    this.copSlots = 0
    // 修理工場（物理の「ピットで少しずつ直る」は使わず、ここで判定する）
    world.pitRegen = false
    this.shops = (world.repair || []).map((r, i) => ({ id: i, x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1 }))
    this.heatDrop = 0
    // 警察ヘリ
    this.heli = { active: false, x: 0, z: 0, y: CHASE.heliAlt, nextShot: 0, target: null }
    this.strikes = []   // { id, x, z, at, r, from: [x,y,z] } 予告中と、着弾から少しの間
    this.downs = []     // { id, x, z, at } 大破した警察車（オンラインで他の画面へ伝える用）
    this.blasts = []    // { id, x, z, at, hit: [ids] } 着弾（画面の演出と、オンラインで犯人の画面へ伝える用）
    this.strikeSeq = 0
    // 拳銃（手配度2から）。弾を遮る壁＝背の高い建物
    this.shots = []     // { id, by, fx, fz, tx, tz, at, hit: [ids] }
    this.shotSeq = 0
    // スパイクベルト（手配度4から）
    this.spikes = []    // { id, x, z, yaw, len, at, until }
    this.spikeSeq = 0
    this.spikeHits = new Set() // 'スパイクの id:車の id'（1本につき1台1回）
    this.nextSpike = 0
    // 捕獲ネットと落とし穴（人の犯人だけ）
    this.nets = []      // { id, by, x, y, z, vx, vy, vz, at, done }
    this.netSeq = 0
    this.nextNet = 0
    this.pits = []      // { id, x, y, z, r, open, until }
    this.pitSeq = 0
    this.nextPit = 0
    this.backupOn = backup
    this.backupCount = 0
    this.walls = (world.colliders || []).filter(b => !b.slab && b.y1 != null && b.y1 - b.y0 > 3)
  }

  get robbers() { return this.entries.filter(e => e.role === 'robber') }
  get cops() { return this.entries.filter(e => e.role === 'cop') }
  entry(id) { return this.entries.find(e => e.id === id) }
  cars() { return this.entries.map(e => e.car) }

  // スタート位置: 犯人は街の中ほど、警察は犯人から 220〜420m 離れた交差点（別々）
  spawnFor(role) {
    const s = this.robberStart
    const yawOf = n => {
      const nb = this.nav.nodes.get(n.adj[Math.floor(this.rng() * n.adj.length)])
      return Math.atan2(nb.x - n.x, nb.z - n.z)
    }
    if (role === 'robber') {
      const k = this.robbers.length
      const n = k === 0 ? s : this.nav.nodes.get(s.adj[0])
      return { x: n.x + (k ? 6 : 0), z: n.z, yaw: yawOf(n), y: 0 }
    }
    const used = new Set(this.cops.map(e => e.spawnNode))
    const [dMin, dMax] = this.footCops ? [CHASE.footSpawnMin, CHASE.footSpawnMax] : [CHASE.copSpawnMin, CHASE.copSpawnMax]
    const cand = this.nav.list.filter(n => { const d = Math.hypot(n.x - s.x, n.z - s.z); return d >= dMin && d <= dMax && !used.has(n.id) })
    const n = cand.length ? cand[Math.floor(this.rng() * cand.length)] : this.nav.list[(this.copSlots * 7) % this.nav.list.length]
    this.copSlots++
    // 犯人のいる方を向く
    return { x: n.x, z: n.z, yaw: Math.atan2(s.x - n.x, s.z - n.z), y: 0, node: n.id }
  }

  copDown(e, by) {
    const d = { id: e.id, x: Math.round(e.car.x), z: Math.round(e.car.z), at: Math.round(this.t * 100) / 100, by: by ? by.id : null }
    this.downs.push(d)
    this.events.push({ t: 'copDown', ...d })
  }

  // オンライン: 人の警察車が大破したと届いた（サーバーは人の車を動かさないので、ここで数える）。犯人がそばにいれば犯人のせい
  remoteCopDown(e) {
    const r = this.robbers.find(r => !r.left && Math.hypot(r.car.x - e.car.x, r.car.z - e.car.z) < 15)
    if (r) { r.takedowns++; this.heatBonus = Math.min(4, this.heatBonus + 1) }
    this.copDown(e, r)
  }

  copBackPoint(c) {
    const r = this.robbers[0] ? this.robbers[0].car : c
    const cand = this.nav.list.filter(n => { const d = Math.hypot(n.x - r.x, n.z - r.z); return d >= CHASE.copBackMin && d <= CHASE.copBackMax })
    const n = cand.length ? cand[Math.floor(this.rng() * cand.length)] : this.nav.nearest(c.x, c.z)
    return { x: n.x, z: n.z, yaw: Math.atan2(r.x - n.x, r.z - n.z), y: 0 }
  }

  // humans: [{ id, name, carId, levels, paint, remote, role }]。remote=true の車はここで動かさない（通信で位置が来る）
  addHuman(p) {
    const role = p.role === 'cop' ? 'cop' : 'robber'
    const spawn = this.spawnFor(role)
    // runner: true の犯人はワイヤーで飛ぶ人（runner.js。この画面のオフライン）。それ以外（元のテスト・オンラインのサーバー）は車のまま
    const car = role === 'robber' && p.runner === true
      ? createRunner({ id: p.id, name: p.name, spawn, paint: p.paint ?? null })
      : createCar({ id: p.id, name: p.name, carId: p.carId, levels: p.levels, paint: role === 'cop' ? COP_PAINT : (p.paint ?? ROBBER_PAINT), spawn })
    car.role = role
    car.remote = !!p.remote
    if (role === 'cop') copCar(car)
    const e = { id: p.id, car, bot: false, remote: !!p.remote, role, spawn, spawnNode: spawn.node, left: false, bust: 0, arrested: false, escaped: false, takedowns: 0, px: car.x, pz: car.z, cp: 0, finished: false }
    this.entries.push(e)
    return car
  }

  addBots(n, role = 'cop', { runner = false } = {}) {
    for (let i = 0; i < n && this.entries.length < CHASE.maxCops + 2; i++) {
      const k = this.entries.filter(e => e.bot).length
      const id = 'bot' + k
      const spawn = this.spawnFor(role)
      const carId = role === 'cop' ? COP_CARS[k % COP_CARS.length] : 'runner'
      const name = role === 'cop' ? COP_NAMES[k % COP_NAMES.length] : ROBBER_NAMES[this.robbers.length % ROBBER_NAMES.length]
      // 警察の CPU はエンジンを上げてある（追いつけるように）。犯人の CPU は素の車
      const levels = role === 'cop' ? { engine: 2 + (k % 2), armor: 1 } : { engine: 1 }
      const car = (role === 'robber' && runner) || (role === 'cop' && this.footCops)
        ? createRunner({ id, name, spawn, bot: true })
        : createCar({ id, name, carId, levels, paint: role === 'cop' ? COP_PAINT : ROBBER_PAINT, spawn, bot: true })
      car.role = role
      if (role === 'cop' && !car.isRunner) copCar(car)
      if (car.isRunner && role === 'cop') car.police = true
      const plan = { pts: densify([[spawn.x, spawn.z], [spawn.x + Math.sin(spawn.yaw) * 30, spawn.z + Math.cos(spawn.yaw) * 30]], 6), picks: [], boostZones: [] }
      const driver = createDriver(this.world, car, plan, role === 'cop' ? 0.9 + this.rng() * 0.1 : 0.8 + this.rng() * 0.12)
      driver.safe = plan
      driver.lead = (k % 3) * 1.4     // 先回りの度合い（秒）
      driver.replan = 0
      this.entries.push({ id, car, bot: true, remote: false, driver, role, spawn, spawnNode: spawn.node, left: false, bust: 0, arrested: false, escaped: false, takedowns: 0, px: car.x, pz: car.z, cp: 0, finished: false })
    }
  }

  // 警察の CPU が知っている犯人の位置（近い・無線の直後・ヘリが照らしている → 本当の位置、それ以外 → 最後の目撃）
  knownRobber(cop, rob) {
    const c = cop.car, r = rob.car
    const d = Math.hypot(r.x - c.x, r.z - c.z)
    if (r.isRunner) {
      // 人: 近い（160m・見失い中は 60m）・無線と通報の直後・ヘリが照らしている・手配度4以上 のときだけ本当の位置を知る
      // それ以外は最後の目撃から探す（隠密が効く）
      const hidden = rob.hiddenUntil > this.t
      if (d < (hidden ? 60 : 160) || this.t < this.pingUntil || this.heli.active || (this.heat >= 4 && !hidden)) return { x: r.x, z: r.z, vx: r.vx, vz: r.vz, live: true }
    } else if (d < 260 || this.t < this.pingUntil || this.heat >= 2) return { x: r.x, z: r.z, vx: r.vx, vz: r.vz, live: true }
    // 見失っている: 最後の目撃から、向かっていた方へ進んだはずの場所（最大8秒ぶん）を探しに行く
    const s = rob.lastSeen
    if (!s) return { x: r.x, z: r.z, vx: 0, vz: 0, live: false }
    const k = Math.min(8, this.t - s.at)
    return { x: s.x + s.vx * k, z: s.z + s.vz * k, vx: s.vx, vz: s.vz, live: false }
  }

  // 隠れ家の見張り: 隠れ家が開いたら、警察の CPU が3台以上いれば1台（隠れ家に一番近い）が先回りして張り込む
  guardId() {
    if (!this.hideout.open) return null
    const bots = this.cops.filter(o => o.bot && !o.left)
    if (bots.length < 3) return null
    if (!this._guard || !this.entry(this._guard)) {
      let best = null, bd = 1e18
      for (const o of bots) { const d = Math.hypot(o.car.x - this.hideout.x, o.car.z - this.hideout.z); if (d < bd) { bd = d; best = o.id } }
      this._guard = best
    }
    return this._guard
  }

  planCop(e) {
    const dr = e.driver, c = e.car
    if (this.guardId() === e.id) {
      const h = this.hideout
      const path = this.nav.path(this.nav.entry(c.x, c.z, c.yaw), this.nav.nodes.get(h.node))
      this.setPlan(dr, [[c.x, c.z], ...path.map(n => [n.x, n.z]), [h.x, h.z]])
      return
    }
    const rob = this.nearestRobber(c)
    if (!rob) return
    const k = this.knownRobber(e, rob)
    if (!k) return
    // 遠いときは先回り（犯人の行き先へ）、近いときは犯人そのものに当てに行く
    const dNow = Math.hypot(k.x - c.x, k.z - c.z)
    const lead = k.live ? (dNow < 45 ? 0.15 : dr.lead) : 0
    let tx = k.x + k.vx * lead, tz = k.z + k.vz * lead
    // 人が屋上や建物の上にいるときは、その下の一番近い道へ向かう（建物に突っ込まない）
    if (rob.car.isRunner && !c.isRunner) { const q = this.roadPoint(tx, tz); tx = q.x; tz = q.z }
    const d = Math.hypot(tx - c.x, tz - c.z)
    // 運河の向こう側へは、まっすぐ向かわない（橋のない通りは運河で行き止まり）
    const cn = this.world.nav.canal
    const sameSide = (c.z < cn.z0) === (tz < cn.z0)
    let pts
    if (d < 75 && sameSide) pts = [[c.x, c.z], [tx, tz], [tx + k.vx * 1.5, tz + k.vz * 1.5]]
    else {
      const path = this.nav.path(this.nav.entry(c.x, c.z, c.yaw), this.nav.nearest(tx, tz))
      pts = [[c.x, c.z], ...path.map(n => [n.x, n.z]), [tx, tz]]
    }
    this.setPlan(dr, pts)
  }

  planRobber(e) {
    const dr = e.driver, c = e.car
    const cops = this.cops.filter(o => !o.left)
    const copNear = n => cops.reduce((m, o) => Math.min(m, Math.hypot(o.car.x - n.x, o.car.z - n.z)), 1e9)
    const penalty = n => { const m = copNear(n); return m < 120 ? (120 - m) * 6 : 0 }
    let goal
    // 傷んだら、警察のいない修理工場へ寄る
    dr.toShop = null
    if (c.dmg.body < 0.45 && !(e.repairCd > 0)) {
      let best = null, bd = 1e9
      for (const sh of this.shops) {
        const dd = Math.hypot(sh.x - c.x, sh.z - c.z)
        if (dd < 520 && dd < bd && cops.every(o => Math.hypot(o.car.x - sh.x, o.car.z - sh.z) > 140)) { bd = dd; best = sh }
      }
      if (best) {
        dr.toShop = best
        const path = this.nav.path(this.nav.entry(c.x, c.z, c.yaw), this.nav.nearest(best.x, best.z), penalty)
        this.setPlan(dr, [[c.x, c.z], ...path.map(n => [n.x, n.z]), [best.x, best.z]])
        return
      }
    }
    // 隠れ家が開いていて、見張りが近くにいなければ向かう
    const guarded = this.hideout.open && cops.some(o => Math.hypot(o.car.x - this.hideout.x, o.car.z - this.hideout.z) < 70)
    // CPU の犯人が隠れ家を狙うかは開いたときに半々で決める（いつも一直線だと警察役がつまらない）
    if (this.hideout.open && dr.wantsHideout == null) dr.wantsHideout = this.rng() < 0.5
    dr.toHideout = this.hideout.open && !guarded && dr.wantsHideout
    if (dr.toHideout) goal = this.nav.nodes.get(this.hideout.node)
    else {
      // 警察から一番遠く、自分からほどよく遠い交差点
      let best = null, bs = -1e9
      for (const n of this.nav.list) {
        const dSelf = Math.hypot(n.x - c.x, n.z - c.z)
        if (dSelf < 160 || dSelf > 650) continue
        const s = Math.min(600, copNear(n)) - dSelf * 0.25 + this.rng() * 60
        if (s > bs) { bs = s; best = n }
      }
      goal = best || this.nav.nearest(c.x, c.z)
    }
    const path = this.nav.path(this.nav.entry(c.x, c.z, c.yaw), goal, penalty)
    const pts = [[c.x, c.z], ...path.map(n => [n.x, n.z])]
    if (dr.toHideout) pts.push([this.hideout.x, this.hideout.z])
    dr.goal = goal
    this.setPlan(dr, pts)
  }

  roadPoint(x, z) {
    let best = { x, z }, bd = 1e9
    for (const sg of this.world.segs) {
      if (sg.surf !== 'road' || sg.hw < 6) continue
      const dx = sg.bx - sg.ax, dz = sg.bz - sg.az, L2 = dx * dx + dz * dz || 1
      const u = Math.max(0, Math.min(1, ((x - sg.ax) * dx + (z - sg.az) * dz) / L2))
      const qx = sg.ax + dx * u, qz = sg.az + dz * u, d = Math.hypot(x - qx, z - qz)
      if (d < bd) { bd = d; best = { x: qx, z: qz } }
      if (d < sg.hw) return { x, z }
    }
    return best
  }

  setPlan(dr, pts) {
    const clean = []
    for (const p of pts) { const l = clean[clean.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 1) clean.push(p) }
    if (clean.length < 2) clean.push([clean[0][0] + 1, clean[0][1] + 1])
    // 交差点の角を斜めに切る（直角のままだと曲がる前にほぼ止まる）
    const round = [clean[0]]
    for (let i = 1; i < clean.length - 1; i++) {
      const [ax, az] = clean[i - 1], [bx, bz] = clean[i], [cx, cz] = clean[i + 1]
      const l1 = Math.hypot(bx - ax, bz - az), l2 = Math.hypot(cx - bx, cz - bz)
      const dot = ((bx - ax) * (cx - bx) + (bz - az) * (cz - bz)) / (l1 * l2 || 1)
      if (dot < 0.7 && l1 > 20 && l2 > 20) {
        const k = 13
        round.push([bx - (bx - ax) / l1 * k, bz - (bz - az) / l1 * k], [bx + (cx - bx) / l2 * k, bz + (cz - bz) / l2 * k])
      } else round.push(clean[i])
    }
    round.push(clean[clean.length - 1])
    const dense = densify(round, 6)
    for (let i = 0; i < Math.min(3, dense.length); i++) dense[i].vmax = 99 // 今いる所の曲がり具合は見ない（向き直りで急ブレーキしない）
    dr.plan = { pts: dense, picks: [], boostZones: [] }
    dr.safe = dr.plan
    dr.idx = 0
    dr.fails = 0
  }

  nearestRobber(c) {
    let best = null, bd = 1e18
    for (const r of this.robbers) {
      if (r.left || r.arrested || r.escaped) continue
      const d = (r.car.x - c.x) ** 2 + (r.car.z - c.z) ** 2
      if (d < bd) { bd = d; best = r }
    }
    return best
  }
  // vertical: 人が高い所（屋上・空中）にいるときは、車の警察は手が届かない（4m 以上の高さの差は遠いとみなす）
  nearestCopDist(c, vertical = false) {
    let bd = 1e9
    for (const o of this.cops) {
      if (o.left || o.car.wreck) continue
      if (vertical && c.isRunner && Math.abs(c.y - (o.car.y - 0.55)) > 4) continue
      bd = Math.min(bd, Math.hypot(o.car.x - c.x, o.car.z - c.z))
    }
    return bd
  }

  // 固定ステップ1回。inputs は id -> 入力（ここで動かす人間の車だけ）
  stepFixed(dt, inputs = {}) {
    this.t += dt
    this.world.time = this.t
    if (this.phase === 'countdown') {
      if (this.t >= 0) { this.phase = 'racing'; this.events.push({ t: 'go' }) }
      else return
    }
    if (this.phase === 'done') return
    const nearPts = this.entries.filter(e => !e.left).map(e => [e.car.x, e.car.z])
    if (this.traffic) this.traffic.update(this.t, dt, nearPts)
    const all = this.cars().filter(c => !c.isRunner)
    const cars = this.traffic ? [...all, ...this.traffic.cars.filter(t => t.knocked <= 0 && !t.far)] : all

    // 手配度
    const h = Math.max(1, Math.min(5, 1 + Math.floor(this.t / CHASE.heatEvery) + this.heatBonus - this.heatDrop))
    if (h !== this.heat) { this.heat = h; this.events.push({ t: 'heat', heat: h }) }
    if (this.backupOn && !this.remoteJudge) this.callBackup()
    // 隠れ家
    if (!this.hideout.open && this.t >= CHASE.hideoutOpenAt) { this.hideout.open = true; this.events.push({ t: 'hideout', area: this.hideout.area }) }
    // 無線（警察に犯人の位置と向かう方角を知らせる。地図にしばらく出る）
    if (this.t >= this.nextPing) {
      this.nextPing = this.t + CHASE.pingEvery[this.heat]
      this.pingUntil = this.t + CHASE.pingShow
      for (const r of this.robbers) if (!r.left && !r.arrested && !r.escaped) {
        const c = r.car
        r.lastSeen = { x: c.x, z: c.z, vx: c.vx, vz: c.vz, at: this.t }
        this.events.push({ t: 'ping', id: r.id, x: c.x, z: c.z, area: areaName(this.world, c.x, c.z), heading: headingName(c.vx, c.vz) })
      }
    }

    for (const e of this.entries) {
      if (e.remote || e.left) continue
      const c = e.car
      // 逮捕された犯人・逃げ切った犯人は止まっている
      if (e.arrested || e.escaped) { if (c.isRunner) stepRunner(c, {}, dt, this.world); else step(c, {}, dt, this.world, null); continue }
      if (c.isRunner) {
        // はまり見張り（CPU）: 6秒で10mも進めていなければ、近くの交差点から出直す
        if (e.bot && this.t > 4 && !c.wreck && !(c.net > 0) && !(c.pit > 0)) {
          const w = e.watchR || (e.watchR = { x: c.x, y: c.y, z: c.z, t: this.t })
          if (this.t - w.t > 6) {
            if (Math.hypot(c.x - w.x, c.z - w.z, c.y - w.y) < 10) { const n = this.nav.nearest(c.x, c.z); Object.assign(c, { x: n.x, z: n.z, y: 0, vx: 0, vy: 0, vz: 0, rope: null, climbing: null }); if (e.driver) e.driver.replan = 0 }
            e.watchR = { x: c.x, y: c.y, z: c.z, t: this.t }
          }
        }
        // 警官は手配度で足が速くなる（自分より少し速い。壁登りは自分より遅い）
        if (e.role === 'cop') { c.speedMul = CHASE.footSpeed + CHASE.footSpeedHeat * this.heat; c.climbMul = CHASE.footClimb }
        const inp = e.bot ? (e.role === 'cop' ? copRunnerBot(this, e, dt) : runnerBot(this, e, dt)) : (inputs[e.id] || {})
        stepRunner(c, inp, dt, this.world)
        this.runnerContacts(e, cars)
        this.afterStep(e)
        continue
      }
      let inp
      if (e.bot) {
        const dr = e.driver
        // はまり見張り: 6秒で12mも進めていなければ、近くの交差点から出直す
        if (this.t > 4 && !c.wreck) {
          const w = dr.watch || (dr.watch = { x: c.x, z: c.z, t: this.t })
          if (this.t - w.t > 6) {
            if (Math.hypot(c.x - w.x, c.z - w.z) < 12) {
              const n = this.nav.nearest(c.x, c.z)
              const nb = this.nav.nodes.get(n.adj[0])
              c.respawnPoint = { x: n.x, z: n.z, yaw: Math.atan2(nb.x - n.x, nb.z - n.z), y: 0 }
              c.safeHist = []
              respawn(c)
              dr.replan = 0
            }
            dr.watch = { x: c.x, z: c.z, t: this.t }
          }
        }
        dr.replan -= dt
        if (dr.replan <= 0) { dr.replan = e.role === 'cop' ? 0.5 : 1.1; if (e.role === 'cop') this.planCop(e); else this.planRobber(e) }
        // 犯人の CPU は、計画の終わりに近づいたら早めに計画し直す
        if (e.role === 'robber' && dr.idx > dr.plan.pts.length - 8) dr.replan = 0
        // 警察の CPU は手配度が上がるほど速い（1.02〜1.14 倍）
        // 遠く離されている警察はさらに速い（追いつく。近くでは手配度の分だけ）
        if (e.role === 'cop') {
          const rob = this.nearestRobber(c)
          const far = rob ? Math.hypot(rob.car.x - c.x, rob.car.z - c.z) : 0
          c.rb = 0.99 + 0.03 * this.heat + Math.max(0, Math.min(CHASE.copCatch, (far - 60) / 400))
        } else c.rb = CHASE.robberRb // 犯人の CPU は少しだけ遅い（警察役の人が追いつけるように）
        inp = drive(dr, this.world, cars)
      } else inp = inputs[e.id] || {}
      // 犯人に3秒の先行（警察はスタートで少し待つ）
      if (e.role === 'cop' && this.t < 3) inp = { brake: speedOf(c) > 1 ? 1 : 0 }
      // 修理工場に着いたら止まって待つ
      if (e.bot && e.driver.toShop && this.shopAt(c.x, c.z) && e.rep < 1 && !(e.repairCd > 0)) inp = { brake: speedOf(c) > 0.8 ? 1 : 0 }
      // 見張りは隠れ家の前で止まって待つ
      if (e.bot && this.guardId() === e.id && Math.hypot(c.x - this.hideout.x, c.z - this.hideout.z) < 16) inp = { brake: speedOf(c) > 1 ? 1 : 0 }
      step(c, inp, dt, this.world, cars)
      this.afterStep(e)
    }
    if (!this.remoteJudge) { this.updateHeli(dt); this.updateGuns(dt); this.placeSpikes(); this.judgeRepair(dt); this.updateNets(dt); this.updatePits(); this.updatePeds(dt) }
    this.checkSpikes()
    this.judge(dt)
  }

  // ---- 応援のパトカー（手配度が上がると、犯人から離れた交差点に追加で現れる）
  callBackup() {
    const want = CHASE.backup[this.heat] || 0
    if (this.backupCount >= want) return
    if (this.cops.filter(o => !o.left).length >= CHASE.maxCops) return
    const before = this.entries.length
    this.addBots(1, 'cop')
    if (this.entries.length === before) { this.backupCount = want; return }
    const e = this.entries[this.entries.length - 1]
    const p = this.copBackPoint(e.car)
    Object.assign(e.car, { x: p.x, z: p.z, yaw: p.yaw, vx: 0, vz: 0 })
    e.car.y = this.world.groundAt(p.x, p.z, 50).h + 0.6
    e.car.respawnPoint = { ...p }
    e.px = p.x; e.pz = p.z
    e.driver.replan = 0
    this.backupCount++
    this.events.push({ t: 'backup', id: e.id, n: this.cops.filter(o => !o.left).length })
  }

  // ---- 修理工場
  shopAt(x, z) { return this.shops.find(s => x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1) || null }

  judgeRepair(dt) {
    if (this.phase !== 'racing') return
    for (const e of this.entries) {
      if (e.left || e.arrested || e.escaped) continue
      const c = e.car
      e.repairCd = Math.max(0, (e.repairCd || 0) - dt)
      const shop = this.shopAt(c.x, c.z)
      e.inShop = shop ? shop.id : -1
      if (!shop || speedOf(c) > 3 || c.wreck > 0 || e.repairCd > 0) { e.rep = 0; e.repSeen = false; continue }
      // 犯人は警察に見られていると直せない（見張られている修理工場は使えない）
      e.repSeen = e.role === 'robber' && this.nearestCopDist(c) < CHASE.repairSeen
      if (e.repSeen) { e.rep = 0; continue }
      e.rep = Math.min(1, (e.rep || 0) + dt / CHASE.repairSec)
      if (e.rep >= 1) this.completeRepair(e)
    }
  }

  completeRepair(e) {
    const c = e.car
    for (const k in c.dmg) c.dmg[k] = 1
    c.flat = false
    c.dents.length = 0
    c.boost = 1; c.boostLock = false
    e.rep = 0
    e.repairCd = CHASE.repairCooldown
    e.repairs = (e.repairs || 0) + 1
    const ev = { t: 'repaired', id: e.id, n: e.repairs }
    if (e.role === 'robber') {
      // 手配度が1下がり、警察は見失う（目撃情報が消え、次の無線まで少し間があく）
      this.heatDrop++
      e.lastSeen = null
      this.nextPing = Math.max(this.nextPing, this.t + 8)
      this.pingUntil = -1
      ev.lost = true
    }
    this.events.push(ev)
  }

  // ---- 警察ヘリ（手配度3から）。犯人の上空を追い、予告してからランチャーを撃つ
  updateHeli(dt) {
    const H = this.heli
    const rob = this.robbers.find(r => !r.left && !r.arrested && !r.escaped)
    const want = this.phase === 'racing' && this.heat >= CHASE.heli && !!rob
    if (want && !H.active) {
      // 犯人から離れた空から現れる
      const c = rob.car
      H.active = true; H.x = c.x - 220; H.z = c.z - 220
      H.nextShot = this.t + CHASE.heliFirstShot
      this.events.push({ t: 'heli' })
    }
    if (!want) { H.active = false; return }
    H.target = rob.id
    const c = rob.car
    // 犯人の少し後ろ上空へ
    const tx = c.x - c.vx * 0.6, tz = c.z - c.vz * 0.6
    const dx = tx - H.x, dz = tz - H.z, d = Math.hypot(dx, dz)
    const step = Math.min(d, CHASE.heliSpeed * dt * (d > 150 ? 1.6 : 1))
    if (d > 0.01) { H.x += dx / d * step; H.z += dz / d * step }
    // 撃つ: 犯人がそのまま走ったら来る場所を狙う（曲がる・止まる・急ぐで避けられる）
    if (this.t >= H.nextShot && Math.hypot(c.x - H.x, c.z - H.z) < 160) {
      H.nextShot = this.t + CHASE.heliEvery[this.heat]
      const lead = CHASE.strikeLead
      const b = this.world.bounds
      const x = Math.max(b.x0, Math.min(b.x1, c.x + c.vx * lead)), z = Math.max(b.z0, Math.min(b.z1, c.z + c.vz * lead))
      // 人が屋上にいれば屋上の高さに落とす
      const y = c.isRunner ? (c.grounded ? c.y : c.groundY) : this.world.groundAt(x, z, 50).h
      const s = { id: ++this.strikeSeq, x, z, y, at: this.t + CHASE.strikeWarn, r: CHASE.strikeRadius, from: [H.x, H.y, H.z], target: rob.id }
      this.strikes.push(s)
      this.events.push({ t: 'strikeWarn', ...s })
    }
    // 着弾
    for (const s of this.strikes) {
      if (s.done || this.t < s.at) continue
      s.done = true
      const hit = []
      for (const r of this.robbers) {
        if (r.left || r.arrested || r.escaped) continue
        const rc = r.car
        const gy = rc.isRunner ? s.y : this.world.groundAt(s.x, s.z, rc.y).h + 0.6
        if (Math.hypot(rc.x - s.x, rc.z - s.z) < s.r && Math.abs(rc.y - gy) < 4) {
          hit.push(r.id)
          if (!r.remote) blast(rc, s, this.rng)
        }
      }
      const bl = { id: s.id, x: s.x, y: s.y, z: s.z, at: this.t, hit }
      this.blasts.push(bl)
      this.events.push({ t: 'blast', ...bl })
    }
    this.strikes = this.strikes.filter(s => !s.done || this.t - s.at < 0.5)
    this.blasts = this.blasts.filter(b => this.t - b.at < 3)
  }

  // ---- 拳銃（手配度2から）。警察の CPU が、近くて建物の陰でない犯人を撃つ。遠いほど・速いほど外れる
  updateGuns(dt) {
    if (this.phase !== 'racing' || this.heat < CHASE.gunHeat) { this.shots.length = 0; return }
    const every = CHASE.gunEvery[this.heat]
    for (const o of this.cops) {
      if (!o.bot || o.left || o.car.wreck > 0) continue
      if (o.gunCd == null) o.gunCd = this.rng() * every
      o.gunCd -= dt
      if (o.gunCd > 0) continue
      const rob = this.nearestRobber(o.car)
      if (!rob) continue
      const c = o.car, r = rob.car
      const d = Math.hypot(r.x - c.x, r.z - c.z)
      // 人には高さも込みで届くか・建物で隠れていないかを見る（屋上にも撃ってくる）
      const d3 = r.isRunner ? Math.hypot(d, r.y + 1 - (c.y + 0.8)) : d
      const clear = r.isRunner ? !blocked(this.world, c.x, c.y + 0.9, c.z, r.x, r.y + 1.1, r.z) : Math.abs(r.y - c.y) <= 6 && this.clearShot(c.x, c.z, r.x, r.z)
      if (d3 > CHASE.gunRange || d < 3 || !clear) { o.gunCd = 0.25; continue }
      o.gunCd = every * (0.8 + this.rng() * 0.4)
      // 人はワイヤーで飛んでいる（速い・空中）ほど当たりにくい
      const p = r.isRunner
        ? Math.max(0.08, CHASE.gunHit - d3 / CHASE.gunRange * 0.3 - Math.hypot(r.vx, r.vy, r.vz) / 30 * 0.35 - (r.grounded ? 0 : 0.1))
        : Math.max(CHASE.gunHitMin, CHASE.gunHit - d / CHASE.gunRange * 0.3 - speedOf(r) / 50 * 0.2)
      const hit = this.rng() < p
      // 外れた弾は犯人のまわりの地面へ
      const m = hit ? 0 : 1.5 + this.rng() * 3, a = this.rng() * Math.PI * 2
      const s = { id: ++this.shotSeq, by: o.id, fx: c.x, fz: c.z, tx: r.x + Math.cos(a) * m, tz: r.z + Math.sin(a) * m, ty: r.isRunner ? r.y + 1 : null, at: this.t, hit: hit ? [rob.id] : [] }
      if (hit && !rob.remote) gunHit(r, this.heat)
      this.shots.push(s)
      this.events.push({ t: 'shot', ...s })
    }
    this.shots = this.shots.filter(s => this.t - s.at < 0.5)
  }

  // ---- 捕獲ネット: パトカーが、人がそのまま動いたら来る所へ撃つ。弾は見えて、避けられる
  updateNets(dt) {
    const rob = this.robbers.find(r => !r.left && !r.arrested && !r.escaped && r.car.isRunner)
    if (this.phase !== 'racing' || !rob) { this.nets.length = 0; return }
    const r = rob.car
    const every = CHASE.netEvery[this.heat] || 0
    if (this.heat >= CHASE.netHeat && every && this.t >= this.nextNet && !(r.net > 0) && !(r.pit > 0) && !(r.wreck > 0)) {
      for (const o of this.cops) {
        if (!o.bot || o.left || o.car.wreck > 0) continue
        if (o.netAt == null) o.netAt = this.t + 1 + this.rng() * every
        if (o.netAt > this.t) continue
        const c = o.car
        const fx = c.x, fy = c.y + 1.0, fz = c.z
        const d = Math.hypot(r.x - fx, r.y + 1 - fy, r.z - fz)
        if (d > CHASE.netRange || d < 4 || blocked(this.world, fx, fy, fz, r.x, r.y + 1, r.z)) continue
        // 届くまでの時間ぶん先を狙う（少し手前。そのまま動くと当たり、向きを変えると外れる）
        const T = d / CHASE.netSpeed
        const tx = r.x + r.vx * T * 0.85, ty = r.y + 1 + (r.grounded ? 0 : r.vy * T * 0.5), tz = r.z + r.vz * T * 0.85
        const L = Math.hypot(tx - fx, ty - fy, tz - fz) || 1
        const s = CHASE.netSpeed
        const n = { id: ++this.netSeq, by: o.id, x: fx, y: fy, z: fz, vx: (tx - fx) / L * s, vy: (ty - fy) / L * s + CHASE.netGravity * T * 0.5, vz: (tz - fz) / L * s, at: this.t, done: false }
        this.nets.push(n)
        o.netAt = this.t + every * (0.85 + this.rng() * 0.3)
        this.nextNet = this.t + CHASE.netGap
        this.events.push({ t: 'netFire', id: n.id, by: o.id, x: fx, y: fy, z: fz })
        break
      }
    }
    for (const n of this.nets) {
      if (n.done) continue
      const px = n.x, py = n.y, pz = n.z
      n.vy -= CHASE.netGravity * dt
      n.x += n.vx * dt; n.y += n.vy * dt; n.z += n.vz * dt
      // 人に当たったか（線分と点の距離）
      const ax = n.x - px, ay = n.y - py, az = n.z - pz, L2 = ax * ax + ay * ay + az * az || 1
      const u = Math.max(0, Math.min(1, ((r.x - px) * ax + (r.y + 1 - py) * ay + (r.z - pz) * az) / L2))
      const dd = Math.hypot(px + ax * u - r.x, py + ay * u - (r.y + 1), pz + az * u - r.z)
      if (dd < CHASE.netRadius && !(r.net > 0) && !(r.wreck > 0) && !rob.remote) {
        n.done = true
        r.net = RUN.netSec; r.rope = null; r.climbing = null; r.zipping = false
        r.vx *= 0.3; r.vz *= 0.3; if (r.vy > 0) r.vy = 0
        r.events.push({ t: 'netted' })
        this.events.push({ t: 'netHit', id: n.id, who: rob.id, x: r.x, y: r.y + 1, z: r.z })
        continue
      }
      if (this.t - n.at > CHASE.netLife || n.y < this.world.groundAt(n.x, n.z, n.y).h || blocked(this.world, px, py, pz, n.x, n.y, n.z)) n.done = true
    }
    this.nets = this.nets.filter(n => !n.done || this.t - n.at < 0.2)
  }

  // ---- 通行人（目撃・通報・タックル）
  updatePeds(dt) {
    const rob = this.robbers.find(r => !r.left && !r.arrested && !r.escaped && r.car.isRunner && !r.remote)
    if (this.phase !== 'racing' || !rob) return
    if (!this.peds) this.peds = createPeds(this)
    this.peds.update(dt, rob)
  }

  // 通行人が通報した: 警察に位置が伝わる（見失い中でも）。3回ごとに手配度が1上がる
  witnessCall(rob, p, n, fresh = true) {
    const c = rob.car
    rob.lastSeen = { x: c.x, z: c.z, vx: c.vx, vz: c.vz, at: this.t }
    rob.hiddenUntil = 0
    this.pingUntil = this.t + CHASE.pingShow
    if (!fresh) return
    this.events.push({ t: 'witness', id: p.id, x: p.x, z: p.z, n, area: areaName(this.world, c.x, c.z) })
    if (n % PED.callsPerHeat === 0 && this.heatBonus < 4) { this.heatBonus++; this.events.push({ t: 'witnessHeat', n }) }
  }

  // 通行人のタックル: よろけて少し体力が減る（ワイヤーも切れる）
  tackled(rob, p) {
    const c = rob.car
    const dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz) || 1
    c.rope = null; c.climbing = null; c.sneaking = false
    c.stun = 1.0
    c.vx = dx / d * 4; c.vz = dz / d * 4; c.vy = 3; c.grounded = false; c.y += 0.05
    c.dmg.body = Math.max(0.05, c.dmg.body - 0.05)
    c.events.push({ t: 'tackled', x: p.x, z: p.z })
    this.events.push({ t: 'tackle', id: p.id, x: p.x, z: p.z })
  }

  // ---- 落とし穴: 人が地上（道の高さ）にいると、行く手に予告の輪が出て、少しあとに穴が開く
  updatePits() {
    const rob = this.robbers.find(r => !r.left && !r.arrested && !r.escaped && r.car.isRunner)
    this.pits = this.pits.filter(p => this.t < p.until)
    if (this.phase !== 'racing' || !rob) return
    const r = rob.car
    for (const p of this.pits) if (!p.open && this.t >= p.at) { p.open = true; this.events.push({ t: 'pitOpen', id: p.id, x: p.x, z: p.z }) }
    // 落ちたか
    if (!(r.pit > 0) && !(r.net > 0) && !(r.wreck > 0) && r.grounded && !rob.remote) {
      for (const p of this.pits) {
        if (!p.open || Math.abs(r.y - p.y) > 0.6 || Math.hypot(r.x - p.x, r.z - p.z) > p.r) continue
        r.pit = RUN.pitSec; r.pitAt = { x: p.x, y: p.y, z: p.z }
        r.rope = null; r.climbing = null
        r.events.push({ t: 'fellPit' })
        this.events.push({ t: 'pitFall', id: p.id, who: rob.id })
        break
      }
    }
    const every = CHASE.pitEvery[this.heat] || 0
    if (this.heat < CHASE.pitHeat || !every || this.t < this.nextPit || this.pits.length >= CHASE.pitMax) return
    this.nextPit = this.t + 1
    // 道の高さにいて、走っている（屋上や空高くには作らない）
    if (r.y > 3 || r.pit > 0 || r.net > 0) return
    const v = Math.hypot(r.vx, r.vz)
    const lead = CHASE.pitLead + (r.grounded ? 0 : 0.3)
    let x = r.x + r.vx * lead, z = r.z + r.vz * lead
    if (v < 2) { x = r.x; z = r.z }
    const q = this.roadPoint(x, z)
    if (Math.hypot(q.x - x, q.z - z) > 6) return
    const y = this.world.groundAt(q.x, q.z, 1).h
    const p = { id: ++this.pitSeq, x: q.x, y, z: q.z, r: CHASE.pitRadius, at: this.t + CHASE.pitWarn, until: this.t + CHASE.pitWarn + CHASE.pitLife, open: false }
    this.pits.push(p)
    this.nextPit = this.t + every
    this.events.push({ t: 'pitWarn', id: p.id, x: p.x, z: p.z })
  }

  // ---- スパイクベルト（手配度4から）。犯人がそのまま走ったら数秒後に来る道に、道の幅の6割ほどを塞いで敷く（空いた側を通れば避けられる）
  placeSpikes() {
    this.spikes = this.spikes.filter(sp => this.t < sp.until)
    if (this.phase !== 'racing' || this.heat < CHASE.spikeHeat || this.t < this.nextSpike) return
    const rob = this.robbers.find(r => !r.left && !r.arrested && !r.escaped)
    if (!rob || !this.cops.some(o => !o.left)) return
    if (rob.car.isRunner) return // 人には敷かない（跳び越えられる）
    const c = rob.car, v = speedOf(c)
    this.nextSpike = this.t + 1 // 置けなかったら1秒後にもう一度
    if (v < 8 || this.spikes.length >= CHASE.spikeMax) return
    const ahead = Math.max(CHASE.spikeAheadMin, v * CHASE.spikeLead)
    const px = c.x + c.vx / v * ahead, pz = c.z + c.vz / v * ahead
    // 一番近い道の真ん中の線へ
    let best = null, bd = 1e9
    for (const sg of this.world.segs || []) {
      if (sg.surf !== 'road') continue
      const dx = sg.bx - sg.ax, dz = sg.bz - sg.az, L = Math.hypot(dx, dz)
      if (L < 30) continue
      const u = Math.max(12, Math.min(L - 12, ((px - sg.ax) * dx + (pz - sg.az) * dz) / L))
      const qx = sg.ax + dx / L * u, qz = sg.az + dz / L * u
      const d = Math.hypot(px - qx, pz - qz)
      if (d < bd) { bd = d; best = { sg, qx, qz, ux: dx / L, uz: dz / L } }
    }
    if (!best || bd > best.sg.hw + 4) return
    // 犯人がその道に沿って走っているときだけ（交差点の横切りには置かない）
    if (Math.abs(c.vx / v * best.ux + c.vz / v * best.uz) < 0.8) return
    if (Math.hypot(best.qx - c.x, best.qz - c.z) < CHASE.spikeAheadMin * 0.8) return
    const hw = best.sg.hw, len = hw * 2 * CHASE.spikeCover
    const side = this.rng() < 0.5 ? -1 : 1 // 塞ぐ側
    const nx = -best.uz, nz = best.ux      // 道を横切る向き
    const off = side * (hw - len / 2)
    const sp = { id: ++this.spikeSeq, x: best.qx + nx * off, z: best.qz + nz * off, yaw: Math.atan2(nx, nz), len, at: this.t, until: this.t + CHASE.spikeLife }
    this.spikes.push(sp)
    this.nextSpike = this.t + CHASE.spikeEvery[this.heat]
    this.events.push({ t: 'spike', ...sp })
  }

  // 踏んだか（ここで動かしている犯人の車だけ。オンラインでは自分の画面が自分の車を見る）
  checkSpikes() {
    if (this.phase !== 'racing' || !this.spikes.length) return
    for (const r of this.robbers) {
      if (r.remote || r.left || r.arrested || r.escaped || r.car.isRunner) continue
      const c = r.car
      if (!c.grounded) continue
      for (const sp of this.spikes) {
        const key = sp.id + ':' + r.id
        if (this.spikeHits.has(key)) continue
        const dx = c.x - sp.x, dz = c.z - sp.z
        const along = dx * Math.sin(sp.yaw) + dz * Math.cos(sp.yaw), across = dx * Math.cos(sp.yaw) - dz * Math.sin(sp.yaw)
        if (Math.abs(along) < sp.len / 2 + 0.9 && Math.abs(across) < 1.8) {
          this.spikeHits.add(key)
          puncture(c)
          this.events.push({ t: 'punctured', id: r.id, spike: sp.id, x: c.x, z: c.z })
        }
      }
    }
  }

  // 2点の間に背の高い建物がないか（上から見た線分と箱）
  clearShot(ax, az, bx, bz) {
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz)
    for (const w of this.walls) {
      const rr = Math.max(w.hw, w.hl) * 1.5
      if (w.cx + rr < x0 || w.cx - rr > x1 || w.cz + rr < z0 || w.cz - rr > z1) continue
      // 箱の向きにそろえてから、線分が箱を通るか調べる
      const cs = Math.cos(w.yaw || 0), sn = Math.sin(w.yaw || 0)
      const lx = (x, z) => (x - w.cx) * cs - (z - w.cz) * sn
      const lz = (x, z) => (x - w.cx) * sn + (z - w.cz) * cs
      const px = lx(ax, az), pz = lz(ax, az), dx = lx(bx, bz) - px, dz = lz(bx, bz) - pz
      let t0 = 0, t1 = 1, ok = true
      for (const [p0, dd, h] of [[px, dx, w.hw], [pz, dz, w.hl]]) {
        if (Math.abs(dd) < 1e-9) { if (p0 < -h || p0 > h) { ok = false; break } continue }
        let u = (-h - p0) / dd, v = (h - p0) / dd
        if (u > v) [u, v] = [v, u]
        t0 = Math.max(t0, u); t1 = Math.min(t1, v)
        if (t0 > t1) { ok = false; break }
      }
      if (ok) return false
    }
    return true
  }

  // 1台が動いたあとの出来事（ニトロ缶・一般車・大破）。オンラインのサーバーは人の位置が届いたときにも呼ぶ
  afterStep(e) {
    const c = e.car
    if (c.isRunner) {
      for (const ev of c.events) if (ev.t === 'wire' && ev.combo >= RUN.hideCombo && !(this.t < (e.hideReady || 0))) {
        // ワイヤーを地面に着かずにつなぐと、警察が見失う（無線の目撃も消える）
        e.hiddenUntil = this.t + RUN.hideSec
        e.hideReady = this.t + RUN.hideCd
        e.lastSeen = null
        this.pingUntil = -1
        this.nextPing = Math.max(this.nextPing, this.t + RUN.hideSec)
        this.events.push({ t: 'lost', id: e.id, combo: ev.combo })
      }
    }
    // 警察に当てられた犯人は大きく失速してよろける（体当たりで止めるのが警察の基本）
    if (e.role === 'robber' && !c.isRunner) for (const ev of c.events) if (ev.t === 'carhit' && ev.speed > 5) {
      const o = this.entry(ev.other)
      if (!o || o.role !== 'cop') continue
      const k = Math.max(0.45, 1 - ev.speed * 0.035)
      c.vx *= k; c.vz *= k
      c.yaw += (this.rng() - 0.5) * Math.min(0.5, ev.speed * 0.025)
    }
    for (const ev of c.events) if (ev.t === 'wreck') {
      // 体当たりで相手を大破させた（2秒以内に当てていた）
      const by = c.lastHitBy && c.t - c.lastHitAt < 2 ? this.entry(c.lastHitBy) : null
      if (by && by.role !== e.role) {
        by.takedowns++
        by.car.boost = Math.min(1, by.car.boost + 0.35); by.car.boostLock = false
        this.events.push({ t: 'takedown', id: by.id, victim: e.id, kind: ev.kind })
        if (by.role === 'robber' && ev.kind !== 'knock') this.heatBonus = Math.min(4, this.heatBonus + 1)
      }
      // 警察車の大破: その場で燃えて残り、少し遅れて犯人から離れた交差点へ戻る
      if (e.role === 'cop' && ev.kind !== 'knock') {
        c.backPoint = () => this.copBackPoint(c)
        this.copDown(e, by)
      }
      if (e.role === 'robber' && !this.remoteJudge && ev.kind !== 'knock' && this.nearestCopDist(c, c.isRunner) < (c.isRunner ? CHASE.downBustDist : CHASE.wreckBustDist)) this.arrest(e, 'wreck', by && by.role === 'cop' ? by.id : this.nearestCopId(c))
    }
    if (c.isRunner) return
    // ニトロ缶（取ってから 10 秒で同じ車がまた取れる）
    for (let pi = 0; pi < (this.world.pickups || []).length; pi++) {
      const pk = this.world.pickups[pi]
      if ((c.x - pk.x) ** 2 + (c.z - pk.z) ** 2 > 3.2 * 3.2) continue
      const taken = c.taken || (c.taken = {})
      if (taken[pi] > this.t) continue
      taken[pi] = this.t + 10
      c.boost = Math.min(1, c.boost + pk.amount); c.boostLock = false
      this.events.push({ t: 'pickup', id: e.id, pi })
    }
    // 一般車に当てたら吹き飛ばす
    if (this.traffic) {
      const h = this.traffic.hitBy(c)
      if (h) { c.boost = Math.min(1, c.boost + 0.04); this.events.push({ t: 'smash', id: e.id, x: h.car.x, y: h.car.y, z: h.car.z, rel: h.rel }) }
    }
  }

  // 人と車（警察・一般車）: 上から落ちてくれば踏みつけ、横から速く当てられればはね飛ばされる
  runnerContacts(e, cars) {
    const r = e.car
    if (r.wreck > 0 || r.freeze > 0) return
    // 走る警官を上から踏みつける（人の犯人だけ）
    if (e.role === 'robber' && r.vy < -RUN.stompVy) for (const o of this.cops) {
      const oc = o.car
      if (!oc.isRunner || o.left || oc.wreck > 0) continue
      const dy = r.y - oc.y
      if (dy < 0.8 || dy > 2.6 || Math.hypot(r.x - oc.x, r.z - oc.z) > 1.3) continue
      oc.lastHitBy = r.id; oc.lastHitAt = oc.t
      runnerDown(oc, 'stomp'); oc.wreck = CHASE.footStompSec
      oc.vx *= 0.2; oc.vz *= 0.2
      r.vy = RUN.stompBounce; r.grounded = false
      r.stomps = (r.stomps || 0) + 1
      r.events.push({ t: 'stomp', other: oc.id, cop: true, x: oc.x, y: oc.y + 1, z: oc.z })
      return
    }
    for (const car of cars) {
      if (car.wreck > 0 || car.knocked > 0) continue
      const dx = r.x - car.x, dz = r.z - car.z
      if (dx * dx + dz * dz > 16) continue
      const cs = Math.cos(car.yaw), sn = Math.sin(car.yaw)
      const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs // 横・前後
      if (Math.abs(lx) > 0.95 + RUN.radius || Math.abs(lz) > 2.2 + RUN.radius) continue
      const dy = r.y - (car.y - 0.55)
      if (dy > 3 || dy < -1.7) continue
      const isCop = car.role === 'cop'
      if (dy > 0.5 && r.vy < -RUN.stompVy) {
        // 踏みつけ: 警察車は止まって燃える（パトカーを潰したのと同じ）。一般車ははね上がる
        if (isCop) {
          car.dmg.body = 0; car.knock = false
          car.wreck = car.wreckSec || GAME.wreckRespawnSec
          car.lastHitBy = r.id; car.lastHitAt = car.t
          car.vx *= 0.3; car.vz *= 0.3
          car.events.push({ t: 'wreck', kind: 'stomp' })
        } else if (car.knocked != null) { car.knocked = 3; car.vy = 6; car.spin = (this.rng() - 0.5) * 6 }
        r.vy = RUN.stompBounce; r.y = car.y - 0.55 + 1.5; r.grounded = false
        if (isCop) r.stomps = (r.stomps || 0) + 1
        r.events.push({ t: 'stomp', other: car.id, cop: isCop, x: car.x, y: car.y + 1, z: car.z })
        return
      }
      if (dy > 1.3 || r.stun > 0) continue
      const rel = Math.hypot(car.vx - r.vx, car.vz - r.vz)
      if (rel > RUN.hitSpeed) {
        hitByCar(r, car, rel, isCop ? 1 : 0.6)
        return
      }
      // ゆっくりなら押し出すだけ
      const pu = 0.95 + RUN.radius - Math.abs(lx), pv = 2.2 + RUN.radius - Math.abs(lz)
      if (pu < pv) { const k = Math.sign(lx) * pu; r.x += cs * k; r.z += -sn * k }
      else { const k = Math.sign(lz) * pv; r.x += sn * k; r.z += cs * k }
    }
  }

  nearestCopId(c) {
    let best = null, bd = 1e18
    for (const o of this.cops) { const d = (o.car.x - c.x) ** 2 + (o.car.z - c.z) ** 2; if (d < bd) { bd = d; best = o.id } }
    return best
  }

  arrest(e, reason, by) {
    if (e.arrested || e.escaped) return
    e.arrested = true; e.bust = 1
    e.endBody = e.car.dmg.body // 結果には捕まった瞬間の車体を出す（このあと復帰で直るため）
    e.car.freeze = 999
    const cop = by ? this.entry(by) : null
    if (cop) cop.arrests = (cop.arrests || 0) + 1
    this.lastBust = { by, reason }
    this.events.push({ t: 'bust', id: e.id, by, reason })
    this.checkOver()
  }

  // 逮捕ゲージ・隠れ家・時間切れ
  judge(dt) {
    if (this.phase !== 'racing') return
    for (const r of this.robbers) {
      if (r.left || r.arrested || r.escaped) continue
      const c = r.car
      const dCop = this.nearestCopDist(c, true)
      // 囲まれている（2台以上がそばにいる）と、ある程度速くても逮捕ゲージがたまる
      let around = 0
      for (const o of this.cops) if (!o.left && !o.car.wreck && Math.hypot(o.car.x - c.x, o.car.z - c.z) < CHASE.bustDist + 3 && !(c.isRunner && Math.abs(c.y - (o.car.y - 0.55)) > 4)) around++
      // 警察がぴったりくっついている（5.5m 以内）なら、時速90km 未満でたまる
      if (this.footCops) {
        // 走る警官: 体に触れられている（2.6m・高さの差 1.8m 以内）と約0.9秒で逮捕。網・穴・ダウン中は 6m まで寄られるとたまる
        let near = 1e9
        for (const o of this.cops) {
          const oc = o.car
          if (o.left || oc.wreck > 0 || oc.stun > 0 || Math.abs(oc.y - c.y) > 1.8) continue
          near = Math.min(near, Math.hypot(oc.x - c.x, oc.z - c.z))
        }
        const stuck = c.net > 0 || c.pit > 0 || c.wreck > 0
        if (near < CHASE.footTouch || (stuck && near < CHASE.footStuck)) r.bust = Math.min(1, r.bust + dt / CHASE.footFill)
        else r.bust = Math.max(0, r.bust - dt * CHASE.bustDrain * 2)
      } else {
      const touching = dCop < 5.5
      const limit = touching ? CHASE.touchSpeed : around >= 2 ? CHASE.boxSpeed : CHASE.bustSpeed
      const slow = speedOf(c) < limit || c.wreck > 0
      if (dCop < CHASE.bustDist && slow) r.bust = Math.min(1, r.bust + dt / CHASE.bustFill)
      else r.bust = Math.max(0, r.bust - dt * CHASE.bustDrain)
      }
      if (r.bust >= 1 && !this.remoteJudge) this.arrest(r, 'bust', this.nearestCopId(c))
      // 隠れ家: 人は地上近く（高さの差 12m 以内）まで降りないと入れない。見られているかは高さを問わない距離で見る
      const nearH = !c.isRunner || Math.abs(c.y - this.world.groundAt(this.hideout.x, this.hideout.z, 5).h) < 12
      if (this.hideout.open && !this.remoteJudge && nearH && Math.hypot(c.x - this.hideout.x, c.z - this.hideout.z) < CHASE.hideoutRadius && this.nearestCopDist(c) > CHASE.hideoutClearCop) {
        r.escaped = true; c.freeze = 999
        this.events.push({ t: 'escape', id: r.id, reason: 'hideout' })
      }
    }
    if (this.t >= this.timeLimit && !this.remoteJudge) {
      for (const r of this.robbers) if (!r.left && !r.arrested && !r.escaped) { r.escaped = true; this.events.push({ t: 'escape', id: r.id, reason: 'time' }) }
    }
    this.checkOver()
  }

  // オンラインのサーバーが、人の車の位置を受け取るたびに呼ぶ（ゲートは無いので、前の位置を覚えるだけ）
  observe(e, x, z) { e.px = x; e.pz = z }

  checkOver() {
    if (this.phase !== 'racing' || this.remoteJudge) return
    const rs = this.robbers.filter(r => !r.left)
    if (!rs.length) { this.finish('cop', 'left'); return }
    if (rs.every(r => r.arrested)) { this.finish('cop', this.lastBust ? this.lastBust.reason : 'bust', this.lastBust ? this.lastBust.by : null, rs[rs.length - 1].id); return }
    if (rs.every(r => r.arrested || r.escaped) && rs.some(r => r.escaped)) {
      const esc = rs.find(r => r.escaped)
      this.finish('robber', this.t >= this.timeLimit ? 'time' : 'hideout', esc.id)
    }
  }

  finish(winner, reason, by = null, who = null) {
    this.phase = 'done'
    this.outcome = { winner, reason, by, who, t: Math.max(0, this.t) }
    for (const e of this.entries) if (e.endBody == null) e.endBody = e.car.dmg.body
    this.events.push({ t: 'over', winner, reason })
  }

  // 並び: 勝った側を上に、犯人を先頭に
  standings() {
    const w = this.outcome ? this.outcome.winner : null
    return [...this.entries].sort((a, b) => {
      const sa = (a.role === w ? 0 : 2) + (a.role === 'robber' ? 0 : 1) + (a.left ? 4 : 0)
      const sb = (b.role === w ? 0 : 2) + (b.role === 'robber' ? 0 : 1) + (b.left ? 4 : 0)
      return sa - sb || (b.takedowns || 0) - (a.takedowns || 0)
    })
  }

  progress(e) { return e.role === 'robber' ? 1 : 0 }

  removePlayer(id) {
    const e = this.entry(id)
    if (e) e.left = true
  }

  results() {
    const w = this.outcome ? this.outcome.winner : null
    return this.standings().map((e, i) => {
      const c = e.car
      const won = e.role === w
      let credits = won ? (e.role === 'robber' ? 700 : 520) : 150
      if (e.role === 'cop' && e.arrests) credits += 200 * e.arrests
      credits += Math.min(REWARD.breakCap, c.breaks * REWARD.perBreak) + (e.takedowns || 0) * REWARD.takedown
      return {
        id: e.id, name: c.name, bot: e.bot, role: e.role, place: i + 1, won, arrested: e.arrested, escaped: e.escaped, arrests: e.arrests || 0,
        left: e.left, breaks: c.breaks, maxAir: Math.round(c.maxAir * 10) / 10, body: Math.round((e.endBody ?? c.dmg.body) * 100), credits, carId: c.carId, takedowns: e.takedowns || 0,
        finished: won, time: this.outcome ? this.outcome.t : this.t, dnf: false, cp: 0,
        runner: !!c.isRunner, maxY: Math.round(c.maxY || 0), swings: c.swings || 0, bestCombo: c.bestCombo || 0, stomps: c.stomps || 0
      }
    })
  }

  // 画面向けのまとめ（HUD・オンラインの配信）
  summary() {
    return {
      heat: this.heat, hideout: this.hideout, outcome: this.outcome, left: Math.max(0, this.timeLimit - Math.max(0, this.t)),
      robbers: this.robbers.map(r => ({ id: r.id, bust: Math.round(r.bust * 100) / 100, arrested: r.arrested, escaped: r.escaped, seen: r.lastSeen || null })),
      pingUntil: this.pingUntil,
      heli: { active: this.heli.active, x: Math.round(this.heli.x), z: Math.round(this.heli.z) },
      strikes: this.strikes.filter(s => !s.done).map(s => ({ id: s.id, x: Math.round(s.x * 10) / 10, y: Math.round((s.y || 0) * 10) / 10, z: Math.round(s.z * 10) / 10, at: Math.round(s.at * 100) / 100, r: s.r, target: s.target })),
      downs: (this.downs = this.downs.filter(d => this.t - d.at < 3)).map(d => ({ ...d })),
      nets: this.nets.filter(n => !n.done).map(n => ({ id: n.id, x: n.x, y: n.y, z: n.z, vx: n.vx, vy: n.vy, vz: n.vz })),
      pits: this.pits.map(p => ({ id: p.id, x: p.x, y: p.y, z: p.z, r: p.r, open: p.open, at: p.at, until: p.until })),
      spikes: this.spikes.map(sp => ({ id: sp.id, x: Math.round(sp.x * 10) / 10, z: Math.round(sp.z * 10) / 10, yaw: Math.round(sp.yaw * 1000) / 1000, len: Math.round(sp.len * 10) / 10, at: sp.at, until: sp.until })),
      shots: this.shots.map(s => ({ id: s.id, by: s.by, fx: Math.round(s.fx * 10) / 10, fz: Math.round(s.fz * 10) / 10, tx: Math.round(s.tx * 10) / 10, tz: Math.round(s.tz * 10) / 10, ty: s.ty, hit: s.hit })),
      blasts: this.blasts.map(b => ({ id: b.id, x: b.x, z: b.z, at: b.at, hit: b.hit })),
      reps: Object.fromEntries(this.entries.map(e => [e.id, [Math.round((e.rep || 0) * 100) / 100, Math.ceil(e.repairCd || 0), e.repairs || 0, e.repSeen ? 1 : 0]]))
    }
  }
}

// ランチャーの着弾: 吹き飛んで大きく傷むが、これだけでは大破しない（車体は 8% より下がらない）
export function blast(c, s, rng = Math.random) {
  let dx = c.x - s.x, dz = c.z - s.z
  let d = Math.hypot(dx, dz)
  if (d < 0.5) { const a = rng() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); d = 1 }
  const k = 1 - Math.min(1, d / (s.r || CHASE.strikeRadius)) * 0.5 // 真ん中ほど強い
  c.vx += dx / d * CHASE.strikeKick * k; c.vz += dz / d * CHASE.strikeKick * k
  c.vy = CHASE.strikeLift * k
  c.y += 0.3
  c.grounded = false
  c.wr = (rng() - 0.5) * 6; c.wp = (rng() - 0.5) * 3
  const a = CHASE.strikeDamage * k / (c.stats ? c.stats.durability : 1)
  c.dmg.body = Math.max(0.08, c.dmg.body - a)
  c.dmg.engine = Math.max(0.15, c.dmg.engine - a * 0.5)
  c.dmg.tires = Math.max(0.15, c.dmg.tires - a * 0.4)
  if (c.isRunner) { c.rope = null; c.climbing = null; c.stun = 0.8; c.vy = Math.max(c.vy, 7) }
  c.events.push({ t: 'blasted', x: s.x, z: s.z })
}

// 拳銃の命中: 車体が少し傷み、少しよろける。弾だけでは大破しない（車体は 12% より下がらない）
export function gunHit(c, heat = 2) {
  // 人は車より弾に弱い（1発 6%）。弾だけでは体力は 25% より下がらない
  const a = c.isRunner ? CHASE.gunRunner : CHASE.gunDamage / (c.stats ? c.stats.durability : 1)
  c.dmg.body = Math.max(c.isRunner ? CHASE.gunRunnerFloor[heat] : CHASE.gunFloor, c.dmg.body - a)
  if (c.isRunner && c.dmg.body <= 0 && !c.wreck) runnerDown(c, 'shot')
  c.dmg.tires = Math.max(0.3, c.dmg.tires - a * 0.3)
  c.events.push({ t: 'shotHit' })
}

// スパイクベルトを踏んだ: パンク（タイヤがほぼ効かず、最高速も落ちる）。修理工場か大破からの復帰で直る
export function puncture(c) {
  c.flat = true
  c.dmg.tires = Math.min(c.dmg.tires, 0.15)
  c.vx *= 0.85; c.vz *= 0.85
}

// 警察車: 犯人に突っ込まれると壊れやすく、大破すると長く止まる
function copCar(car) {
  car.stats.durability *= CHASE.copDurability
  car.ramTaken = CHASE.copRamTaken
  car.wreckSec = CHASE.copWreckSec
}

export { respawn, speedOf }

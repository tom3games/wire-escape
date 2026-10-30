// レースの進行（カウントダウン・チェックポイント・順位・ゴール・結果）。
// オフラインではブラウザが、オンラインではサーバーがこれを持つ。どちらも同じ判定になる。

import { GAME, REWARD } from './config.js'
import { createCar, step, respawn, speedOf } from './physics.js'
import { crossedGate, progressOf, gateAt, totalGates } from './track.js'
import { createDriver, drive, planRoute } from './ai.js'
import { createTraffic } from './traffic.js'

export const BOT_NAMES = ['ガンテツ', 'ミサキ', 'BOLT', 'タツミ', 'ROOK', 'ヒバナ', 'VEGA']
const BOT_CARS = ['bruiser', 'dart', 'runner', 'bruiser', 'dart', 'runner', 'runner']

export function mulberry(seed) {
  let a = seed >>> 0
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}

export class Race {
  constructor(world, { seed = 1 } = {}) {
    this.world = world
    world.reset()
    this.rng = mulberry(seed)
    this.entries = []
    this.t = -GAME.countdownSec
    this.phase = 'countdown'
    this.firstFinish = null
    this.events = []      // 画面向け: { t:'cp'|'finish'|'break', id, ... }
    this.traffic = world.trafficLoops ? createTraffic(world) : null
  }

  // humans: [{ id, name, carId, levels, paint, remote }]。remote=true の車はここで動かさない（通信で位置が来る）
  addHuman(p) {
    const slot = this.world.grid[this.entries.length]
    const car = createCar({ id: p.id, name: p.name, carId: p.carId, levels: p.levels, paint: p.paint, spawn: slot })
    this.entries.push({ id: p.id, car, bot: false, remote: !!p.remote, cp: 0, finished: false, time: null, dnf: false, left: false, px: car.x, pz: car.z })
    return car
  }

  addBots(n, boldness = null) {
    for (let i = 0; i < n && this.entries.length < GAME.maxPlayers; i++) {
      const k = this.entries.length
      const slot = this.world.grid[k]
      const carId = BOT_CARS[i % BOT_CARS.length]
      const levels = { engine: (i % 3), tires: ((i + 1) % 3), armor: (i % 2) }
      const id = 'bot' + i
      const car = createCar({ id, name: BOT_NAMES[i % BOT_NAMES.length], carId, levels, spawn: slot, bot: true })
      const bold = boldness ?? (0.15 + this.rng() * 0.75)
      const plan = planRoute(this.world, this.rng, bold)
      const driver = createDriver(this.world, car, plan, 0.75 + this.rng() * 0.25)
      driver.aggr = this.rng() < 0.45 ? 0.6 + this.rng() * 0.4 : 0 // 半分くらいは体当たりしてくる
      this.entries.push({ id, car, bot: true, remote: false, driver, cp: 0, finished: false, time: null, dnf: false, left: false, px: car.x, pz: car.z })
    }
  }

  entry(id) { return this.entries.find(e => e.id === id) }
  cars() { return this.entries.map(e => e.car) }

  // 固定ステップ1回。inputs は id -> 入力（ここで動かす人間の車だけ）
  stepFixed(dt, inputs = {}) {
    this.t += dt
    this.world.time = this.t
    if (this.phase === 'countdown') {
      if (this.t >= 0) { this.phase = 'racing'; this.events.push({ t: 'go' }) }
      else return
    }
    if (this.phase === 'done') return
    if (this.traffic) this.traffic.update(this.t, dt)
    const cars = this.traffic ? [...this.cars(), ...this.traffic.cars.filter(t => t.knocked <= 0)] : this.cars()
    // CPU の追い上げ・手加減: 一番前の人間との差で ±10% まで性能を変える（いつも競り合いになる）
    const humans = this.entries.filter(e => !e.bot && !e.left)
    if (humans.length) {
      const lead = Math.max(...humans.map(e => this.progress(e)))
      for (const e of this.entries) if (e.bot) {
        const diff = this.progress(e) - lead
        e.car.rb = Math.max(0.9, Math.min(1.1, 1 - diff * 0.6))
      }
    }
    for (const e of this.entries) {
      if (e.remote || e.left) continue
      const c = e.car
      const inp = e.bot ? drive(e.driver, this.world, cars) : (inputs[e.id] || {})
      if (e.finished) { // ゴール後は惰性で止まる
        step(c, { brake: 0.4 }, dt, this.world, null)
      } else step(c, inp, dt, this.world, cars)
      // 体当たりで相手を大破させた（2秒以内に当てていた）ら、当てた側の手柄
      for (const ev of c.events) if (ev.t === 'wreck' && c.lastHitBy && c.t - c.lastHitAt < 2) {
        const by = this.entry(c.lastHitBy)
        if (by) { by.takedowns = (by.takedowns || 0) + 1; by.car.boost = Math.min(1, by.car.boost + 0.35); by.car.boostLock = false; this.events.push({ t: 'takedown', id: by.id, victim: e.id }) }
      }
      this.observe(e, c.x, c.z)
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
      // 一般車に当てたら吹き飛ばす（ニトロが少し戻る）
      if (this.traffic) {
        const h = this.traffic.hitBy(c)
        if (h) { c.boost = Math.min(1, c.boost + 0.05); this.events.push({ t: 'smash', id: e.id, x: h.car.x, y: h.car.y, z: h.car.z, rel: h.rel }) }
      }
      // すれすれ追い越し: 当たらずに 3m 以内を速く抜けるとニトロ（人間だけ）
      if (!e.bot && c.grounded && !c.wreck) for (const o of cars) {
        if (o === c || o.wreck) continue
        const d = Math.hypot(o.x - c.x, o.z - c.z)
        const rel = Math.hypot(c.vx - o.vx, c.vz - o.vz)
        const key = 'nm_' + o.id
        if (d < 3.4 && d > 2.45 && rel > 9 && !(c[key] > c.t)) {
          c[key] = c.t + 2.5
          c.boost = Math.min(1, c.boost + 0.08)
          this.events.push({ t: 'nearmiss', id: e.id, traffic: !!o.traffic })
        }
      }
    }
    this.checkOver()
  }

  // 位置を見てゲート通過を判定する。オンラインのサーバーは、人間の車の位置が届くたびにここを呼ぶ
  observe(e, x, z, clientTime = null) {
    const g = gateAt(this.world, e.cp)
    const tc = !e.finished && this.phase === 'racing' ? crossedGate(g, e.px, e.pz, x, z) : -1
    if (tc >= 0) {
      e.cp++
      e.car.respawnPoint = { ...g.respawn }
      if (e.cp >= totalGates(this.world)) {
        e.finished = true
        // 時刻は線を横切った瞬間に補間する
        const t = clientTime != null ? Math.min(clientTime, this.t) : this.t - GAME.step * (1 - tc)
        e.time = Math.max(0, t)
        if (this.firstFinish == null) this.firstFinish = this.t
        this.events.push({ t: 'finish', id: e.id, time: e.time })
      } else {
        const n = this.world.gates.length, laps = this.world.laps || 1
        const lapDone = laps > 1 && e.cp % n === 0
        this.events.push({ t: 'cp', id: e.id, cp: e.cp, name: lapDone ? `LAP ${e.cp / n + 1}/${laps}` : g.name })
      }
    }
    e.px = x; e.pz = z
  }

  progress(e) { return e.finished ? 100 + (1000 - e.time) / 1000 : progressOf(this.world, e.cp, e.car.z) }

  standings() {
    const list = this.entries.filter(e => !e.left || e.finished)
    list.sort((a, b) => {
      if (a.finished && b.finished) return a.time - b.time
      if (a.finished !== b.finished) return a.finished ? -1 : 1
      return this.progress(b) - this.progress(a)
    })
    const left = this.entries.filter(e => e.left && !e.finished)
    return [...list, ...left]
  }

  removePlayer(id) {
    const e = this.entry(id)
    if (e) { e.left = true; e.dnf = !e.finished }
  }

  checkOver() {
    if (this.phase !== 'racing' || this.remoteJudge) return // オンラインの画面側では終了はサーバーが決める
    const active = this.entries.filter(e => !e.left)
    const allDone = active.every(e => e.finished)
    const humansDone = active.filter(e => !e.bot).every(e => e.finished)
    const grace = this.firstFinish != null && this.t - this.firstFinish > GAME.finishGraceSec
    // 人間が全員ゴールしたら、CPU を待たずに締める
    if (allDone || grace || (humansDone && active.some(e => !e.bot))) {
      this.phase = 'done'
      for (const e of this.entries) if (!e.finished) e.dnf = true
      this.events.push({ t: 'over' })
    }
  }

  results() {
    return this.standings().map((e, i) => {
      const c = e.car
      let credits = e.finished ? REWARD.place[i] + REWARD.finish : REWARD.dnf
      credits += Math.min(REWARD.breakCap, c.breaks * REWARD.perBreak) + (e.takedowns || 0) * REWARD.takedown
      return {
        id: e.id, name: c.name, bot: e.bot, place: i + 1, time: e.time, finished: e.finished,
        dnf: e.dnf, left: e.left, cp: e.cp, breaks: c.breaks, maxAir: Math.round(c.maxAir * 10) / 10,
        body: Math.round(c.dmg.body * 100), credits, carId: c.carId, takedowns: e.takedowns || 0
      }
    })
  }
}

export { respawn, speedOf }

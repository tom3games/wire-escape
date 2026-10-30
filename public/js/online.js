// オンライン対戦の画面側。部屋の作成・参加・ロビー・レース中の送受信・補間を受け持つ。
// 自分の車はここで物理を回し（遅延なし）、状態を 30回/秒 送る。他の車はサーバーのスナップショットを
// 100ms 遅らせて補間して描く（届く間隔のばらつきで車が飛ばないように）。
import { connect } from './net.js'
import { GAME } from '../shared/config.js'
import { packCar } from '../shared/physics.js'

const INTERP_DELAY = 0.1
const SEND_HZ = GAME.netHz

export class Online {
  constructor(hooks) {
    this.h = hooks
    this.net = null
    this.status = 'offline'
    this.room = null       // 最後に届いた部屋の状態
    this.you = null
    this.session = null    // レース中の情報
    this.sendAcc = 0
    this.rtt = 0.08
    this.round = 0
  }

  get connected() { return this.status === 'online' }

  open() {
    if (this.net) return
    this.net = connect({
      onStatus: s => { this.status = s; this.h.onStatus && this.h.onStatus(s) },
      onMessage: m => this.onMessage(m)
    })
    setInterval(() => this.net && this.net.send({ t: 'ping', at: performance.now() }), 2000)
  }

  send(m) { this.net && this.net.send(m) }
  create(name, car) { this.open(); this.pendingCar = car; this.send({ t: 'create', name }) }
  join(code, name, car) { this.open(); this.pendingCar = car; this.send({ t: 'join', code, name }) }
  setCar(car) { this.send({ t: 'car', car }) }
  start(cpu, stage) { this.send({ t: 'start', opts: { cpu, stage } }) }
  rematch(cpu, stage) { this.send({ t: 'rematch', opts: { cpu, stage } }) }
  toLobby() { this.send({ t: 'lobby' }) }
  leave() { this.send({ t: 'leave' }); this.room = null; this.endSession() }

  onMessage(m) {
    switch (m.t) {
      case 'welcome': this.you = m.id; if (!m.code && this.h.onWelcome) this.h.onWelcome(); break
      case 'joined': if (this.pendingCar) { this.setCar(this.pendingCar); this.pendingCar = null } break
      case 'error': this.h.onError && this.h.onError(m.code, m.req); break
      case 'closed': this.room = null; this.endSession(); this.h.onClosed && this.h.onClosed(); break
      case 'pong': {
        const r = (performance.now() - m.at) / 1000
        this.rtt = this.rtt * 0.7 + r * 0.3
        break
      }
      case 'state': this.onState(m); break
      case 'snap': this.onSnap(m); break
      case 'correct': if (this.session) this.h.onCorrect(m.s); break
      case 'unbreak': this.h.onUnbreak(m.id); break
    }
  }

  onState(m) {
    const prev = this.room
    this.room = m
    if (m.phase === 'playing' && m.game) {
      if (!this.session || this.session.round !== m.round) {
        this.session = { round: m.round, buffers: new Map(), lastSnapRt: null }
        this.h.onRaceStart(m.game, m)
      }
    } else if (m.phase === 'result') {
      if (this.session && !this.session.resultShown) { this.session.resultShown = true; this.h.onResult(m.result, m) }
      else if (!this.session && prev?.phase !== 'result') this.h.onResult(m.result, m)
    } else if (m.phase === 'lobby') {
      if (this.session) this.endSession()
    }
    this.h.onRoom && this.h.onRoom(m)
  }

  endSession() { this.session = null }

  onSnap(m) {
    const s = this.session
    if (!s) return
    s.lastSnapRt = m.rt
    s.lastSnapAt = performance.now() / 1000
    s.phase = m.phase
    for (const c of m.cars) {
      let b = s.buffers.get(c.id)
      if (!b) s.buffers.set(c.id, b = [])
      b.push({ rt: m.rt, c })
      if (b.length > 30) b.shift()
    }
    if (m.br && m.br.length) for (const br of m.br) this.h.onRemoteBreak(br)
    this.h.onSnapMeta && this.h.onSnapMeta(m)
  }

  // サーバーのレース時計の推定（最後のスナップ + 経過 + 片道の遅れ）
  serverTime() {
    const s = this.session
    if (!s || s.lastSnapRt == null) return null
    return s.lastSnapRt + (performance.now() / 1000 - s.lastSnapAt) + this.rtt / 2
  }

  // 他の車を、少し過去の時刻で2つのスナップの間に補間する
  sample(id) {
    const s = this.session
    const b = s && s.buffers.get(id)
    if (!b || !b.length) return null
    const st = this.serverTime()
    const rt = (st ?? b[b.length - 1].rt) - INTERP_DELAY - this.rtt / 2
    if (rt <= b[0].rt) return b[0].c
    for (let i = b.length - 1; i > 0; i--) {
      const a = b[i - 1], c = b[i]
      if (rt >= a.rt && rt <= c.rt) {
        const k = (rt - a.rt) / Math.max(1e-3, c.rt - a.rt)
        return lerpCar(a.c, c.c, k)
      }
    }
    // 新しいスナップが遅れている: 最後の速度で少しだけ先読み（最大 0.25 秒）
    const l = b[b.length - 1].c
    const ex = Math.min(0.25, rt - b[b.length - 1].rt)
    return { ...l, x: l.x + l.vx * ex, y: l.y + l.vy * ex, z: l.z + l.vz * ex }
  }

  // 自分の車の状態を送る
  tick(dt, me, raceT) {
    if (!this.session || !me) return
    this.sendAcc += dt
    if (this.sendAcc < 1 / SEND_HZ) return
    this.sendAcc = 0
    const s = packCar(me)
    s.br = me.breaks
    s.air = Math.round(me.maxAir * 10) / 10
    this.send({ t: 'input', data: { k: 'state', s, rt: Math.round(raceT * 1000) / 1000 } })
  }
}

function lerpCar(a, b, k) {
  const L = (x, y) => x + (y - x) * k
  const A = (x, y) => { let d = y - x; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return x + d * k }
  return { ...b, x: L(a.x, b.x), y: L(a.y, b.y), z: L(a.z, b.z), vx: L(a.vx, b.vx), vy: L(a.vy, b.vy), vz: L(a.vz, b.vz), yaw: A(a.yaw, b.yaw), pitch: A(a.pitch, b.pitch), roll: A(a.roll, b.roll) }
}

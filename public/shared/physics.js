// 車の挙動。アーケード寄りの自前物理（4輪の接地点で姿勢を決め、速度を路面に沿わせる）。
// three.js に依存しないので、ブラウザ（自車）とサーバー/オフライン（CPU車・検証）で同じものが動く。
// 固定ステップ（GAME.step）で呼ぶこと。

import { GAME, PHYS, DAMAGE, buildStats } from './config.js'
import { surfaceDef } from './track.js'

const WX = 0.85, WZ = 1.35       // 車輪の位置（左右・前後の半分）
const WHEELS = [[WX, WZ], [-WX, WZ], [WX, -WZ], [-WX, -WZ]] // 左前 右前 左後 右後（+x が左）
const clamp = (v, a, b) => v < a ? a : v > b ? b : v

export function createCar({ id, name = '', carId = 'runner', levels = {}, paint = null, spawn, bot = false }) {
  const stats = buildStats(carId, levels)
  const c = {
    id, name, bot, carId: stats.car, levels, paint, stats,
    x: spawn.x, y: 0, z: spawn.z, vx: 0, vy: 0, vz: 0,
    yaw: spawn.yaw, pitch: 0, roll: 0, wp: 0, wr: 0,
    grounded: true, airTime: 0, lastAir: 0, surf: 'road',
    boost: 1, boostLock: false, boosting: false, heat: 0, overheat: false,
    dmg: { body: 1, engine: 1, tires: 1, susp: 1, cool: 1 },
    dents: [],
    wreck: 0, freeze: 0, falling: false,
    respawnPoint: { ...spawn },
    drifting: false, slip: 0, repairing: false,
    breaks: 0, maxAir: 0, t: 0,
    events: []
  }
  c.y = PHYS.rideHeight
  return c
}

export function speedOf(c) { return Math.hypot(c.vx, c.vz) }

// 車体の向き（YXZ の順のオイラー角）から前と上のベクトル
export function basis(yaw, pitch, roll) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw)
  const ca = Math.cos(-pitch), sa = Math.sin(-pitch)
  const cr = Math.cos(roll), sr = Math.sin(roll)
  return {
    fx: sy * ca, fy: -sa, fz: cy * ca,
    ux: -cy * sr + sy * sa * cr, uy: ca * cr, uz: sy * sr + cy * sa * cr
  }
}

export function respawn(c, { repair = false, safe = true } = {}) {
  // 2秒くらい前に地面を走っていた位置（落ちる直前・ぶつかる直前より手前）。無ければ直前のゲート
  const h = c.safeHist || []
  const sp = safe && h.length >= 4 ? h[Math.max(0, h.length - 8)] : null
  const p = sp || c.respawnPoint
  c.x = p.x; c.z = p.z; c.y = PHYS.rideHeight + (p.y || 0)
  c.vx = c.vy = c.vz = 0
  c.yaw = p.yaw; c.pitch = 0; c.roll = 0; c.wp = 0; c.wr = 0
  c.stunt = null
  if (sp) { c.vx = Math.sin(p.yaw) * 22; c.vz = Math.cos(p.yaw) * 22; c.safeHist = [] }
  c.grounded = true; c.airTime = 0; c.falling = false
  if (repair) { for (const k in c.dmg) c.dmg[k] = Math.max(c.dmg[k], GAME.wreckRepairTo); c.dents.length = 0; c.flat = false }
  c.wreck = 0
  c.freeze = sp ? 0.25 : GAME.respawnFreezeSec
  c.boostLock = false
  // 大破・落下から直して戻るときはニトロ満タン。自分で戻る（R）ときは少しだけ
  c.boost = repair ? 1 : Math.max(c.boost, 0.4)
  c.events.push({ t: 'respawn', repair })
}

function damage(c, amount, parts, kind) {
  if (amount <= 0) return 0
  const a = amount / c.stats.durability
  for (const [k, w] of Object.entries(parts)) c.dmg[k] = Math.max(0, c.dmg[k] - a * w)
  if (c.dmg.body <= 0 && (!c.wreck || c.knock)) {
    c.knock = false
    c.wreck = c.wreckSec || GAME.wreckRespawnSec
    c.events.push({ t: 'wreck', kind })
  }
  return a
}

// 1ステップ進める。world は track.createWorld()、others は他の車（押し合いだけ）
export function step(c, inp, dt, world, others = null) {
  const S = c.stats, d = c.dmg
  c.t += dt
  c.repairing = false

  // 大破・落下中は待つだけ
  if (c.wreck > 0) {
    c.wreck -= dt
    if (c.grounded) c.yaw += 5 * dt * Math.min(1, Math.hypot(c.vx, c.vz) / 10) // スピンしながら止まる
    c.vx *= 0.97; c.vz *= 0.97; c.vy -= PHYS.gravity * dt
    c.x += c.vx * dt; c.z += c.vz * dt; c.y += c.vy * dt
    const g = world.groundAt(c.x, c.z, c.y - PHYS.rideHeight)
    if (c.y < g.h + PHYS.rideHeight && !c.falling) { c.y = g.h + PHYS.rideHeight; c.vy = 0 }
    // 体当たりでスピンしただけ（ノックダウン）なら、その場から走り出す（遠くへ戻さない。追われている犯人が逃げられないように）
    if (c.wreck <= 0) {
      if (c.knock) { c.knock = false; c.wreck = 0; c.freeze = 0.2 }
      else {
        // 戻る場所をその時点で決める（大破した警察車は犯人から離れた交差点へ）
        if (c.backPoint) { c.respawnPoint = c.backPoint(); c.safeHist = []; c.backPoint = null }
        respawn(c, { repair: true })
      }
    }
    return
  }
  if (c.freeze > 0) { c.freeze -= dt; regen(c, dt, false); if (Math.hypot(c.vx, c.vz) < 1) { c.vx = c.vy = c.vz = 0 } return }
  if (inp.respawn) { respawn(c); return }

  // 性能（損傷とオーバーヒートで落ちる）
  const hot = c.overheat
  const rb = c.rb || 1 // CPU の追い上げ・手加減（人間は常に 1）
  const maxSpd = S.maxSpeed * (0.6 + 0.4 * d.engine) * (hot ? 0.82 : 1) * rb * (c.flat ? 0.72 : 1) // パンク（スパイクベルト）
  const accel = S.accel * (0.5 + 0.5 * d.engine) * (hot ? 0.75 : 1) * rb
  const grip = S.grip * (0.55 + 0.45 * d.tires)
  const steerK = S.steer * (0.7 + 0.3 * d.tires)
  const boosting = !!inp.boost && c.boost > 0 && !c.boostLock && !hot
  // パーフェクトニトロ: 押してから 0.45〜0.8 秒の間にもう一度押すと強くなる
  const press = !!inp.boost && !c.boostPrev
  c.boostPrev = !!inp.boost
  if (press && boosting && !inp.ai) {
    const since = c.t - (c.boostStart ?? -9)
    if (c.boostStart != null && since >= 0.45 && since <= 0.8 && !c.perfect) { c.perfect = true; c.events.push({ t: 'perfect' }) }
    else if (since > 0.8 || c.boostStart == null) { c.boostStart = c.t; c.perfect = false }
  }
  if (!boosting && !inp.boost) { c.perfect = false; if (c.t - (c.boostStart ?? -9) > 0.85) c.boostStart = null }
  c.boosting = boosting
  const pf = boosting && c.perfect ? 1.45 : 1

  // ---- 4輪の接地
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw)
  const base = c.y - PHYS.rideHeight
  const hs = [], surfs = []
  let contacts = 0, cliff = false
  const px0 = c.x, pz0 = c.z
  for (const [lx, lz] of WHEELS) {
    const wx = c.x + lx * cy + lz * sy, wz = c.z - lx * sy + lz * cy
    const g = world.groundAt(wx, wz, base)
    // 車輪の位置の地面が段差より高い = 崖の壁。地面として使わず、壁として押し返す
    if (g.h > base + PHYS.stepUp + 0.3) { cliff = true; hs.push(base - 1.6); surfs.push(g.surf); continue }
    // 地面が無い（谷の上など）輪は少し下にあるとみなす。そこへ傾いていく
    hs.push(Math.max(g.h, base - 1.6))
    surfs.push(g.surf)
    if (base - g.h < PHYS.suspTravel) { contacts++; if (g.slab) { c.lastSlab = g.slab; c.lastSlabT = c.t } }
  }

  let gripMul = 1, rollMul = 1, surfName = c.surf
  if (contacts >= 2) {
    const hF = (hs[0] + hs[1]) / 2, hR = (hs[2] + hs[3]) / 2
    const hL = (hs[0] + hs[2]) / 2, hRt = (hs[1] + hs[3]) / 2
    const tP = clamp(Math.atan2(hF - hR, 2 * WZ), -0.7, 0.7)
    const tR = clamp(Math.atan2(hL - hRt, 2 * WX), -0.7, 0.7)
    const gY = (hs[0] + hs[1] + hs[2] + hs[3]) / 4
    // 地面の法線
    const tp = Math.tan(tP), tr = Math.tan(tR)
    let gx = sy * tp + cy * tr, gz = cy * tp - sy * tr
    let nx = -gx, ny = 1, nz = -gz
    const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl

    if (!c.grounded) land(c, nx, ny, nz, tP, tR)
    if (c.wreck) return
    c.grounded = true
    c.lastAir = c.airTime
    c.airTime = 0

    // 路面
    const sname = surfs.find((s, i) => base - hs[i] < PHYS.suspTravel) || 'grass'
    surfName = sname
    const sd = surfaceDef(sname)
    gripMul = sd.grip; rollMul = sd.roll

    // 高さは地面に吸い付ける（サスペンション）。壊れていると揺れる
    const ty = gY + PHYS.rideHeight
    const wob = (1 - d.susp) * Math.sin(c.t * 9) * 0.12 * Math.min(1, speedOf(c) / 30)
    if (c.y < ty) c.y = ty
    else c.y += (ty - c.y) * Math.min(1, dt * 22)
    c.y += wob * dt * 10
    c.pitch += (tP - c.pitch) * Math.min(1, dt * 14)
    c.roll += (tR + wob * 0.6 - c.roll) * Math.min(1, dt * 14)
    c.wp = 0; c.wr = 0

    // 重力を足してから、地面へめり込む向きの速度を消す（坂では下りに加速する）
    c.vy -= PHYS.gravity * dt
    let vn = c.vx * nx + c.vy * ny + c.vz * nz
    if (vn < 0) { c.vx -= nx * vn; c.vy -= ny * vn; c.vz -= nz * vn; vn = 0 }

    // 急すぎる斜面（谷の壁など）は走れない。重力で滑り落ちるだけ
    const steep = ny < 0.6
    if (!steep) {
    // ハンドル。速いほど切れにくい。バック中は逆
    const vf0 = c.vx * sy + c.vz * cy
    const av0 = Math.abs(vf0)
    // 速いほど切れにくく（高速で切りすぎてスピンしない）。2026-10-26 本人「操作しきれへん」で 28→17
    const sf = clamp(av0 / 5, 0, 1) / (1 + av0 / 17)
    let yawRate = (inp.steer || 0) * steerK * sf * (vf0 < -0.5 ? -1 : 1)
    if ((inp.handbrake || (!inp.ai && (inp.brake || 0) > 0 && Math.abs(inp.steer || 0) > 0.3)) && av0 > 6) yawRate *= PHYS.driftYaw
    // 壊れたサスペンションは高速でふらつく
    yawRate += (1 - d.susp) * Math.sin(c.t * 5.3) * 0.12 * Math.min(1, av0 / 35)
    c.yaw -= yawRate * dt
    // 走行安定の補助: ハンドルを戻していれば、車の向きを進む向きへ寄せる（スピンしにくい）
    if (Math.abs(inp.steer || 0) < 0.15 && !inp.handbrake && av0 > 8) {
      const hv = Math.atan2(c.vx, c.vz)
      let dy = hv - c.yaw
      while (dy > Math.PI) dy -= 2 * Math.PI
      while (dy < -Math.PI) dy += 2 * Math.PI
      if (Math.abs(dy) < 1.2) c.yaw += dy * Math.min(1, PHYS.straighten * dt)
    }

    // 新しい向きで、路面に沿った前と横
    const cyn = Math.cos(c.yaw), syn = Math.sin(c.yaw)
    let fx = syn, fy = 0, fz = cyn
    const fd = fx * nx + fz * nz
    fx -= nx * fd; fy -= ny * fd; fz -= nz * fd
    const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl
    const rx = fy * nz - fz * ny, ry = fz * nx - fx * nz, rz = fx * ny - fy * nx // 右 = 前 x 法線

    let vf = c.vx * fx + c.vy * fy + c.vz * fz
    let vl = c.vx * rx + c.vy * ry + c.vz * rz
    const vnn = c.vx * nx + c.vy * ny + c.vz * nz

    // アクセル・ブレーキ・バック
    const top = maxSpd + (boosting ? S.boostTop * (0.6 + 0.4 * d.engine) * (pf > 1 ? 1.5 : 1) : 0)
    const thr = inp.throttle || 0, brk = inp.brake || 0
    if (thr > 0) {
      if (vf < -0.5) vf += 30 * thr * dt
      else vf += (accel * thr * Math.max(0.12, 1 - (vf / top) ** 2) + (boosting && vf < top ? S.boostForce * pf : 0)) * dt
    }
    const brakeDrift = !inp.ai && brk > 0 && Math.abs(inp.steer || 0) > 0.3 && vf > 14 // CPU のブレーキは普通に減速
    if (brakeDrift) vf -= 7 * dt // 曲がりながらのブレーキは減速より横滑り
    else if (brk > 0) {
      if (vf > 0.8) vf = Math.max(0, vf - 34 * brk * dt)
      else if (thr <= 0) vf = Math.max(-14, vf - 10 * brk * dt)
    }
    if (thr <= 0 && brk <= 0) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 3 * dt)
    // 転がり抵抗と空気抵抗
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), (PHYS.rolling * rollMul + PHYS.aeroDrag * vf * vf) * dt)
    if (vf > top) vf -= (vf - top) * 1.4 * dt

    // 横滑り。ハンドブレーキと土・草で滑る。消えた横の勢いの大半は前へ回す（曲がっても失速しすぎない）
    const av = Math.abs(vf)
    // 2026-10-26 本人「ドリフトの時滑りすぎ」: 滑る量 0.16/0.3→0.42/0.55、横滑り角の上限 32 度
    const latGrip = grip * gripMul * (inp.handbrake ? PHYS.driftGrip : brakeDrift ? PHYS.brakeDriftGrip : 1) * (av > 32 && Math.abs(inp.steer || 0) > 0.7 ? 0.8 : 1)
    const keep = Math.exp(-latGrip * dt)
    let lost = Math.abs(vl) * (1 - keep)
    vl *= keep
    const maxLat = av * PHYS.driftMaxTan
    if (av > 6 && Math.abs(vl) > maxLat) { lost += Math.abs(vl) - maxLat; vl = Math.sign(vl) * maxLat }
    if (av > 1) vf += Math.sign(vf) * lost * (inp.handbrake ? 0.55 : 0.8)
    c.slip = Math.abs(vl)
    c.drifting = Math.abs(vl) > 3.5 && av > 10

    c.vx = fx * vf + rx * vl + nx * vnn
    c.vy = fy * vf + ry * vl + ny * vnn
    c.vz = fz * vf + rz * vl + nz * vnn
    } else { c.drifting = false; c.slip = 0 }
  } else {
    // ---- 空中
    if (c.grounded) {
      c.grounded = false; c.airTime = 0; c.events.push({ t: 'takeoff' })
      // 台から飛んだら技。曲がった台はバレルロール、ドリフトしながらならフラットスピン
      const sl = c.lastSlab && c.t - c.lastSlabT < 0.2 ? c.lastSlab : null
      const v = speedOf(c)
      if (sl && v > 12 && (sl.kind === 'kicker' || sl.kind === 'ramp' || sl.kind === 'bridge' || sl.kind === 'roll')) {
        const tAir = Math.max(0.5, 2 * Math.max(2, c.vy) / PHYS.gravity + 0.25)
        if (sl.roll) {
          const n = Math.max(1, Math.min(3, Math.floor(tAir / 0.8)))
          c.stunt = { type: 'roll', dir: sl.roll, rate: Math.PI * 2 * n / tAir, acc: 0 }
        } else if ((c.slip > 4 || inp.handbrake) && tAir > 0.7) {
          const n = Math.max(1, Math.min(2, Math.floor(tAir / 0.9)))
          c.stunt = { type: 'spin', dir: Math.sign(inp.steer || 1), rate: Math.PI * 2 * n / tAir, acc: 0 }
        }
      }
    }
    c.airTime += dt
    c.maxAir = Math.max(c.maxAir, c.airTime)
    c.vy -= PHYS.gravity * dt
    const v = Math.hypot(c.vx, c.vy, c.vz)
    const drag = PHYS.aeroDrag * v * dt
    c.vx -= c.vx * drag; c.vz -= c.vz * drag
    if (boosting) {
      const b = basis(c.yaw, c.pitch, c.roll)
      const k = S.boostForce * 0.7 * dt
      c.vx += b.fx * k; c.vy += b.fy * k; c.vz += b.fz * k
    }
    // 姿勢: 入力があればそれに従い、無ければ鼻先がゆっくり軌道を向く
    const airK = PHYS.airRate * S.air * (0.6 + 0.4 * d.susp)
    const hv = Math.hypot(c.vx, c.vz)
    const traj = Math.atan2(c.vy, Math.max(1, hv))
    const pi = inp.pitch || 0, ri = inp.roll || 0
    const wpT = pi ? pi * airK : (traj * 0.75 - c.pitch) * 1.1
    c.wp += (wpT - c.wp) * Math.min(1, dt * (pi ? 5 : 2.5))
    c.pitch = clamp(c.pitch + c.wp * dt, -1.45, 1.45)
    const st = c.stunt
    if (st && st.type === 'roll') { const d = st.rate * dt; c.roll += st.dir * d; st.acc += d }
    else {
      const wrT = ri ? -ri * airK : -c.roll * 1.6
      c.wr += (wrT - c.wr) * Math.min(1, dt * (ri ? 5 : 3))
      c.roll = clamp(c.roll + c.wr * dt, -1.45, 1.45)
    }
    if (st && st.type === 'spin') { const d = st.rate * dt; c.yaw -= st.dir * d; st.acc += d }
    else c.yaw -= (inp.steer || 0) * 0.9 * dt
    c.drifting = false
  }
  c.surf = surfName

  // ---- 位置
  c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt
  if (cliff) {
    // 崖の壁にぶつかった: 横には進めない
    const sp = Math.hypot(c.vx, c.vz)
    c.x = px0; c.z = pz0; c.vx *= -0.15; c.vz *= -0.15
    if (sp > 4) c.events.push({ t: 'scrape', speed: sp })
  }

  // ---- 壁・壊せる物・他の車
  collide(c, world, boosting)
  if (others) for (const o of others) if (o !== c && o.id !== c.id && !o.wreck) bump(c, o)

  // ---- 落下
  if (c.y < (world.fallY ?? GAME.fallY) && !c.wreck) {
    c.wreck = 1.4; c.falling = true
    c.events.push({ t: 'fall' })
  }

  // ---- 復帰用に、地面を走っていた位置を 0.25 秒ごとに覚える（最大4秒分）
  if (c.grounded && !c.wreck && speedOf(c) > 4 && (c.surf === 'road' || c.surf === 'dirt' || c.surf === 'wood')) {
    c.safeT = (c.safeT || 0) + dt
    if (c.safeT > 0.25) {
      c.safeT = 0
      const hist = c.safeHist || (c.safeHist = [])
      hist.push({ x: c.x, z: c.z, y: c.y - PHYS.rideHeight, yaw: Math.atan2(c.vx, c.vz) })
      if (hist.length > 16) hist.shift()
    }
  }

  // ---- 修理ピット
  if (c.grounded && world.pitRegen !== false && world.inRepair(c.x, c.z) && speedOf(c) < 14) {
    for (const k in d) d[k] = Math.min(1, d[k] + 0.32 * dt)
    c.repairing = true
    if (d.body > 0.97 && c.dents.length) c.dents.length = 0
  }

  // ---- ブーストと熱
  if (boosting) {
    c.boost -= dt / S.boostCap
    c.heat += 0.16 * S.heat * (1 + 2 * (1 - d.cool)) * dt
    if (c.boost <= 0) { c.boost = 0; c.boostLock = true; c.events.push({ t: 'boostEmpty' }) }
  } else {
    c.heat -= 0.11 * (0.3 + 0.7 * d.cool) * dt
    // 冷却が死にかけると全開走行だけで熱がこもる
    if (d.cool < 0.45 && (inp.throttle || 0) > 0.9) c.heat += 0.05 * (0.45 - d.cool) * 4 * dt
  }
  c.heat = clamp(c.heat, 0, 1.05)
  if (!c.overheat && c.heat >= 1) { c.overheat = true; c.events.push({ t: 'overheat' }) }
  if (c.overheat && c.heat < 0.45) c.overheat = false
  regen(c, dt, boosting)
}

function regen(c, dt, boosting) {
  if (boosting) return
  const r = 0.035 + (c.drifting ? 0.3 : 0) + (!c.grounded ? 0.3 : 0)
  c.boost = Math.min(1, c.boost + r * dt)
  if (c.boostLock && c.boost >= 0.3) c.boostLock = false
}

// 着地。法線方向の速さと、車体と地面のずれで損傷が決まる
function land(c, nx, ny, nz, tP, tR) {
  const vn = c.vx * nx + c.vy * ny + c.vz * nz
  const impact = Math.max(0, -vn)
  // 技（バレルロール・フラットスピン）を数えて、姿勢を整えて着地させる（失敗しても転ばない）
  if (c.stunt) {
    const st = c.stunt
    const n = Math.floor((st.acc + 0.9) / (Math.PI * 2))
    if (st.type === 'roll') c.roll = tR
    else c.yaw = Math.atan2(c.vx, c.vz)
    if (n > 0) {
      const gain = (st.type === 'roll' ? 0.25 : 0.2) * n
      c.boost = Math.min(1, c.boost + gain)
      if (c.boostLock && c.boost >= 0.3) c.boostLock = false
      c.events.push({ t: 'stunt', kind: st.type, n, gain })
    }
    c.stunt = null
  }
  c.roll = Math.atan2(Math.sin(c.roll), Math.cos(c.roll))
  const b = basis(c.yaw, c.pitch, c.roll)
  const align = clamp(b.ux * nx + b.uy * ny + b.uz * nz, -1, 1)
  const mis = Math.acos(align)
  // 着地では壊れない（2026-10-26 本人「着地だけでダメージ食らうのやめて」）。ひどい角度なら少し減速するだけ
  const bad = mis > 0.9 && impact > 4
  if (bad) { c.vx *= 0.8; c.vz *= 0.8; c.pitch = tP; c.roll = tR }
  c.events.push({ t: 'land', impact, mis, sev: 0, crash: false, air: c.airTime, dmg: 0 })
}

function collide(c, world, boosting) {
  const S = c.stats
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw)
  const r = PHYS.carRadius
  const bottom = c.y - 0.45, topY = c.y + 0.95
  const base = c.y - PHYS.rideHeight
  for (const off of [PHYS.carHalfLen, -PHYS.carHalfLen]) {
    for (let pass = 0; pass < 2; pass++) {
      const px = c.x + sy * off, pz = c.z + cy * off
      let hitAny = false
      for (const o of world.nearby(px, pz)) {
        if (o.id && world.destroyed.has(o.id)) continue
        // 縦の重なり
        const cs = Math.cos(o.yaw || 0), sn = Math.sin(o.yaw || 0)
        const dx = px - o.cx, dz = pz - o.cz
        const u = dx * cs - dz * sn, v = dx * sn + dz * cs
        let yb, yt
        if (o.slab) {
          if (!world.slabActive(o.slab)) continue
          const vv = clamp(v, -o.hl, o.hl)
          yt = o.slab.y0 + (o.slab.y1 - o.slab.y0) * (vv + o.hl) / (2 * o.hl)
          yb = yt - o.slab.thick
          if (yt <= base + PHYS.stepUp) continue // 乗り上げられる
        } else { yb = o.y0; yt = o.y1 }
        if (topY <= yb || bottom >= yt - 0.25) continue
        const lu = clamp(u, -o.hw, o.hw), lv = clamp(v, -o.hl, o.hl)
        let nu, nv, pen
        if (lu === u && lv === v) {
          // 中心が箱の中。いちばん浅い面から出す
          const pu = o.hw - Math.abs(u), pv = o.hl - Math.abs(v)
          if (pu < pv) { nu = Math.sign(u) || 1; nv = 0; pen = pu + r } else { nu = 0; nv = Math.sign(v) || 1; pen = pv + r }
        } else {
          const du = u - lu, dv = v - lv
          const dist = Math.hypot(du, dv)
          if (dist >= r) continue
          nu = du / dist; nv = dv / dist; pen = r - dist
        }
        const nx = nu * cs + nv * sn, nz = -nu * sn + nv * cs
        const vn = c.vx * nx + c.vz * nz
        if (o.def && vn < -0.2) {
          // 壊せる物。勢いが足りれば突き抜ける
          const power = -vn * S.mass * (boosting ? 1.15 : 1)
          if (power >= o.def.breakAt) {
            world.breakObj(o.id)
            c.breaks++
            c.boost = Math.min(1, c.boost + 0.04) // 壊すとニトロが少し戻る
            const keep = 1 - o.def.absorb
            c.vx *= keep; c.vz *= keep
            damage(c, o.def.hard * 0.012 * Math.max(0, -vn - 8) * 0.2, { body: 1, engine: 0.3 }, 'break')
            c.events.push({ t: 'break', id: o.id, speed: -vn, x: o.cx, z: o.cz, dx: c.vx, dz: c.vz })
            continue
          }
        }
        hitAny = true
        if (vn < 0) {
          const hard = o.def ? o.def.hard : (o.kind === 'rail' ? 0.8 : o.kind === 'rock' ? 1.2 : 1.0)
          const imp = -vn
          c.vx -= nx * vn * 1.25; c.vz -= nz * vn * 1.25
          // 擦った分の摩擦
          const tx = -nz, tz = nx
          const vt = c.vx * tx + c.vz * tz
          c.vx -= tx * vt * 0.08 * Math.min(1, imp / 5); c.vz -= tz * vt * 0.08 * Math.min(1, imp / 5)
          const sev = Math.max(0, imp - DAMAGE.wallFree)
          if (sev > 0) {
            const front = -(nx * sy + nz * cy) // 1 = 正面衝突
            const amount = Math.pow(sev, 1.3) * DAMAGE.wallBase * hard * (boosting ? DAMAGE.boostMul : 1)
            const parts = front > 0.5
              ? { body: 1, engine: 0.75, cool: 0.8, tires: 0.2 }
              : { body: 1, tires: 0.6, susp: 0.45, engine: 0.15 }
            const dealt = damage(c, amount, parts, 'wall')
            // へこみの位置（車の局所座標）
            const lx = (nx * cy - nz * sy) * -1, lz = -(nx * sy + nz * cy)
            c.dents.push({ x: lx, z: lz, s: Math.min(1, sev / 25) })
            if (c.dents.length > 14) c.dents.shift()
            c.events.push({ t: 'hit', speed: imp, dmg: dealt, x: px - nx * r, y: c.y, z: pz - nz * r, front })
          } else if (imp > 1.5) c.events.push({ t: 'scrape', speed: imp })
          // かすめた角度で少し回る
          c.yaw += (nx * cy - nz * sy) * Math.min(0.4, imp * 0.012) * Math.sign(off)
        }
        c.x += nx * pen; c.z += nz * pen
      }
      if (!hitAny) break
    }
  }
}

// 車同士。前後2つの円どうしで当てる（横から当てると押し出せる、後ろの角に当てるとスピンする）。
// 自分だけを動かす（相手は相手の側で同じ計算をする。オフラインでは全員ここを通る）
function bump(c, o) {
  if (Math.abs(c.y - o.y) > 2) return
  if ((c.x - o.x) ** 2 + (c.z - o.z) ** 2 > 36) return
  const r = PHYS.carRadius
  const cs = Math.sin(c.yaw), cc = Math.cos(c.yaw), os = Math.sin(o.yaw || 0), oc = Math.cos(o.yaw || 0)
  let hit = null
  for (const a of [PHYS.carHalfLen, -PHYS.carHalfLen]) for (const b of [PHYS.carHalfLen, -PHYS.carHalfLen]) {
    const ax = c.x + cs * a, az = c.z + cc * a, bx = o.x + os * b, bz = o.z + oc * b
    const dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz)
    if (d < r * 2 && (!hit || d < hit.d)) hit = { d, dx, dz, a }
  }
  if (!hit || hit.d < 1e-4) return
  const nx = hit.dx / hit.d, nz = hit.dz / hit.d
  const rv = (c.vx - (o.vx || 0)) * nx + (c.vz - (o.vz || 0)) * nz
  if (rv < 0) {
    const mo = o.stats ? o.stats.mass : 1
    // 一般車は軽く、当たってもほとんど止められない（相手が吹き飛ぶ）
    const share = mo / (c.stats.mass + mo) * (o.traffic ? 0.35 : 1)
    // 少し弾む（1.0 なら止まるだけ）。重い相手ほど自分が飛ばされる
    c.vx -= nx * rv * 1.6 * share; c.vz -= nz * rv * 1.6 * share
    // 当たった位置が前後の端なら回される
    c.yaw += Math.sign(hit.a) * (nx * cc - nz * cs) * Math.min(0.5, -rv * 0.03) * share
    const sev = Math.max(0, -rv - 6)
    // 犯人に突っ込まれた警察車（ramTaken）は余計に壊れる。先に動いた側が跳ね返るので、
    // 相手をこの場で動かす場合（オフライン・サーバーのCPU）は突っ込んだ側の計算で相手に入れ、通信で来る相手（remote）のときだけ自分の側で入れる
    const into = (o.vx || 0) * nx + (o.vz || 0) * nz, mine = -(c.vx * nx + c.vz * nz)
    const base = Math.pow(sev, 1.3) * DAMAGE.wallBase * DAMAGE.carHit
    const ram = c.ramTaken && o.remote && o.role && o.role !== c.role && into > mine ? c.ramTaken : 1
    if (sev > 0) damage(c, base * (o.traffic ? 0.3 : 1) * ram, { body: 1, tires: 0.3 }, 'car')
    if (sev > 0 && o.ramTaken && !o.remote && !o.wreck && o.role && o.role !== c.role && mine > into) {
      o.lastHitBy = c.id; o.lastHitAt = o.t
      damage(o, base * (o.ramTaken - 1), { body: 1, tires: 0.3 }, 'car')
    }
    // ノックダウン: 自分より速い相手に強く当てられたらスピンして脱落（すぐ近くで復帰）
    const so = Math.hypot(o.vx || 0, o.vz || 0), sc = speedOf(c)
    if (-rv > 12 && so > sc + 5 && !c.wreck) {
      c.lastHitBy = o.id; c.lastHitAt = c.t
      c.wreck = GAME.knockSec
      c.knock = true
      c.events.push({ t: 'wreck', kind: 'knock' })
    }
    if (-rv > 3) c.events.push({ t: 'carhit', speed: -rv, other: o.id, x: c.x - nx * r, y: c.y, z: c.z - nz * r })
    c.lastHitBy = o.id; c.lastHitAt = c.t
  }
  const push = (r * 2 - hit.d) * 0.5
  c.x += nx * push; c.z += nz * push
}

// ネット送信・保存用（数値を丸める）
export function packCar(c) {
  const r = (v, k = 100) => Math.round(v * k) / k
  return {
    id: c.id, x: r(c.x), y: r(c.y), z: r(c.z), vx: r(c.vx), vy: r(c.vy), vz: r(c.vz),
    yaw: r(c.yaw, 1000), pitch: r(c.pitch, 1000), roll: r(c.roll, 1000),
    b: c.boosting ? 1 : 0, g: c.grounded ? 1 : 0, w: c.wreck > 0 ? 1 : 0, k: c.knock ? 1 : 0,
    d: [c.dmg.body, c.dmg.engine, c.dmg.tires, c.dmg.susp, c.dmg.cool].map(v => r(v)),
    boost: r(c.boost), heat: r(c.heat)
  }
}

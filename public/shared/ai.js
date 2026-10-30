// CPU の運転手。走行線を先読みで追い、曲がり角の手前で減速し、ジャンプの前はブーストを溜めて使う。
// オフラインの対戦相手と、コースが走り切れるかの自動検証の両方に使う。

import { speedOf } from './physics.js'

const clamp = (v, a, b) => v < a ? a : v > b ? b : v

// 区間ごとにルートを選んで1本の走行線にする。rng は 0..1 を返す関数、bold は 0..1（無茶をする度合い）
export function planRoute(world, rng, bold = 0.5, force = null) {
  const pts = [], picks = [], boostZones = []
  const laps = world.laps || 1
  const seq = []
  for (let l = 0; l < laps; l++) world.routes.forEach((opts, si) => seq.push([opts, si]))
  seq.forEach(([opts, si]) => {
    let o
    if (force && force[si]) o = opts.find(r => r.id === force[si])
    if (!o) {
      const w = opts.map(r => Math.max(0.05, 1 - Math.abs(r.risk - bold) * 1.6))
      let t = rng() * w.reduce((a, b) => a + b, 0)
      o = opts[opts.length - 1]
      for (let i = 0; i < opts.length; i++) { t -= w[i]; if (t <= 0) { o = opts[i]; break } }
    }
    picks.push(o.id)
    const start = pts.length
    for (const p of o.pts) {
      const last = pts[pts.length - 1]
      if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 1) continue
      pts.push(p)
    }
    if (o.need === 'boost') boostZones.push({ from: o.boostFrom, to: o.pts[o.pts.length - 2][1], i0: start, need: true })
  })
  return { pts: densify(pts, 6), picks, boostZones }
}

// 曲がり角の速度を付けながら細かく刻む
export function densify(pts, step) {
  const out = []
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1]
    const L = Math.hypot(bx - ax, bz - az)
    const n = Math.max(1, Math.ceil(L / step))
    for (let k = 0; k < n; k++) out.push({ x: ax + (bx - ax) * k / n, z: az + (bz - az) * k / n })
  }
  const l = pts[pts.length - 1]
  out.push({ x: l[0], z: l[1] })
  // 各点の曲がり具合から、その点での目標速度
  for (let i = 0; i < out.length; i++) {
    let curv = 0
    for (const k of [2, 4]) {
      const a = out[Math.max(0, i - k)], b = out[i], c = out[Math.min(out.length - 1, i + k)]
      const h1 = Math.atan2(b.x - a.x, b.z - a.z), h2 = Math.atan2(c.x - b.x, c.z - b.z)
      let dh = Math.abs(h2 - h1); if (dh > Math.PI) dh = 2 * Math.PI - dh
      const span = Math.max(1, Math.hypot(b.x - a.x, b.z - a.z) + Math.hypot(c.x - b.x, c.z - b.z))
      curv = Math.max(curv, dh / span)      // 1/半径
    }
    out[i].vmax = curv < 1e-3 ? 99 : Math.sqrt(12 / curv) // 横Gを 12m/s^2 まで
  }
  return out
}

export function createDriver(world, car, plan, skill = 0.9) {
  // 失敗したら安全なルート（全部 A）に切り替える
  const safe = planRoute(world, () => 0, 0, world.routes.map(() => 'A'))
  return { plan, safe, idx: 0, stuck: 0, reverse: 0, skill, car, fails: 0, wasFrozen: false }
}

export function drive(dr, world, others = null) {
  const c = dr.car, P = dr.plan.pts
  const inp = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, pitch: 0, roll: 0, respawn: false, ai: true }
  if (c.wreck > 0 || c.freeze > 0) {
    if (!dr.wasFrozen) {
      dr.fails++
      if (dr.fails >= 2 && dr.plan !== dr.safe) { dr.plan = dr.safe; dr.idx = 0 }
    }
    dr.wasFrozen = true
    return inp
  }
  dr.wasFrozen = false

  // 今いる場所に最も近い点（前へだけ進める。リスポーン後は戻ることがある）
  let best = dr.idx, bd = 1e9
  const from = Math.max(0, dr.idx - 30), to = Math.min(P.length - 1, dr.idx + 30)
  for (let i = from; i <= to; i++) {
    const d = (P[i].x - c.x) ** 2 + (P[i].z - c.z) ** 2
    if (d < bd) { bd = d; best = i }
  }
  if (Math.sqrt(bd) > 40 || dr.idx === 0) {
    // 大きく外れた（リスポーン等）。全体から探し直す
    for (let i = 0; i < P.length; i++) {
      const d = (P[i].x - c.x) ** 2 + (P[i].z - c.z) ** 2
      if (d < bd) { bd = d; best = i }
    }
  }
  dr.idx = best

  const v = speedOf(c)
  const look = 4.5 + v * 0.38
  let ti = best, acc = 0
  while (ti < P.length - 1 && acc < look) { acc += Math.hypot(P[ti + 1].x - P[ti].x, P[ti + 1].z - P[ti].z); ti++ }
  const tgt = P[ti]
  const dx = tgt.x - c.x, dz = tgt.z - c.z
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw)
  const rx = -Math.cos(c.yaw), rz = Math.sin(c.yaw)
  const side = (dx * rx + dz * rz) / (Math.hypot(dx, dz) || 1)
  const ahead = (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1)
  let ang = Math.atan2(side, ahead)

  // 先の曲がり角に合わせた目標速度（止まれる距離を見る）
  let vt = 99, dist = 0
  for (let i = best; i < Math.min(P.length - 1, best + 40); i++) {
    const allow = Math.sqrt(P[i].vmax ** 2 + 2 * 20 * dist)
    if (allow < vt) vt = allow
    dist += Math.hypot(P[i + 1].x - P[i].x, P[i + 1].z - P[i].z)
  }
  vt *= 0.92 + 0.08 * dr.skill
  // 傷んだ車は曲がり角を手前から遅く
  vt *= 0.55 + 0.45 * Math.min(c.dmg.tires, c.dmg.susp)

  // ブースト: 必要な区間は手前で温存し、区間に入ったら全開
  // ブーストが足りないまま跳ぶ区間に来たら、安全なルートへ逃げる
  const pending = dr.plan.boostZones.find(zz => c.z < zz.from && c.z > zz.from - 40)
  if (pending && c.boost < 0.45 && dr.plan !== dr.safe) { dr.plan = dr.safe; dr.idx = 0; return inp }
  const zone = dr.plan.boostZones.find(zz => c.z >= zz.from - 1 && c.z <= zz.to && Math.abs(best - zz.i0) < 400)
  const saving = dr.plan.boostZones.some(zz => c.z < zz.from && c.z > zz.from - 220)
  let boost = false
  if (zone) boost = true
  else if (!saving && c.boost > 0.55 && Math.abs(ang) < 0.08 && vt > 60 && c.grounded) boost = true
  if (c.overheat || c.heat > 0.8 && !zone) boost = false

  inp.steer = clamp(ang * 2.4, -1, 1)
  // 体当たりする CPU: 横や斜め前に人の車がいれば寄せていく
  if (dr.aggr && others && c.grounded && v > 15) {
    for (const o of others) {
      if (o === c || o.bot || o.traffic || o.wreck) continue
      const dx = o.x - c.x, dz = o.z - c.z
      const fwd = dx * fx + dz * fz, lat = dx * rx + dz * rz
      if (fwd > -3 && fwd < 9 && Math.abs(lat) < 6 && Math.abs(lat) > 0.5) { inp.steer = clamp(inp.steer + Math.sign(lat) * 0.45 * dr.aggr, -1, 1); break }
    }
  }
  if (v > vt + 2) { inp.brake = clamp((v - vt) / 6, 0.3, 1) } else inp.throttle = 1
  if (Math.abs(ang) > 0.7 && v > 14) inp.handbrake = true
  inp.boost = boost && !inp.brake
  // 空中は軌道に任せる（自動で鼻先が軌道を向く）。横に傾いていれば戻す
  if (!c.grounded) { inp.roll = clamp(-c.roll * 2, -1, 1) * 0.6; inp.steer = 0 }

  // はまった: バックして、それでも駄目ならリスポーン
  if (dr.reverse > 0) {
    dr.reverse -= 1 / 60
    inp.throttle = 0; inp.brake = 1; inp.steer = -inp.steer; inp.boost = false
  } else if (v < 2 && c.grounded) {
    dr.stuck += 1 / 60
    if (dr.stuck > 1.6) { dr.reverse = 1.2; dr.stuck = 0; dr.unstuck = (dr.unstuck || 0) + 1 }
  } else { dr.stuck = Math.max(0, dr.stuck - 1 / 60); if (v > 8) dr.unstuck = 0 }
  // 道から大きく外れたまま（体当たりで路地に押し込まれた等）も、走行線の上に戻す
  if (Math.sqrt(bd) > 22) dr.lost = (dr.lost || 0) + 1 / 60; else dr.lost = 0
  if ((dr.unstuck || 0) >= 3 || dr.lost > 3) {
    inp.respawn = true; dr.unstuck = 0; dr.lost = 0
    const i = Math.min(P.length - 2, best + 3)
    c.respawnPoint = { x: P[i].x, z: P[i].z, yaw: Math.atan2(P[i + 1].x - P[i].x, P[i + 1].z - P[i].z), y: world.groundAt(P[i].x, P[i].z, 50).h }
    c.safeHist = [] // 復帰は覚えていた位置でなく走行線の上へ
  }
  return inp
}

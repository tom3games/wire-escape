// 一般車。街の通りを両方向に走る（左側通行。対向車線にも車がいる）。
// 位置はレース時刻だけで決まる（どの画面でも同じ所にいる）。通りの端まで行くと反対の端から出てくる（端は外周のビルの中）。
// レースの車に当てられると軽く吹き飛び、数秒後に元の流れへ戻る（吹き飛び方は各画面だけの演出）。
// 2026-10-26 本人「普通に走ってる車が重すぎる」: 軽くして（質量 1.3→0.35、ゆっくり当てても飛ぶ）、
// 台数を減らし（230m に1台→340m に1台）、遠くの車は高さの計算を省く（近くの車だけ毎回きちんと置く）。
import { PHYS } from './config.js'

export function createTraffic(world) {
  const cars = []
  const lines = []
  // 幅 18m 以上の真っすぐな通り（路地は走らない）
  for (const r of world.roads) {
    if (r.w < 18 || r.pts.length !== 2) continue
    const [[ax, az], [bx, bz]] = r.pts
    const L = Math.hypot(bx - ax, bz - az)
    if (L < 60) continue
    const dx = (bx - ax) / L, dz = (bz - az) / L
    // 片側の車線の中心。大通り（28m）は片側2車線
    const lanes = r.w >= 28 ? [3.6, 10] : [4.4]
    for (const dir of [1, -1]) for (const lane of lanes) lines.push({ ax, az, dx, dz, L, dir, lane })
  }
  lines.forEach((ln, li) => {
    const n = Math.max(1, Math.round(ln.L / 340))
    for (let k = 0; k < n; k++) {
      const kind = ['sedan', 'van', 'taxi', 'sedan', 'sedan', 'van', 'sedan'][(li * 3 + k) % 7]
      cars.push({
        id: `t${li}_${k}`, traffic: true, line: ln, phase: ln.L * (k + (li % 3) * 0.33) / n, speed: 10 + ((li * 7 + k * 3) % 6),
        x: 0, y: PHYS.rideHeight, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, roll: 0, grounded: true, wreck: 0, stats: { mass: 0.35 }, knocked: 0, far: false,
        kind, color: kind === 'taxi' ? 0xf2c230 : [0xe9e9e9, 0x2b2e33, 0xb8bcc2, 0x2f5f9a, 0xd8d2c0, 0x8b0f14][(li + k) % 6]
      })
    }
  })

  function place(c, t, exact = true) {
    const ln = c.line
    let s = (c.phase + t * c.speed) % ln.L
    if (ln.dir < 0) s = ln.L - s
    const fx = ln.dx * ln.dir, fz = ln.dz * ln.dir
    // 左 = 進む向きを左へ 90 度（日本は左側通行）
    const lx = fz, lz = -fx
    c.x = ln.ax + ln.dx * s + lx * ln.lane
    c.z = ln.az + ln.dz * s + lz * ln.lane
    // 地面の高さ（橋・ジャンプ台）は重いので、近くの車だけ調べる。遠くは平らな道の高さ
    c.y = (exact ? world.groundAt(c.x, c.z, 5).h : 0) + PHYS.rideHeight
    c.far = !exact
    c.vx = fx * c.speed; c.vz = fz * c.speed; c.vy = 0
    c.yaw = Math.atan2(fx, fz)
    c.pitch = 0; c.roll = 0
  }

  // near: 近くを見る点の一覧 [[x,z], ...]（レースの車やカメラ）。これから 260m 以内の車だけ正確に置く
  const NEAR2 = 260 * 260
  return {
    cars,
    update(t, dt, near = null) {
      for (const c of cars) {
        if (c.knocked > 0) {
          c.knocked -= dt
          c.vy -= 22 * dt
          c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt
          c.yaw += c.spin * dt; c.roll += c.spin * 0.6 * dt
          const g = world.groundAt(c.x, c.z, c.y).h + PHYS.rideHeight
          if (c.y < g) { c.y = g; c.vy = Math.abs(c.vy) * 0.3; c.vx *= 0.7; c.vz *= 0.7; c.spin *= 0.6 }
          if (c.knocked <= 0) { c.roll = 0; place(c, t) }
          continue
        }
        if (near) {
          // 置いてから近いか調べ、近ければ高さを正確に（置き直しは軽い）
          place(c, Math.max(0, t), false)
          let close = false
          for (const p of near) if ((p[0] - c.x) ** 2 + (p[1] - c.z) ** 2 < NEAR2) { close = true; break }
          if (close) c.y = world.groundAt(c.x, c.z, 5).h + PHYS.rideHeight, c.far = false
        } else place(c, Math.max(0, t))
      }
    },
    // レースの車が当たったら吹き飛ばす。当てた車に返す（演出・ニトロ用）
    hitBy(racer) {
      for (const c of cars) {
        if (c.knocked > 0) continue
        const dx = c.x - racer.x, dz = c.z - racer.z
        if (dx * dx + dz * dz > 36 || Math.abs(c.y - racer.y) > 2) continue
        // 車は前後に長いので、前と後ろの2つの円どうしで当たりを見る（追突も横から当てるのも拾う）
        let touch = false
        const rs = Math.sin(racer.yaw), rc = Math.cos(racer.yaw), cs = Math.sin(c.yaw), cc = Math.cos(c.yaw)
        for (const a of [1.2, -1.2]) for (const b of [1.2, -1.2]) {
          if ((racer.x + rs * a - c.x - cs * b) ** 2 + (racer.z + rc * a - c.z - cc * b) ** 2 < 2.75 * 2.75) touch = true
        }
        if (!touch) continue
        const rel = Math.hypot(racer.vx - c.vx, racer.vz - c.vz)
        // 軽いので、ゆっくり当てても押しのけられ、速く当てると大きく飛ぶ。
        // 同じ速さで後ろにくっついたまま（rel が小さい）でも、横へどかす（後ろに詰まって進めない、が無いように）
        const d = Math.hypot(dx, dz) || 1
        c.knocked = rel < 2.5 ? 2 : 3.2
        const side = rel < 2.5 ? 7 : 2.5
        c.vx = racer.vx * 1.05 + dx / d * side; c.vz = racer.vz * 1.05 + dz / d * side; c.vy = rel < 2.5 ? 2.5 : 4 + rel * 0.22
        c.spin = (Math.random() - 0.5) * 8
        return { car: c, rel }
      }
      return null
    }
  }
}

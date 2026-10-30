// 通行人（2026-10-30 本人「通行人も用意。たまにタックルしてきたりする。隠密行動もできるが、目撃されて叫んで警察呼ぶことも」）。
// three.js に依存しない。人の犯人のまわり（約170m）の歩道だけを歩かせ、離れた人は近くへ置き直す。
//
// 目撃: 通行人の前（左右 60 度）・25m 以内・建物で隠れていない所に人がいて、目立つ動き（走る・スイング・壁登り・空中）を
//       していると「気づき」がたまる。しゃがみ歩き（隠密）なら 8m 以内でじっと見られたときだけ、ゆっくりたまる。
//       たまり切ると叫んで逃げ、少しあとに通報する（警察に位置が伝わる。3回で手配度が1上がる）
// タックル: 勇気のある人（約15%）は、地上で近くにいる人に向かって走ってきて、当たるとよろけさせる。跳べばかわせる

import { blocked } from './runner.js'

export const PED = {
  count: 50,
  range: 170,          // これより離れた人は置き直す
  placeMin: 45,        // 置き直すときの距離（見えている所の目の前に急に湧かない）
  walk: 1.3, flee: 4.5, charge: 6.2,
  sight: 25, sneakSight: 8, fov: Math.cos(60 * Math.PI / 180),
  notice: 0.6,         // 目立つ動きを見て叫ぶまでの秒数
  sneakNotice: 2.5,    // しゃがみ歩きを近くで見て叫ぶまで
  callDelay: 1.5,      // 叫んでから通報まで
  braveRate: 0.15, tackleRange: 7, tackleHit: 1.0, tackleCd: 6,
  callsPerHeat: 3,
  screamCd: 20,        // 同じ人がまた叫べるまで
  callMerge: 6,        // この秒数以内の通報は1回と数える（スイングで見た人が次々に叫んでも手配度が一気に上がらない）
  highUp: 10           // 通行人よりこれ以上高い所は見上げにくい（気づくまで倍、見える距離 6 割）
}

export function createPeds(ch) {
  const world = ch.world, rng = ch.rng
  // 歩道の線: 道の両側、道幅の半分 + 2m
  const walks = []
  for (const sg of world.segs) {
    if (sg.surf !== 'road' || sg.hw < 6) continue
    const dx = sg.bx - sg.ax, dz = sg.bz - sg.az, L = Math.hypot(dx, dz)
    if (L < 20) continue
    const ux = dx / L, uz = dz / L, nx = -uz, nz = ux
    for (const s of [-1, 1]) {
      const off = sg.hw + 2.1
      walks.push({ ax: sg.ax + nx * off * s, az: sg.az + nz * off * s, ux, uz, L })
    }
  }
  const peds = []
  for (let i = 0; i < PED.count; i++) peds.push({ id: i, x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, state: 'off', w: null, u: 0, dir: 1, sus: 0, t: 0, brave: rng() < PED.braveRate, color: Math.floor(rng() * 8), cd: 0, look: 0 })
  const P = { list: peds, walks, calls: 0, alive: 0 }

  const okSpot = (x, z) => {
    const g = world.groundAt(x, z, 2)
    if (g.h < -0.3 || g.h > 1.5) return false
    for (const o of world.nearby(x, z)) {
      if (o.def || o.slab || o.y1 == null) continue
      const c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0), dx = x - o.cx, dz = z - o.cz
      if (Math.abs(dx * c - dz * s) < o.hw + 0.5 && Math.abs(dx * s + dz * c) < o.hl + 0.5) return false
    }
    return true
  }
  const place = (p, r, first) => {
    for (let k = 0; k < 12; k++) {
      const w = walks[Math.floor(rng() * walks.length)]
      const u = rng() * w.L
      const x = w.ax + w.ux * u, z = w.az + w.uz * u
      const d = Math.hypot(x - r.x, z - r.z)
      if (d > PED.range - 10 || (!first && d < PED.placeMin) || !okSpot(x, z)) continue
      Object.assign(p, { x, z, y: world.groundAt(x, z, 2).h, w, u, dir: rng() < 0.5 ? 1 : -1, state: 'walk', sus: 0, t: 0, cd: 0 })
      p.yaw = Math.atan2(w.ux * p.dir, w.uz * p.dir)
      return true
    }
    p.state = 'off'
    return false
  }

  P.update = (dt, rob) => {
    const r = rob.car
    const conspicuous = !r.sneaking && (Math.hypot(r.vx, r.vz) > 4.5 || !!r.rope || !!r.climbing || (!r.grounded && r.y - r.groundY > 1.2))
    let alive = 0
    for (const p of peds) {
      if (p.state === 'off' || Math.hypot(p.x - r.x, p.z - r.z) > PED.range) { if (!place(p, r, p.state === 'off' && ch.t < 1)) continue }
      alive++
      p.t += dt
      p.cd = Math.max(0, p.cd - dt)
      const dx = r.x - p.x, dz = r.z - p.z, d = Math.hypot(dx, dz)
      // ---- 動き
      if (p.state === 'walk') {
        p.u += p.dir * PED.walk * dt
        if (p.u < 0 || p.u > p.w.L) { p.dir *= -1; p.u = Math.max(0, Math.min(p.w.L, p.u)) }
        p.x = p.w.ax + p.w.ux * p.u; p.z = p.w.az + p.w.uz * p.u
        p.yaw = Math.atan2(p.w.ux * p.dir, p.w.uz * p.dir)
        p.vx = p.w.ux * p.dir * PED.walk; p.vz = p.w.uz * p.dir * PED.walk
      } else if (p.state === 'scream' || p.state === 'flee') {
        // 人から離れる向きへ走る（歩道の線から少し外れてもよい。建物には入らない）
        const k = d > 0.1 ? 1 / d : 0
        const nx = p.x - dx * k * PED.flee * dt, nz = p.z - dz * k * PED.flee * dt
        if (okSpot(nx, nz)) { p.x = nx; p.z = nz }
        p.yaw = Math.atan2(-dx, -dz)
        if (p.state === 'scream' && p.t >= PED.callDelay) {
          p.state = 'flee'; p.t = 0; p.cd = PED.screamCd
          // 近い時間の通報はまとめて1回と数える
          const fresh = ch.t - (P.lastCall ?? -99) >= PED.callMerge
          P.lastCall = ch.t
          if (fresh) P.calls++
          ch.witnessCall(rob, p, P.calls, fresh)
        }
        if (p.state === 'flee' && p.t > 8) { p.state = 'walk'; p.sus = 0 }
      } else if (p.state === 'charge') {
        if (d > PED.tackleRange * 2 || !r.grounded || r.wreck > 0) { p.state = 'walk'; p.sus = 0 }
        else {
          const k = 1 / Math.max(0.1, d)
          const nx = p.x + dx * k * PED.charge * dt, nz = p.z + dz * k * PED.charge * dt
          if (okSpot(nx, nz) || d < 3) { p.x = nx; p.z = nz }
          p.yaw = Math.atan2(dx, dz)
          if (d < PED.tackleHit && Math.abs(r.y - p.y) < 1.2 && !(r.stun > 0)) {
            ch.tackled(rob, p)
            p.state = 'down'; p.t = 0; p.cd = PED.tackleCd
          }
        }
      } else if (p.state === 'down') {
        if (p.t > 2.2) { p.state = 'walk'; p.sus = 0; p.t = 0 }
      }
      // ---- 目撃（歩いている人だけ。近い人だけ見通しを調べる）
      if (p.state === 'walk' && d < PED.sight && !(r.wreck > 0)) {
        const fwd = (dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw)) / Math.max(0.1, d)
        const see = (fwd > PED.fov || d < 2.5)
        const high = r.y - p.y > PED.highUp
        const range = (conspicuous ? PED.sight : PED.sneakSight) * (high ? 0.6 : 1)
        let visible = false
        if (see && d < range) {
          p.look -= dt
          if (p.look <= 0) { p.look = 0.12; p.vis = !blocked(world, p.x, p.y + 1.6, p.z, r.x, r.y + 1.2, r.z) }
          visible = p.vis
        }
        if (visible && p.cd <= 0) p.sus += dt / ((conspicuous ? PED.notice : PED.sneakNotice) * (high ? 2 : 1))
        else p.sus = Math.max(0, p.sus - dt * 0.5)
        // 勇気のある人: 地上で近いとタックルしに来る
        if (visible && p.brave && p.cd <= 0 && r.grounded && d < PED.tackleRange && Math.abs(r.y - p.y) < 1) { p.state = 'charge'; p.t = 0; ch.events.push({ t: 'charge', id: p.id, x: p.x, y: p.y, z: p.z }) }
        else if (p.sus >= 1) {
          p.state = 'scream'; p.t = 0
          ch.events.push({ t: 'scream', id: p.id, x: p.x, y: p.y, z: p.z })
        }
      } else if (p.state === 'walk') p.sus = Math.max(0, p.sus - dt * 0.5)
    }
    P.alive = alive
    // 今いちばん気づきかけている人（画面の目のマーク用）
    let top = 0
    for (const p of peds) if (p.state === 'walk' && p.sus > top) top = p.sus
    P.watch = top
  }
  return P
}

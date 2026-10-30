// ワイヤーで飛ぶ人間（犯人）の動き。three.js に依存しないので、画面と検証で同じものが動く。固定ステップで呼ぶこと。
//
// 操作（入力は車と同じ形で受ける）
//   throttle  前へ走る / スイング中は前へこぐ
//   brake     止まる・後ろへ下がる
//   steer     向きを変える（+ で右）
//   jump      跳ぶ（地面にいるとき。壁に向かって走ると駆け上がる）
//   wire      ワイヤー。押すたびに 掛ける / 外す（掛ける所は前の上の建物。地面にいれば跳んでから掛ける）
//   boost     巻き取り。ワイヤー中に押している間、掛けた点へ引き寄せられ、着く前に外れて前へ飛び出す
//   wireAt    狙った点 {x,y,z}（画面をタッチ・クリックした所の建物）。無ければ前の上を自動で探す
// ガスやゲージは無い。ワイヤー1本で動く
//
// 座標は車と同じ（x=東西, z=南北, yaw=0 で +z を向く）。y は足の高さ。
// 体力は dmg.body（車と同じ名前にして、警察と犯人の判定 chase.js をそのまま使う）

import { GAME } from './config.js'

export const RUN = {
  radius: 0.42, height: 1.75,
  walk: 10,          // 走る速さ（m/s）
  back: 4,
  accel: 38, airAccel: 9,
  turn: 3.4, airTurn: 1.8,      // 向きを変える速さ（rad/s）
  gravity: 21,
  jump: 8.6,
  coyote: 0.12,                 // 地面を離れてもまだ跳べる時間
  stepUp: 1.3,                  // これ以下の段差（柵など）は乗り越える
  climb: 11,                    // 壁を駆け上がる速さ
  wireRange: 85,                // ワイヤーが届く距離
  wireMinUp: 3,                 // 掛ける点は自分よりこれ以上高い所
  pump: 13,                     // スイング中に前へこぐ力
  steerAssist: 2.2,             // スイング中、横へ流れる速さを向いている方へ寄せる（毎秒の割合）
  reel: 0.8,                    // スイングの下で自動で巻き取る速さ（m/s）
  minRope: 6,
  swingLow: 6,                  // 振り子の一番下の、地面からの高さ
  zip: 32,                      // 巻き取りの最高速（m/s）
  zipAcc: 48,                   // 巻き取りの加速
  zipCd: 1,                     // （使っていない。表示の割り算用）
  zipExit: 9,                   // 巻き取りの終わりに前と上へ飛び出す速さ
  maxSpeed: 38,
  releaseVyMax: 9,              // 外した瞬間の上向きの速さの上限（振るたびに空へ昇り続けないように）
  drag: 0.012,
  releaseKick: 1.2,             // ワイヤーを外した瞬間に上へ少し跳ねる
  downSec: 3.2,                 // 体力が尽きて倒れている時間
  waterY: -1.2,                 // 運河に落ちたらこれより下
  hitSpeed: 7,                  // 車とこれより速くぶつかると、はね飛ばされる
  stompVy: 7,                   // これより速く落ちて車の屋根に当たると踏みつけ
  stompBounce: 11,              // 踏みつけで跳ね返る速さ
  hideCombo: 6,                 // 地面に着かずにワイヤーをこの数つなぐと、警察が見失う
  hideCd: 20,                   // 見失わせたあと、次に使えるまでの秒数
  hideSec: 4,                   // 見失う秒数
  sneak: 2.6,                   // しゃがみ歩きの速さ（隠密。通行人に気づかれにくい）
  netSec: 2.6,                  // 捕獲ネットに捕まって動けない秒数
  netMash: 0.12,                // 連打1回で縮む秒数（1秒に7回押して約1.4秒で抜ける）
  pitSec: 2.2,                  // 落とし穴からはい上がるまで
  pitMash: 0.15,                // ジャンプ連打1回で縮む秒数（ワイヤーを掛ければすぐ出られる）
  pitDepth: 2.2
}

const clamp = (v, a, b) => v < a ? a : v > b ? b : v

export function createRunner({ id, name = '', spawn, paint = null, bot = false }) {
  return {
    id, name, bot, isRunner: true, carId: 'runner', paint, levels: {},
    stats: { durability: 1, maxSpeed: RUN.maxSpeed, boostCap: 1, mass: 0.2 },
    x: spawn.x, y: spawn.y || 0, z: spawn.z, vx: 0, vy: 0, vz: 0,
    yaw: spawn.yaw || 0, pitch: 0, roll: 0, wp: 0, wr: 0,
    grounded: true, airTime: 0, lastAir: 0, surf: 'road', coyote: 0,
    boost: 0, boostLock: false, boosting: false, heat: 0, overheat: false, zipCd: 0, zipping: false, zipPrev: false,
    dmg: { body: 1, engine: 1, tires: 1, susp: 1, cool: 1 },
    dents: [], flat: false,
    wreck: 0, freeze: 0, stun: 0, falling: false, knock: false,
    respawnPoint: { x: spawn.x, y: spawn.y || 0, z: spawn.z, yaw: spawn.yaw || 0 },
    safeHist: [], safeT: 0,
    rope: null, wirePrev: false, jumpPrev: false, combo: 0, swings: 0,
    climbing: null, onRoof: false, roofTime: 0, groundY: 0, net: 0, pit: 0, pitAt: null, sneaking: false, sneakPrev: false,
    breaks: 0, maxAir: 0, t: 0, drifting: false, slip: 0, repairing: false,
    events: []
  }
}

export function speedOf(c) { return Math.hypot(c.vx, c.vz) }

// 当たる箱（建物・柵・噴水・外周）。壊せる小物（街灯・木）はすり抜ける
function solids(world, x, z) {
  return world.nearby(x, z).filter(o => !o.def && !o.slab && o.y1 != null)
}
function local(o, x, z) {
  const c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0)
  const dx = x - o.cx, dz = z - o.cz
  return { u: dx * c - dz * s, v: dx * s + dz * c, c, s }
}

// 足元の高さ（地面・橋・建物の屋上）。y より少し上までの面だけを見る
export function floorAt(world, x, z, y) {
  let h = world.groundAt(x, z, y + 0.5).h
  let roof = null
  for (const o of solids(world, x, z)) {
    if (o.y1 > y + 0.6 || o.y1 <= h) continue
    const p = local(o, x, z)
    if (Math.abs(p.u) <= o.hw + 0.15 && Math.abs(p.v) <= o.hl + 0.15) { h = o.y1; roof = o }
  }
  return { h, roof }
}

// 線と箱の交わり（箱の向きにそろえて、3つの軸の幅で切る）。当たれば t（0〜len）を返す
function rayBox(o, ox, oy, oz, dx, dy, dz, len) {
  const c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0)
  const px = (ox - o.cx) * c - (oz - o.cz) * s, pz = (ox - o.cx) * s + (oz - o.cz) * c
  const qx = dx * c - dz * s, qz = dx * s + dz * c
  let t0 = 0, t1 = len
  for (const [p, d, lo, hi] of [[px, qx, -o.hw, o.hw], [oy, dy, o.y0, o.y1], [pz, qz, -o.hl, o.hl]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return -1; continue }
    let a = (lo - p) / d, b = (hi - p) / d
    if (a > b) { const tmp = a; a = b; b = tmp }
    if (a > t0) t0 = a
    if (b < t1) t1 = b
    if (t0 > t1) return -1
  }
  return t0
}

// ワイヤーを掛けられる建物（背の高い箱）。毎回全部は見ないよう、世界ごとに一度だけ集める
function anchorBoxes(world) {
  if (!world._anchorBoxes) world._anchorBoxes = world.colliders.filter(o => !o.slab && o.y1 != null && o.y1 - o.y0 > 6 && (o.kind === 'building' || o.kind === 'bound'))
  return world._anchorBoxes
}

// 画面をタッチ・クリックした向きの線が最初に当たる建物の点（ワイヤーの狙い）。当たらなければ null
export function rayHit(world, ox, oy, oz, dx, dy, dz, len = 400) {
  let best = -1
  for (const o of anchorBoxes(world)) {
    const t = rayBox(o, ox, oy, oz, dx, dy, dz, len)
    if (t > 0 && (best < 0 || t < best)) best = t
  }
  return best < 0 ? null : { x: ox + dx * best, y: oy + dy * best, z: oz + dz * best }
}

// 2点の間に建物があるか（3D）。拳銃とヘリの見通しに使う
export function blocked(world, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz)
  if (L < 0.01) return false
  for (const o of anchorBoxes(world)) {
    const r = Math.max(o.hw, o.hl) * 1.5
    if (o.cx + r < Math.min(ax, bx) || o.cx - r > Math.max(ax, bx) || o.cz + r < Math.min(az, bz) || o.cz - r > Math.max(az, bz)) continue
    const t = rayBox(o, ax, ay, az, dx / L, dy / L, dz / L, L)
    if (t >= 0 && t < L - 0.6) return true
  }
  return false
}

// ワイヤーを掛ける点を探す。前（進む向き寄り）の、斜め上の建物の面
// 狙う角度を何本か試して、前向き・ほどよい高さ・近すぎないものを選ぶ
const PITCHES = [58, 48, 68, 40, 76, 32]
const YAWS = [0, 18, -18, 36, -36, 54, -54, 70, -70, 84, -84]
export function findAnchor(world, r) {
  const v = Math.hypot(r.vx, r.vz)
  let hx = Math.sin(r.yaw), hz = Math.cos(r.yaw)
  if (v > 6) { const k = 0.45; hx = hx * (1 - k) + r.vx / v * k; hz = hz * (1 - k) + r.vz / v * k; const l = Math.hypot(hx, hz); hx /= l; hz /= l }
  const ox = r.x, oy = r.y + 1.5, oz = r.z
  const boxes = anchorBoxes(world)
  const near = boxes.filter(o => Math.abs(o.cx - ox) < RUN.wireRange + o.hw && Math.abs(o.cz - oz) < RUN.wireRange + o.hl && o.y1 > oy + RUN.wireMinUp)
  let best = null, bs = -1e9
  for (const yo of YAWS) {
    const a = Math.atan2(hx, hz) + yo * Math.PI / 180
    const fx = Math.sin(a), fz = Math.cos(a)
    for (const pd of PITCHES) {
      const p = pd * Math.PI / 180
      const dx = fx * Math.cos(p), dy = Math.sin(p), dz = fz * Math.cos(p)
      let tHit = -1
      for (const o of near) {
        const t = rayBox(o, ox, oy, oz, dx, dy, dz, RUN.wireRange)
        if (t > 0 && (tHit < 0 || t < tHit)) tHit = t
      }
      if (tHit < 0) continue
      const ay = oy + dy * tHit
      const horiz = tHit * Math.cos(p)
      if (ay < oy + RUN.wireMinUp || horiz < 5) continue
      // 点数: 正面ほど・55度前後ほど・ほどよい長さ（18〜40m）ほど良い。遠すぎるとワイヤーが張らず振れない
      const s = -Math.abs(yo) * 0.012 - Math.abs(pd - 56) * 0.04 - Math.abs(tHit - 28) * 0.05 - (tHit > 55 ? (tHit - 55) * 0.1 : 0)
      if (s > bs) { bs = s; best = { x: ox + dx * tHit, y: ay, z: oz + dz * tHit, len: tHit } }
    }
  }
  return best
}

export function respawnRunner(r, p = null) {
  const h = r.safeHist
  const sp = p || (h.length >= 4 ? h[Math.max(0, h.length - 8)] : r.respawnPoint)
  r.x = sp.x; r.z = sp.z; r.y = sp.y || 0
  r.vx = r.vy = r.vz = 0
  r.yaw = sp.yaw || r.yaw
  r.rope = null; r.climbing = null; r.stun = 0; r.falling = false
  r.grounded = true; r.airTime = 0
  r.freeze = 0.5
  r.safeHist = []
  r.events.push({ t: 'respawn', repair: false })
}

// 1ステップ
export function stepRunner(r, inp, dt, world) {
  r.t += dt
  r.repairing = false
  r.boosting = false
  const ev = r.events

  // 倒れている（体力が尽きた）
  if (r.wreck > 0) {
    r.wreck -= dt
    r.rope = null; r.climbing = null
    physics(r, 0, dt, world, true)
    r.vx *= 0.9; r.vz *= 0.9
    if (r.wreck <= 0) {
      r.wreck = 0
      r.dmg.body = Math.max(r.dmg.body, GAME.wreckRepairTo)
      r.freeze = 0.4
      ev.push({ t: 'respawn', repair: true })
    }
    return
  }
  if (r.freeze > 0) {
    r.freeze -= dt
    r.rope = null
    physics(r, 0, dt, world, true)
    r.vx *= 0.8; r.vz *= 0.8
    return
  }
  if (inp.respawn) { respawnRunner(r); return }

  // 捕獲ネット: ワイヤーが切れて落ち、しばらく動けない。ジャンプかワイヤーの連打で早く抜ける
  const jH = !!inp.jump, wH = !!inp.wire
  const mash = (jH && !r.jumpPrev) || (wH && !r.wirePrev)
  if (r.net > 0) {
    r.jumpPrev = jH; r.wirePrev = wH
    if (mash) { r.net -= RUN.netMash; ev.push({ t: 'struggle' }) }
    r.net -= dt
    r.rope = null; r.climbing = null
    physics(r, 0, dt, world, true)
    if (r.grounded) { r.vx *= 0.85; r.vz *= 0.85 }
    if (r.net <= 0) { r.net = 0; ev.push({ t: 'netFree' }) }
    return
  }
  // 落とし穴: 穴の底でしばらく動けない。ワイヤーを掛ければすぐ出られる。ジャンプ連打でも早まる
  if (r.pit > 0) {
    r.jumpPrev = jH
    const wPress = wH && !r.wirePrev
    r.wirePrev = wH
    r.pit -= dt
    if (jH && mash) { r.pit -= RUN.pitMash; ev.push({ t: 'struggle' }) }
    r.vx = r.vz = 0; r.vy = 0
    r.x = r.pitAt.x + (r.x - r.pitAt.x) * 0.9; r.z = r.pitAt.z + (r.z - r.pitAt.z) * 0.9
    r.y = r.pitAt.y - RUN.pitDepth
    r.grounded = true
    let a = null
    if (wPress) { r.y = r.pitAt.y; a = findAnchor(world, r); r.y = r.pitAt.y - RUN.pitDepth; if (!a) ev.push({ t: 'wireMiss' }) }
    if (a || r.pit <= 0) {
      r.pit = 0
      r.y = r.pitAt.y + 0.1; r.vy = a ? RUN.jump * 1.1 : RUN.jump; r.grounded = false
      if (a) {
        const d = Math.hypot(a.x - r.x, a.y - (r.y + 1.2), a.z - r.z)
        r.rope = { x: a.x, y: a.y, z: a.z, len: Math.max(RUN.minRope, d * 0.9), t: 0 }
        r.combo = 1
        ev.push({ t: 'wire', x: a.x, y: a.y, z: a.z, combo: 1 })
      }
      ev.push({ t: 'pitOut', wire: !!a })
    }
    return
  }

  // しゃがみ歩き（隠密）: 押すたびに入れる / 切る。地上だけ。跳ぶ・ワイヤーで切れる
  const snH = !!inp.sneak
  if (snH && !r.sneakPrev && r.grounded && r.stun <= 0) { r.sneaking = !r.sneaking; ev.push({ t: 'sneak', on: r.sneaking }) }
  r.sneakPrev = snH
  let thr = inp.throttle || 0, brk = inp.brake || 0, steer = inp.steer || 0
  const jumpHeld = !!inp.jump, wireHeld = !!inp.wire
  const jumpPress = jumpHeld && !r.jumpPrev, wirePress = wireHeld && !r.wirePrev
  r.jumpPrev = jumpHeld; r.wirePrev = wireHeld
  if (r.stun > 0) { r.stun -= dt; thr = brk = steer = 0 }
  // 巻き取り: 押している間（スマホはスティックをワイヤーの方へ倒している間）ずっと
  const zipHeld = !!inp.boost, zipPress = zipHeld && !r.zipPrev
  r.zipPrev = zipHeld
  r.zipCd = 0
  if (zipHeld && r.rope && r.stun <= 0) { if (!r.zipping) ev.push({ t: 'zip' }); r.zipping = true }
  else { r.zipping = false; if (zipPress && !r.rope && r.stun <= 0) ev.push({ t: 'zipNo' }) }

  // 向き
  const turn = (r.grounded ? RUN.turn : r.rope ? RUN.airTurn * 1.2 : RUN.airTurn) * steer
  r.yaw -= turn * dt
  const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw)

  // ワイヤー: 押すたびに 掛ける / 外す
  if (wirePress && r.stun <= 0) {
    if (r.rope) release(r, true)
    else {
      r.sneaking = false
      const fromGround = r.grounded
      if (r.grounded) { r.vy = Math.max(r.vy, RUN.jump * 0.85); r.grounded = false; r.y += 0.05; ev.push({ t: 'jump' }) }
      // 狙った点（画面をタッチ・クリックした所）があればそこへ。届かなければ自動で探す
      let a = null
      const w = inp.wireAt
      if (w) {
        const d = Math.hypot(w.x - r.x, w.y - (r.y + 1.5), w.z - r.z)
        if (d <= RUN.wireRange * 1.1 && w.y > r.y + 2) a = { x: w.x, y: w.y, z: w.z, len: d }
      }
      if (!a) a = findAnchor(world, r)
      if (a) {
        const d = Math.hypot(a.x - r.x, a.y - (r.y + 1.2), a.z - r.z)
        // 長さは「振り子の一番下が、足元の地面から swingLow 上に来る」長さ。今の距離より長ければ、張るまで落ちてから振れる
        // 高い所から掛けると通りへ向かって振り下ろし、また上がる。振るたびに空へ昇り続けない
        const low = floorAt(world, r.x, r.z, r.y).h + RUN.swingLow
        const want = Math.max(RUN.minRope, a.y - (low + 1.2))
        r.rope = { x: a.x, y: a.y, z: a.z, len: Math.min(want, d * 1.5, RUN.wireRange), t: 0 }
        r.climbing = null
        // 遅いときは前へ押し出す（止まった所から掛けても振れるように）
        const v = speedOf(r)
        if (v < 12) { r.vx += fx * (12 - v); r.vz += fz * (12 - v) }
        // 地面に着かずにつないだ数
        r.combo = fromGround ? 1 : r.combo + 1
        r.swings++
        r.bestCombo = Math.max(r.bestCombo || 0, r.combo)
        ev.push({ t: 'wire', x: a.x, y: a.y, z: a.z, combo: r.combo })
      } else ev.push({ t: 'wireMiss' })
    }
  }

  // ジャンプ（地面か、地面を離れた直後）
  if (jumpPress && r.stun <= 0 && (r.grounded || r.coyote > 0) && !r.rope) {
    r.sneaking = false
    r.vy = RUN.jump
    r.grounded = false; r.coyote = 0; r.y += 0.05
    ev.push({ t: 'jump' })
  } else if (jumpPress && r.rope) release(r, true)

  // 走る・こぐ・噴かす
  if (r.climbing) {
    // 壁を駆け上がる。前を押している間だけ。ガスで速く
    const cl = r.climbing
    if (thr <= 0 || r.stun > 0) { r.climbing = null; r.vy = Math.min(r.vy, 2); r.vx += cl.nx * 3; r.vz += cl.nz * 3 }
    else {
      r.vy = RUN.climb * (r.climbMul || 1)
      r.vx = -cl.nx * 2; r.vz = -cl.nz * 2 // 壁に押しつけたまま
      if (r.y >= cl.top - 0.2) {
        // 屋上へ乗り上げる
        r.climbing = null
        r.y = cl.top + 0.05
        r.vy = 3.5
        r.vx = -cl.nx * 5; r.vz = -cl.nz * 5
        ev.push({ t: 'vault' })
      }
    }
  } else if (r.grounded) {
    const want = (thr > 0 ? (r.sneaking ? RUN.sneak : RUN.walk) * thr : brk > 0 ? -RUN.back * (r.sneaking ? 0.5 : 1) : 0) * (r.speedMul || 1)
    const vf = r.vx * fx + r.vz * fz
    const vl = r.vx * fz - r.vz * fx // 横（右が + ではない。消すだけなので向きは問わない）
    const nf = vf + clamp(want - vf, -RUN.accel * dt * (brk > 0 && vf > 0 ? 1.6 : 1), RUN.accel * dt)
    const nl = vl * Math.max(0, 1 - 14 * dt) // 横滑りはすぐ消す（人は向いた方へ走る）
    r.vx = fx * nf + fz * nl; r.vz = fz * nf - fx * nl
  } else {
    // 空中: 少しだけ前後に動ける
    if (thr > 0) { r.vx += fx * RUN.airAccel * thr * dt; r.vz += fz * RUN.airAccel * thr * dt }
    if (brk > 0) { r.vx *= 1 - 0.8 * dt; r.vz *= 1 - 0.8 * dt }
    if (r.rope) {
      // こぐ: 進む向きへ力を足す（振り子が大きくなる）
      if (thr > 0 && r.vy < 2) { r.vx += fx * RUN.pump * dt; r.vz += fz * RUN.pump * dt }
      // 横へ流れる分を、向いている方へ寄せる（横の建物に掛けても前へ進む）
      const hv = Math.hypot(r.vx, r.vz)
      if (hv > 3) {
        const k = Math.min(1, RUN.steerAssist * dt)
        const nx = r.vx / hv * (1 - k) + fx * k, nz = r.vz / hv * (1 - k) + fz * k, nl = Math.hypot(nx, nz) || 1
        r.vx = nx / nl * hv; r.vz = nz / nl * hv
      }
    }
  }
  if (r.rope && r.zipping) {
    // 巻き取り: 掛けた点へ加速して飛ぶ（最高 zip m/s）。着く手前（7m）で外れて、前と上へ飛び出す
    const dx = r.rope.x - r.x, dy = r.rope.y - (r.y + 1.2), dz = r.rope.z - r.z, d = Math.hypot(dx, dy, dz) || 1
    const ux = dx / d, uy = dy / d, uz = dz / d
    r.vx += ux * RUN.zipAcc * dt; r.vy += uy * RUN.zipAcc * dt + RUN.gravity * dt; r.vz += uz * RUN.zipAcc * dt
    const along = r.vx * ux + r.vy * uy + r.vz * uz
    if (along > RUN.zip) { const k = along - RUN.zip; r.vx -= ux * k; r.vy -= uy * k; r.vz -= uz * k }
    r.rope.len = Math.min(r.rope.len, d)
    r.boosting = true
    if (d < 7) {
      r.zipping = false
      const h = Math.hypot(dx, dz) || 1
      r.rope = null
      r.vx = dx / h * RUN.zipExit + fx * 4; r.vz = dz / h * RUN.zipExit + fz * 4; r.vy = RUN.zipExit
      ev.push({ t: 'unwire', auto: true, zip: true })
    }
  } else r.zipping = false

  physics(r, thr, dt, world, false)

  // 復帰用に、地面にいた位置を覚える
  if (r.grounded && r.y > RUN.waterY + 0.5) {
    r.safeT += dt
    if (r.safeT > 0.3) { r.safeT = 0; r.safeHist.push({ x: r.x, y: r.y, z: r.z, yaw: r.yaw }); if (r.safeHist.length > 14) r.safeHist.shift() }
  }
}

function release(r, byPlayer) {
  if (!r.rope) return
  r.rope = null
  r.zipping = false
  // 外した瞬間に少し上へ（次のワイヤーまでの間をつくる）
  if (r.vy > -4) r.vy += RUN.releaseKick
  if (!r.zipExit) r.vy = Math.min(r.vy, RUN.releaseVyMax)
  r.events.push({ t: 'unwire', auto: !byPlayer })
}

function physics(r, thr, dt, world, passive) {
  const R = RUN.radius
  if (!r.climbing) r.vy -= RUN.gravity * dt
  // 空気の抵抗と最高速
  if (!r.grounded) { const k = 1 - RUN.drag * dt * Math.hypot(r.vx, r.vy, r.vz) * 0.1; r.vx *= k; r.vz *= k }
  const sp3 = Math.hypot(r.vx, r.vy, r.vz)
  if (sp3 > RUN.maxSpeed) { const k = RUN.maxSpeed / sp3; r.vx *= k; r.vy *= k; r.vz *= k }

  const px = r.x, py = r.y, pz = r.z
  r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt

  // ワイヤー: 長さより遠くへは行けない（外へ向かう速さを消す）
  if (r.rope) {
    const rp = r.rope
    rp.t += dt
    const hx = r.x, hy = r.y + 1.2, hz = r.z
    let dx = hx - rp.x, dy = hy - rp.y, dz = hz - rp.z
    let d = Math.hypot(dx, dy, dz)
    if (d > rp.len) {
      const nx = dx / d, ny = dy / d, nz = dz / d
      r.x = rp.x + nx * rp.len; r.y = rp.y + ny * rp.len - 1.2; r.z = rp.z + nz * rp.len
      const out = r.vx * nx + r.vy * ny + r.vz * nz
      if (out > 0) { r.vx -= out * nx; r.vy -= out * ny; r.vz -= out * nz }
      // 下の方では少しずつ巻き取って持ち上げる
      if (ny < -0.5) rp.len = Math.max(RUN.minRope, rp.len - RUN.reel * dt)
      d = rp.len
    }
    // 振り切った: 掛けた点より前に出て上がっている（ワイヤーが水平から 25 度より上）なら自動で外す
    const ahead = (r.x - rp.x) * r.vx + (r.z - rp.z) * r.vz > 0
    if (r.zipping) { /* 巻き取り中は外さない */ }
    else if (ahead && r.vy > 0 && (r.y + 1.2 - rp.y) > -d * 0.6 && rp.t > 0.4) release(r, false)
    // 掛けた点より上に出た／長すぎる時間がたった
    else if (r.y + 1.2 > rp.y + 1 || rp.t > 6) release(r, false)
  }

  // 壁・柵
  let wall = null
  for (const o of solids(world, r.x, r.z)) {
    if (r.y >= o.y1 - 0.05 || r.y + RUN.height <= o.y0) continue
    const p = local(o, r.x, r.z)
    const pu = o.hw + R - Math.abs(p.u), pv = o.hl + R - Math.abs(p.v)
    if (pu <= 0 || pv <= 0) continue
    // 低い段差は乗り越える
    if (o.y1 - r.y <= RUN.stepUp && !passive) { r.y = o.y1; if (r.vy < 0) r.vy = 0; continue }
    // 前の位置が箱の上なら、上に乗る
    if (py >= o.y1 - 0.25) { r.y = o.y1; if (r.vy < 0) r.vy = 0; continue }
    // 浅い方へ押し出す
    let nu = 0, nv = 0
    if (pu < pv) nu = Math.sign(p.u) || 1
    else nv = Math.sign(p.v) || 1
    const push = Math.min(pu, pv)
    // 箱の向き → 世界の向き（local の逆回転）
    const nx = nu * p.c + nv * p.s, nz = -nu * p.s + nv * p.c
    r.x += nx * push; r.z += nz * push
    const into = r.vx * nx + r.vz * nz
    if (into < 0) {
      if (-into > 14 && !r.rope) r.events.push({ t: 'bonk', speed: -into })
      r.vx -= into * nx; r.vz -= into * nz
    }
    if (!wall || o.y1 > wall.top) wall = { nx, nz, top: o.y1, o }
  }

  // 壁を駆け上がる（壁に向かって前を押している。ワイヤー中は外してから）
  if (wall && !passive && !r.climbing && !r.sneaking && thr > 0 && wall.top - r.y > RUN.stepUp) {
    const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw)
    if (fx * -wall.nx + fz * -wall.nz > 0.55) {
      if (r.rope) release(r, false)
      r.climbing = { nx: wall.nx, nz: wall.nz, top: wall.top }
      r.events.push({ t: 'climb' })
    }
  }
  if (r.climbing && !wall) {
    // 壁が途切れた（角を回り込んだ・低い所に乗った）
    r.climbing = null
  }

  // 床
  const f = floorAt(world, r.x, r.z, Math.max(r.y, py))
  const wasGround = r.grounded
  if (r.y <= f.h + 0.02 && r.vy <= 0.01) {
    const impact = -r.vy
    r.y = f.h; r.vy = 0
    if (!wasGround) {
      const air = r.airTime
      r.lastAir = air
      r.maxAir = Math.max(r.maxAir, air)
      r.events.push({ t: 'land', air, impact, roof: !!f.roof, combo: r.combo })
      if (r.combo >= 2) r.events.push({ t: 'comboEnd', n: r.combo })
      r.combo = 0
      r.groundedSince = r.t
      if (r.rope) release(r, false)
    }
    r.grounded = true; r.airTime = 0; r.coyote = RUN.coyote
    r.onRoof = !!f.roof
    r.surf = f.roof ? 'roof' : world.surfaceAt(r.x, r.z)
  } else if (r.y > f.h + 0.25 || r.vy > 0.01) {
    if (wasGround) r.coyote = RUN.coyote
    r.grounded = false
    r.coyote = Math.max(0, r.coyote - dt)
    r.airTime += dt
    r.onRoof = false
  } else {
    // 少しだけ浮いている（段差を下りる途中）: 地面に吸いつける
    r.y = f.h; r.vy = 0; r.grounded = true; r.airTime = 0
  }
  // 地面を走っている間はワイヤーを持たない（張っていないワイヤーで引きずらない）
  if (r.grounded && r.rope && r.rope.t > 0.3) release(r, false)
  r.groundY = f.h
  if (r.y > (r.maxY || 0)) r.maxY = r.y
  r.roofTime = r.onRoof && r.grounded ? r.roofTime + dt : 0

  // 運河に落ちた: 少し前の地面に戻る
  if (r.y < RUN.waterY && !r.falling) {
    r.falling = true
    r.events.push({ t: 'splash', x: r.x, z: r.z })
    r.rope = null; r.climbing = null
    const back = r.safeHist.length ? r.safeHist[Math.max(0, r.safeHist.length - 6)] : r.respawnPoint
    respawnRunner(r, back)
  }
  // 街の外へは出ない
  const b = world.bounds
  r.x = clamp(r.x, b.x0 + 2, b.x1 - 2); r.z = clamp(r.z, b.z0 + 2, b.z1 - 2)
}

// 車に当てられた（警察・一般車）。はね飛ばされて体力が減る。体力が尽きると倒れる
export function hitByCar(r, car, rel, dmgScale = 1) {
  const dx = r.x - car.x, dz = r.z - car.z, d = Math.hypot(dx, dz) || 1
  r.rope = null; r.climbing = null
  r.vx = car.vx * 0.85 + dx / d * 6; r.vz = car.vz * 0.85 + dz / d * 6
  r.vy = 7.5 + Math.min(6, rel * 0.25) // 大げさに高く飛ばす（見て笑える）
  r.grounded = false; r.y += 0.1
  r.stun = 0.9
  const a = (0.08 + rel * 0.0065) * dmgScale
  r.dmg.body = Math.max(0, r.dmg.body - a)
  r.lastHitBy = car.id; r.lastHitAt = r.t
  r.events.push({ t: 'carhit', other: car.id, speed: rel, x: r.x, y: r.y + 1, z: r.z, dmg: a })
  if (r.dmg.body <= 0 && !r.wreck) down(r, 'hit')
}

export function down(r, kind) {
  r.wreck = RUN.downSec
  r.rope = null; r.climbing = null
  r.events.push({ t: 'wreck', kind })
}

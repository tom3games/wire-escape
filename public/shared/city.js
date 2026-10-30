// ステージ2「湾岸シティ」: 碁盤の目の街を2周する。運河に橋が4本と、途中で切れた跳ね橋（飛び越える近道）。
// 公園・広場・駐車場・工事現場・路地を突っ切れる。一般車が左側通行で走る（traffic.js）。
// 座標の決まりは track.js と同じ（x=東西, z=北が +）。

// 区画は 130m 四方（2026-10-26 本人「街の規模が小さい、道も狭い」で 80m から広げた）。
// 下の座標は 80m 間隔の設計図で書き、X() Z() で実際の大きさへ伸ばす
const K = 130 / 80
const X = x => x * K, Z = z => 40 + (z - 40) * K
// 街は 9x10 区画（2026-10-26 本人「マップを広く、GTA に寄せて」で外側に1〜2列ずつ足した）。レースのコースは内側
export const CITY_BOUNDS = { x0: X(-360), x1: X(360), z0: -20, z1: Z(880) }
const XS = [-320, -240, -160, -80, 0, 80, 160, 240, 320].map(X)
const ZS = [40, 120, 200, 280, 360, 440, 520, 600, 680, 760, 840].map(Z)
const WIDE_X = new Set([X(-240), 0, X(240)]), WIDE_Z = new Set([Z(40), Z(680)])
const MID = Z(332)
const CANAL = { z0: MID - 15, z1: MID + 15, floor: -8 }
const BRIDGES = [-240, -80, 0, 240].map(X) // 普通の橋
const DRAW_X = X(160)                      // 切れた跳ね橋（南行きで飛ぶ）
const WIDE = 28, NORMAL = 18, ALLEY = 9

const sst = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

export function cityTerrain(x, z) {
  // 平らな街。運河だけ深く掘れている
  const m = sst(CANAL.z0 - 2, CANAL.z0, z) * (1 - sst(CANAL.z1, CANAL.z1 + 2, z))
  return m > 0 ? CANAL.floor * m : 0
}

const roadW = (axis, v) => (axis === 'x' ? WIDE_X.has(v) : WIDE_Z.has(v)) ? WIDE : NORMAL

// 区画の種類（左下の交差点の x, z で決める）
const BLOCK = {}
for (const [x, z, k] of [[-80, 440, 'park'], [80, 120, 'park'], [0, 520, 'plaza'], [-160, 200, 'parking'], [160, 440, 'site'],
  [-320, 280, 'bank'], [-240, 280, 'bank'], [-160, 280, 'bank'], [-80, 280, 'bank'], [0, 280, 'bank'], [80, 280, 'bank'], [160, 280, 'bank'], [240, 280, 'bank'],
  [-240, 520, 'park'], [160, 120, 'parking'], [240, 680, 'park'], [-320, 760, 'parking'], [0, 760, 'plaza'], [-160, 760, 'site'],
  // レースの曲がり角の内側は「近道の空き地」（入口と出口はバリケードだけ）
  [-240, 360, 'lot:se-nw'], [-240, 600, 'lot:sw-ne'], [80, 600, 'lot:ne-sw'], [80, 40, 'lot:nw-se']]) BLOCK[`${X(x)},${Z(z)}`] = k

export function buildCity() {
  const roads = [], slabs = [], boxes = [], props = [], dirt = [], repair = [], decor = [], labels = [], grassRects = [], dirtRects = [], trees = [], shortcuts = [], lotRects = [], pickups = []
  const tree = (x, z, s = 0.62) => { trees.push({ x, y: 0, z, s, r: x * 0.37 + z }); props.push({ type: 'tree', x, z, yaw: 0, y: -0.5, ti: trees.length - 1 }) }
  const road = (pts, w = 12, surf = 'road') => roads.push({ pts, w, surf })
  const box = (x0, z0, x1, z1, h, kind = 'building', y0 = 0) =>
    boxes.push({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, yaw: 0, hw: Math.abs(x1 - x0) / 2, hl: Math.abs(z1 - z0) / 2, y0, h, kind })
  const prop = (type, x, z, yaw = 0, y) => props.push({ type, x, z, yaw, y })
  let seed = 23
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647

  // ---------------- 道（南北の通りは運河で切る。橋のある通りだけつなぐ）
  for (const x of XS) {
    const w = roadW('x', x)
    if (BRIDGES.includes(x) || x === DRAW_X) road([[x, ZS[0] - 10], [x, ZS[ZS.length - 1] + 10]], w)
    else { road([[x, ZS[0] - 10], [x, CANAL.z0 - 4]], w); road([[x, CANAL.z1 + 4], [x, ZS[ZS.length - 1] + 10]], w) }
  }
  for (const z of ZS) road([[XS[0] - 10, z], [XS[XS.length - 1] + 10, z]], roadW('z', z))

  // ---------------- 橋（運河をまたぐ板）と欄干、運河の縁の柵
  for (const x of BRIDGES) {
    const hw = roadW('x', x) / 2
    slabs.push({ cx: x, cz: (CANAL.z0 + CANAL.z1) / 2, yaw: 0, hw, hl: (CANAL.z1 - CANAL.z0) / 2 + 3, y0: 0, y1: 0, thick: 1.4, surf: 'road', solid: true, kind: 'bridge' })
    for (const s of [-1, 1]) boxes.push({ cx: x + s * (hw + 0.3), cz: (CANAL.z0 + CANAL.z1) / 2, yaw: 0, hw: 0.3, hl: (CANAL.z1 - CANAL.z0) / 2 + 3, y0: 0, h: 1.1, kind: 'rail' })
  }
  // 跳ね橋: 北側の板が跳ね上がったまま（南行きで踏み切る）。南側は少し上げた着地の板
  slabs.push({ cx: DRAW_X, cz: CANAL.z1 + 11, yaw: 0, hw: NORMAL / 2, hl: 11, y0: 3.8, y1: 0, thick: 0.8, surf: 'road', solid: true, kind: 'kicker' })
  slabs.push({ cx: DRAW_X, cz: CANAL.z0 - 11, yaw: 0, hw: NORMAL / 2, hl: 11, y0: 0, y1: 1.0, thick: 0.8, surf: 'road', solid: true, kind: 'bridge' })
  // 運河の縁: 橋のない所には低い柵（落ちないように。壊れない）
  const openings = [...BRIDGES.map(x => [x, roadW('x', x) / 2 + 0.6]), [DRAW_X, NORMAL / 2 + 0.6]]
  for (const zEdge of [CANAL.z0 - 1, CANAL.z1 + 1]) {
    let x = CITY_BOUNDS.x0
    const cuts = openings.map(([cx, hw]) => [cx - hw, cx + hw]).sort((a, b) => a[0] - b[0])
    for (const [a, b] of cuts) { if (a > x) boxes.push({ cx: (x + a) / 2, cz: zEdge, yaw: 0, hw: (a - x) / 2, hl: 0.25, y0: 0, h: 0.95, kind: 'rail' }); x = b }
    boxes.push({ cx: (x + CITY_BOUNDS.x1) / 2, cz: zEdge, yaw: 0, hw: (CITY_BOUNDS.x1 - x) / 2, hl: 0.25, y0: 0, h: 0.95, kind: 'rail' })
  }
  labels.push({ x: DRAW_X, z: MID, t: 'JUMP' })

  // ---------------- 区画（建物・公園・広場・駐車場・工事現場）
  for (let i = 0; i < XS.length - 1; i++) for (let j = 0; j < ZS.length - 1; j++) {
    const x0 = XS[i] + roadW('x', XS[i]) / 2 + 4, x1 = XS[i + 1] - roadW('x', XS[i + 1]) / 2 - 4
    const z0 = ZS[j] + roadW('z', ZS[j]) / 2 + 4, z1 = ZS[j + 1] - roadW('z', ZS[j + 1]) / 2 - 4
    const kind = BLOCK[`${XS[i]},${ZS[j]}`] || 'buildings'
    const downtown = Math.abs((XS[i] + XS[i + 1]) / 2) < X(130) && ZS[j] >= Z(360)
    if (kind === 'buildings') {
      // 2棟に分けて、間を車が通れる路地（6m）にすることがある
      if (rnd() < 0.55) {
        const along = rnd() < 0.5
        const g = ALLEY / 2
        if (along) { const m = (x0 + x1) / 2 + (rnd() - 0.5) * 16; tall(x0, z0, m - g, z1); tall(m + g, z0, x1, z1); road([[m, z0 - 4], [m, z1 + 4]], ALLEY) }
        else { const m = (z0 + z1) / 2 + (rnd() - 0.5) * 16; tall(x0, z0, x1, m - g); tall(x0, m + g, x1, z1); road([[x0 - 4, m], [x1 + 4, m]], ALLEY) }
      } else tall(x0, z0, x1, z1)
    } else if (kind === 'park') {
      grassRects.push({ x0, z0, x1, z1 })
      // 周りに木の柵（角は空いている）。中に木
      for (let x = x0 + 8; x <= x1 - 8; x += 4.2) { prop('fence', x, z0, 0); prop('fence', x, z1, 0) }
      for (let z = z0 + 8; z <= z1 - 8; z += 4.2) { prop('fence', x0, z, Math.PI / 2); prop('fence', x1, z, Math.PI / 2) }
      for (let k = 0; k < 9; k++) decor.push({ kind: 'parktree', x: x0 + 8 + rnd() * (x1 - x0 - 16), z: z0 + 8 + rnd() * (z1 - z0 - 16) })
      labels.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, t: 'PARK' })
    } else if (kind === 'plaza') {
      box((x0 + x1) / 2 - 4, (z0 + z1) / 2 - 4, (x0 + x1) / 2 + 4, (z0 + z1) / 2 + 4, 1.2, 'fountain')
      for (const [px, pz] of [[x0 + 4, z0 + 4], [x1 - 4, z0 + 4], [x0 + 4, z1 - 4], [x1 - 4, z1 - 4]]) prop('lamp', px, pz)
    } else if (kind === 'parking') {
      for (let r = 0; r < 4; r++) for (let k = 0; k < 14; k++) if (rnd() < 0.7) prop('parked', x0 + 8 + k * 6.6, z0 + 14 + r * 22, Math.PI / 2 + (rnd() - 0.5) * 0.1)
    } else if (kind === 'site') {
      dirtRects.push({ x0, z0, x1, z1 })
      for (let x = x0 + 6; x <= x1 - 6; x += 4) { prop('tempfence', x, z0, 0) }
      for (let z = z0 + 6; z <= z1 - 6; z += 4) { prop('tempfence', x1, z, Math.PI / 2) }
      slabs.push({ cx: (x0 + x1) / 2 - 12, cz: (z0 + z1) / 2, yaw: Math.PI / 2, hw: 3.2, hl: 4.5, y0: 0.02, y1: 2.2, thick: 0.4, surf: 'wood', solid: true, kind: 'roll', roll: 1 })
      slabs.push({ cx: (x0 + x1) / 2 + 10, cz: (z0 + z1) / 2 - 10, yaw: 0, hw: 3.2, hl: 4.5, y0: 0.02, y1: 1.9, thick: 0.4, surf: 'wood', solid: true, kind: 'kicker' })
      prop('lumber', x0 + 10, z1 - 10, 0.3); prop('lumber', x1 - 12, z1 - 8, -0.2)
      labels.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, t: 'SITE' })
    } else if (kind.startsWith('lot')) {
      // 入口と出口（区画のどの辺のどこか）。対角に突っ切ると曲がり角をショートカットできる
      // lot:se-nw = 南辺の東寄りから入り、西辺の北寄りへ抜ける、など
      const side = (c, t) => {
        const L = 30 // 入口の幅
        // 入口が区画の端からはみ出さないように寄せる
        const span = (c === 's' || c === 'n') ? x1 - x0 : z1 - z0
        t = Math.max((L / 2 + 3) / span, Math.min(1 - (L / 2 + 3) / span, t))
        if (c === 's') return { a: [x0 + (x1 - x0) * t - L / 2, z0], b: [x0 + (x1 - x0) * t + L / 2, z0], mid: [x0 + (x1 - x0) * t, z0], out: [0, -1] }
        if (c === 'n') return { a: [x0 + (x1 - x0) * t - L / 2, z1], b: [x0 + (x1 - x0) * t + L / 2, z1], mid: [x0 + (x1 - x0) * t, z1], out: [0, 1] }
        if (c === 'w') return { a: [x0, z0 + (z1 - z0) * t - L / 2], b: [x0, z0 + (z1 - z0) * t + L / 2], mid: [x0, z0 + (z1 - z0) * t], out: [-1, 0] }
        return { a: [x1, z0 + (z1 - z0) * t - L / 2], b: [x1, z0 + (z1 - z0) * t + L / 2], mid: [x1, z0 + (z1 - z0) * t], out: [1, 0] }
      }
      // 入口は来る向きの奥の端、出口は出ていく向きの奥の端（対角がいちばん長くなる）
      const spec = { 'lot:se-nw': [['s', 1], ['w', 1]], 'lot:sw-ne': [['w', 0], ['n', 1]], 'lot:ne-sw': [['n', 0], ['e', 0]], 'lot:nw-se': [['e', 1], ['s', 0]] }[kind]
      const ent = side(...spec[0]), ext = side(...spec[1])
      // 周りは低い塀（壊れない）。入口と出口だけ赤白のバリケード
      const wall = (ax, az, bx, bz) => { if (Math.hypot(bx - ax, bz - az) < 1) return; boxes.push({ cx: (ax + bx) / 2, cz: (az + bz) / 2, yaw: 0, hw: Math.max(0.4, Math.abs(bx - ax) / 2), hl: Math.max(0.4, Math.abs(bz - az) / 2), y0: 0, h: 1.3, kind: 'lotwall' }) }
      const edges = { s: [[x0, z0], [x1, z0]], n: [[x0, z1], [x1, z1]], w: [[x0, z0], [x0, z1]], e: [[x1, z0], [x1, z1]] }
      for (const [c, [[ax, az], [bx, bz]]] of Object.entries(edges)) {
        const gaps = [ent, ext].filter(g => (c === 's' || c === 'n') ? Math.abs(g.a[1] - az) < 0.1 && Math.abs(g.b[1] - az) < 0.1 : Math.abs(g.a[0] - ax) < 0.1 && Math.abs(g.b[0] - ax) < 0.1)
        if (c === 's' || c === 'n') { let x = ax; for (const g of gaps.sort((p, q) => p.a[0] - q.a[0])) { wall(x, az, g.a[0], az); x = g.b[0] } wall(x, az, bx, az) }
        else { let z = az; for (const g of gaps.sort((p, q) => p.a[1] - q.a[1])) { wall(ax, z, ax, g.a[1]); z = g.b[1] } wall(ax, z, ax, bz) }
      }
      for (const g of [ent, ext]) {
        const horiz = Math.abs(g.a[1] - g.b[1]) < 0.1
        const n = 10
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n
          prop('barricade', g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t, horiz ? 0 : Math.PI / 2)
        }
      }
      // 対角の途中にジャンプ台
      const mx = (ent.mid[0] + ext.mid[0]) / 2, mz = (ent.mid[1] + ext.mid[1]) / 2
      const dx = ext.mid[0] - ent.mid[0], dz = ext.mid[1] - ent.mid[1]
      slabs.push({ cx: mx, cz: mz, yaw: Math.atan2(dx, dz), hw: 3.6, hl: 5, y0: 0.02, y1: 2.0, thick: 0.4, surf: 'wood', solid: true, kind: shortcuts.length % 2 ? 'roll' : 'kicker', roll: shortcuts.length % 2 ? 1 : 0 })
      // 近道のごほうび: 対角の上にニトロ缶を3つ
      for (const f of [0.25, 0.68, 0.85]) pickups.push({ x: ent.mid[0] + dx * f, z: ent.mid[1] + dz * f, amount: 0.3 })
      shortcuts.push({ entry: [ent.mid[0] + ent.out[0] * 8, ent.mid[1] + ent.out[1] * 8], inA: ent.mid, outB: ext.mid, exit: [ext.mid[0] + ext.out[0] * 8, ext.mid[1] + ext.out[1] * 8], out: ent.out })
      lotRects.push({ x0, z0, x1, z1 })
    } else if (kind === 'bank') {
      // 運河沿いの遊歩道（並木と街灯）
      for (let x = x0 + 6; x < x1 - 4; x += 14) { decor.push({ kind: 'parktree', x, z: z0 + 4 }); prop('lamp', x + 7, z1 - 2) }
    }
    function tall(a0, b0, a1, b1) {
      const h = downtown ? 40 + rnd() * 80 : 14 + rnd() * 24
      box(a0, b0, a1, b1, h, 'building')
    }
  }
  // 外周の建物（街の外へ出られない）
  const ex = XS[XS.length - 1] + WIDE / 2 + 4, ez0 = ZS[0] - WIDE / 2 - 4, ez1 = ZS[ZS.length - 1] + WIDE / 2 + 4
  box(-ex - 80, -60, -ex, ez1 + 80, 30, 'building'); box(ex, -60, ex + 80, ez1 + 80, 30, 'building')
  box(-ex, -60, ex, ez0, 26, 'building'); box(-ex, ez1, ex, ez1 + 80, 34, 'building')

  // ---------------- 通りの小物（壊せる）: 大通りに街灯、交差点に信号、歩道の植え込みの木
  const lampOff = WIDE / 2 + 1.4
  const nearCross = (v, lines) => lines.some(l => Math.abs(v - l) < WIDE / 2 + 6)
  for (const x of WIDE_X) for (let z = ZS[0] + 30; z < ZS[ZS.length - 1]; z += 40) { if (z > CANAL.z0 - 12 && z < CANAL.z1 + 12) continue; if (nearCross(z, ZS)) continue; prop('lamp', x - lampOff, z); prop('lamp', x + lampOff, z + 20) }
  for (const z of WIDE_Z) for (let x = XS[0] + 30; x < XS[XS.length - 1]; x += 40) { if (nearCross(x, XS)) continue; prop('lamp', x, z + (z === ZS[0] ? -lampOff : lampOff)) }
  for (const x of XS) for (const z of ZS) {
    if (!(WIDE_X.has(x) || WIDE_Z.has(z))) continue
    const ox = roadW('x', x) / 2 + 1.6, oz = roadW('z', z) / 2 + 1.6
    prop('signal', x - ox, z - oz, 0); prop('signal', x + ox, z + oz, Math.PI)
  }
  for (let z = ZS[0] + 20; z < ZS[ZS.length - 1]; z += 26) { if (z > CANAL.z0 - 14 && z < CANAL.z1 + 14) continue; if (nearCross(z, ZS)) continue; for (const s of [-1, 1]) { const tx = s * (WIDE / 2 + 2.6); if (roads.some(r => r.w <= ALLEY && Math.abs(r.pts[0][1] - z) < ALLEY && Math.min(r.pts[0][0], r.pts[1][0]) - 4 < tx && Math.max(r.pts[0][0], r.pts[1][0]) + 4 > tx)) continue; tree(tx, z) } }
  for (const d of decor) if (d.kind === 'parktree') tree(d.x, d.z, 0.7)

  // ---------------- 道ばたのジャンプ台（片側の車線だけ）
  const kick = (x, z, dx, dz, roll = 0) => slabs.push({ cx: x, cz: z, yaw: Math.atan2(dx, dz), hw: 3.4, hl: 5, y0: 0.02, y1: 2.0, thick: 0.4, surf: 'wood', solid: true, kind: roll ? 'roll' : 'kicker', roll })
  kick(-7, Z(200), 0, 1, 1); kick(7, Z(560), 0, 1, 0); kick(X(-240) - 7, Z(460), 0, 1, -1); kick(X(120), Z(680) + 7, 1, 0, 1); kick(X(240) + 7, Z(200), 0, -1, 0); kick(X(-60), Z(360) - 4, -1, 0, -1)

  // 修理工場（2026-10-26 警察と犯人で追加）: 大通りの片側の車線に4か所。中で3秒止まると全回復（chase.js）
  const shopV = (x, zc) => repair.push({ x0: x + 2, z0: zc - 12, x1: x + 13, z1: zc + 12, name: 'REPAIR' })
  const shopH = (xc, z) => repair.push({ x0: xc - 12, z0: z + 2, x1: xc + 12, z1: z + 13, name: 'REPAIR' })
  shopV(X(-240), Z(160)); shopV(X(240), Z(480)); shopV(0, Z(800)); shopH(X(-120), Z(680))

  // ---------------- チェックポイント（2周）
  const hwW = WIDE / 2 + 1, hwN = NORMAL / 2 + 1
  const gates = [
    { a: { x: X(-120), z: Z(360) - hwN }, b: { x: X(-120), z: Z(360) + hwN }, nx: -1, nz: 0, name: 'CP1', respawn: { x: X(-120) - 6, z: Z(360), yaw: -Math.PI / 2 } },
    { a: { x: X(-240) - hwW, z: Z(560) }, b: { x: X(-240) + hwW, z: Z(560) }, nx: 0, nz: 1, name: 'CP2', respawn: { x: X(-240), z: Z(560) + 6, yaw: 0 } },
    { a: { x: X(40), z: Z(680) - hwW }, b: { x: X(40), z: Z(680) + hwW }, nx: 1, nz: 0, name: 'CP3', respawn: { x: X(40) + 6, z: Z(680), yaw: Math.PI / 2 } },
    { a: { x: X(160) - hwN, z: Z(480) }, b: { x: X(160) + hwN, z: Z(480) }, nx: 0, nz: -1, name: 'CP4', respawn: { x: X(160), z: Z(480) - 6, yaw: Math.PI } },
    { a: { x: X(40), z: Z(40) - hwW }, b: { x: X(40), z: Z(40) + hwW }, nx: -1, nz: 0, name: 'CP5', respawn: { x: X(40) - 6, z: Z(40), yaw: -Math.PI / 2 } },
    { a: { x: -hwW, z: Z(80) }, b: { x: hwW, z: Z(80) }, nx: 0, nz: 1, name: 'FINISH', respawn: { x: 0, z: Z(80) + 6, yaw: 0 } }
  ]
  const grid = []
  for (let i = 0; i < 8; i++) grid.push({ x: i % 2 ? 5 : -5, z: Z(80) - 14 - Math.floor(i / 2) * 9, yaw: 0 })

  // 走行線は設計図の座標で書いて伸ばす
  const P = pts => pts.map(([x, z]) => [X(x), Z(z)])
  // 近道を通る走行線: 区画の外の手前 → 入口 → 対角 → 出口 → 次の通り
  const cut = (sc, before, after) => [before, sc.entry, sc.inA, sc.outB, sc.exit, after]
  const [s0, s1, s2, s3] = shortcuts // 作った順: 西の北行き / 西の東行き / 南東 / 北東
  const routes = [
    [{ id: 'A', risk: 0, pts: P([[0, 92], [0, 346], [-5, 355], [-16, 360], [-126, 360]]) }],
    [{ id: 'A', risk: 0, pts: P([[-126, 360], [-226, 360], [-236, 365], [-240, 376], [-240, 566]]) },
     { id: 'B', risk: 0.4, pts: [...P([[-126, 360]]), ...cut(s0, [s0.entry[0] + 30, Z(360)], [X(-240), s0.exit[1] + 30]), ...P([[-240, 566]])] }],
    [{ id: 'A', risk: 0, pts: P([[-240, 566], [-240, 668], [-235, 676], [-224, 680], [46, 680]]) },
     { id: 'B', risk: 0.4, pts: [...P([[-240, 566]]), ...cut(s1, [X(-240), s1.entry[1] - 30], [s1.exit[0] + 30, Z(680)]), ...P([[46, 680]])] }],
    [{ id: 'A', risk: 0, pts: P([[46, 680], [146, 680], [156, 675], [160, 664], [160, 474]]) },
     { id: 'B', risk: 0.4, pts: [...P([[46, 680]]), ...cut(s3, [s3.entry[0] - 30, Z(680)], [X(160), s3.exit[1] - 30]), ...P([[160, 474]])] }],
    [
      { id: 'E', risk: 0.6, pts: P([[160, 474], [160, 380], [160, 300], [160, 56], [155, 45], [144, 40], [34, 40]]) },
      { id: 'A', risk: 0, pts: P([[160, 474], [160, 454], [165, 444], [176, 440], [226, 440], [236, 435], [240, 424], [240, 56], [235, 45], [224, 40], [34, 40]]) },
      { id: 'B', risk: 0.5, pts: [...P([[160, 474], [160, 380], [160, 300]]), ...cut(s2, [X(160), s2.entry[1] + 30], [s2.exit[0] - 30, Z(40)]), ...P([[34, 40]])] }
    ],
    [{ id: 'A', risk: 0, pts: P([[34, 40], [12, 40], [3, 45], [0, 56], [0, 86]]) }]
  ]

  // 一般車の周回路（通りの中心線の長方形。左側通行で回る）
  const trafficLoops = [
    [-160, 120, -80, 200], [0, 200, 80, 280], [-240, 440, -160, 600], [80, 440, 160, 600], [160, 120, 240, 280],
    [-80, 520, 0, 680], [80, 600, 240, 680], [-240, 40, -80, 120], [-80, 360, 80, 440], [0, 40, 160, 120],
    [-240, 120, 0, 280], [0, 520, 240, 600], [-160, 600, 80, 680]
  ].map(([a, b, c, d]) => [X(a), Z(b), X(c), Z(d)])

  return {
    roads, slabs, boxes, props, dirt: dirtRects, repair, decor: [], gates, grid, labels, routes, trees, laps: 2,
    shortcuts, lotRects, pickups, bounds: CITY_BOUNDS, fallY: -3, water: { z0: CANAL.z0, z1: CANAL.z1, y: -2.2 }, trafficLoops, grassRects, cityGrid: { XS, ZS, WIDE_X: [...WIDE_X], WIDE_Z: [...WIDE_Z] },
    nav: { XS, ZS, canal: { z0: CANAL.z0, z1: CANAL.z1 }, bridges: BRIDGES, downtownX: X(130), downtownZ: Z(360), mid: MID },
    ground: (x, z) => grassRects.some(r => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) ? 'grass' : 'road'
  }
}

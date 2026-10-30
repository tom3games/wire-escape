// コース定義と、地面・壁・壊せる物の問い合わせ。ブラウザとサーバーの両方が同じものを使う。
// 座標: x=東西, y=上, z=北。レースはおおむね z の小さい方（南のスタート）から大きい方（北のゴール）へ進む。
//
// 区間とルート
//   1. 旧市街      A 西の大通り(長い) / B 工事中の封鎖道路を突破(破壊) / D 路地の直角連続(テクニカル)
//   2. 工業地帯    A 迂回路(修理ピットあり) / B 倉庫の壁を割って中を突っ切る(破壊・要速度) / C 建設途中の高架でジャンプ
//   3. 大峡谷      A 西を大回り(修理ピットあり) / D 東の崖っぷち林道(テクニカル) / E 崩れた橋を飛ぶ(要ブースト・落ちたら谷底)
//   4. 丘と崖      A 東の外周(修理ピットあり) / D 西の山道ヘアピン / B+E 鉱山道を突破して崖から飛び降りる(高リスク)

import { DESTRUCT, PHYS, SURFACE, GAME } from './config.js'
import { buildCity, cityTerrain } from './city.js'

export const FALL_SEC = 1.6  // 鉄塔が倒れ切るまで
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const lerp = (a, b, t) => a + (b - a) * t

// ---------------------------------------------------------------- 地形
export const BOUNDS = { x0: -305, x1: 235, z0: -60, z1: 2330 }
export const CANYON = { x0: -230, x1: 150, z0: 660, z1: 760, floor: -70, wall: 6 }
const HILL = { x0: -50, x1: 50, z0: 910, z1: 1045, top: 20, slope: 40, cliff: 2 }

function baseHeight(z) {
  if (z < 760) return 0
  if (z < 770) return lerp(0, -4, (z - 760) / 10)
  if (z < 830) return -4
  if (z < 870) return lerp(-4, 0, sstep(830, 870, z))
  return 0
}

function noise(x, z) {
  return Math.sin(x * 0.11 + z * 0.07) * 0.35 + Math.sin(x * 0.043 - z * 0.061 + 1.7) * 0.5 + Math.sin(z * 0.19 + x * 0.02) * 0.12
}

// いま描いているステージの地形（画面側が使う）。サーバーは部屋ごとに world.terrain を使う
let currentTerrain = null
export function terrain(x, z) { return (currentTerrain || tougeTerrain)(x, z) }

function tougeTerrain(x, z) {
  let h = baseHeight(z)
  // 峡谷
  const c = CANYON
  const mz = sstep(c.z0 - c.wall, c.z0, z) * (1 - sstep(c.z1, c.z1 + c.wall, z))
  const mx = sstep(c.x0 - c.wall, c.x0, x) * (1 - sstep(c.x1, c.x1 + c.wall, x))
  const m = mz * mx
  if (m > 0) h = lerp(h, c.floor + noise(x, z) * 3, m)
  // 丘（北側だけ切り立った崖）
  const H = HILL
  const dx = Math.max(H.x0 - x, x - H.x1, 0)
  const dzS = Math.max(H.z0 - z, 0)
  const dzN = Math.max(z - H.z1, 0)
  const hm = (1 - sstep(0, H.slope, Math.hypot(dx, dzS))) * (1 - sstep(0, H.cliff, dzN))
  if (hm > 0) h += H.top * hm
  // 峠の山（区間5で登り、区間6で下る）。道の通る真ん中だけ少し低い（峠）
  if (z > 1240 && z < 2220) {
    const t = (z - 1240) / (2220 - 1240)
    h += Math.pow(Math.sin(Math.PI * t), 1.15) * 78 * (1 - 0.22 * Math.exp(-((x / 140) ** 2)))
  }
  // 区間3と4の野原は少し波打たせる（市街と工業地帯は平ら）
  if (z > 640 && m < 0.5) h += noise(x, z) * sstep(640, 700, z) * (1 - m * 2)
  // 外周の山
  const ox = Math.max(BOUNDS.x0 - x, x - BOUNDS.x1, 0)
  const oz = Math.max(BOUNDS.z0 - z, z - BOUNDS.z1, 0)
  const o = ox + oz
  if (o > 0) h += Math.pow(Math.min(1, o / 70), 1.4) * 70 + noise(x * 2, z * 2) * Math.min(1, o / 20) * 4
  return h
}

// 林の濃さ（木の配置と、地面の落ち葉の量に使う）
export function forestDensity(x, z) {
  const n = Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017) + Math.sin(x * 0.051 - z * 0.033) * 0.6 + Math.sin((x + z) * 0.009) * 0.5
  const d = Math.max(0, Math.min(1, (n + 0.55) / 1.4))
  return z > 1240 ? Math.min(1, d + 0.35) : d // 峠は杉林が濃い
}

function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz
  let t = L ? ((x - ax) * dx + (z - az) * dz) / L : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t))
}

// ---------------------------------------------------------------- コースのデータ
function build() {
  const roads = []      // { pts:[[x,z],...], w, surf }
  const slabs = []      // 橋・高架・ジャンプ台。{ cx, cz, yaw, hw, hl, y0, y1, thick, surf, solid, kind, needs? }
  const boxes = []      // 壊れない壁・建物。{ cx, cz, yaw, hw, hl, y0, h, kind, color }
  const props = []      // 壊せる物の配置。{ type, x, z, yaw, y? }
  const dirt = []       // 土の地面（四角）
  const repair = []     // 修理ピット
  const decor = []      // 見た目だけ（木・岩）
  const labels = []     // 地図用のルート名

  const road = (pts, w = 14, surf = 'road') => roads.push({ pts, w, surf })
  const box = (x0, z0, x1, z1, h, kind = 'building', color = null, y0 = 0) =>
    boxes.push({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, yaw: 0, hw: Math.abs(x1 - x0) / 2, hl: Math.abs(z1 - z0) / 2, y0, h, kind, color })
  const prop = (type, x, z, yaw = 0, y) => props.push({ type, x, z, yaw, y })
  const rowX = (type, x0, x1, z, step, yaw = 0) => { for (let x = x0; x <= x1 + 1e-6; x += step) prop(type, x, z, yaw) }
  const rowZ = (type, x, z0, z1, step, yaw = Math.PI / 2) => { for (let z = z0; z <= z1 + 1e-6; z += step) prop(type, x, z, yaw) }

  // ======================================== 区間1 旧市街 (z -40..330)
  road([[0, -45], [0, 128]], 16)
  road([[-96, 128], [44, 128]], 16)
  road([[-96, 128], [-96, 308]], 16)                 // A 西の大通り
  road([[-96, 308], [58, 308]], 16)
  road([[0, 308], [0, 360]], 16)
  road([[0, 136], [0, 300]], 14)                     // B 封鎖道路
  road([[34, 128], [34, 180], [60, 180], [60, 240], [34, 240], [34, 308]], 9) // D 路地
  labels.push({ x: -96, z: 220, t: 'A' }, { x: 0, z: 220, t: 'B' }, { x: 47, z: 210, t: 'D' })

  // 街区（壁として効く）
  const city = [
    [-110, -45, -12, 118, 'w'], [12, -45, 110, 118, 'e'],
    [-84, 138, -12, 186, 'w'], [-84, 190, -12, 246, 'w'], [-84, 250, -12, 298, 'w'],
    [11, 138, 29.5, 196, 'e'], [11, 200, 29.5, 298, 'e'],
    [38.5, 184.5, 55.5, 235.5, 'e'],
    [38.5, 138, 64.5, 175.5, 'e'], [64.5, 138, 110, 210, 'e'], [64.5, 214, 110, 298, 'e'], [38.5, 244.5, 64.5, 298, 'e'],
    [-130, 118, -106, 330, 'w'],
    [-110, 318, -12, 346, 'w'], [12, 318, 45, 340, 'e'], [59, 318, 110, 340, 'e'], [66, 300, 110, 318, 'e']
  ]
  let bi = 0
  for (const [x0, z0, x1, z1] of city) box(x0, z0, x1, z1, 10 + ((bi++ * 7919) % 5) * 5, 'building')
  // スタート背後の壁
  box(-12, -60, 12, -52, 4, 'wall')

  // B の封鎖: 入口と出口に仮設フェンスとバリケード、中に木材の山とコーン
  prop('sign', -9.2, 134, 0); prop('sign', 9.2, 134, 0)
  // 大通り沿いの街灯と看板（壊せる演出）
  for (let z = 10; z <= 110; z += 25) { prop('lamp', -9.5, z); prop('lamp', 9.5, z) }
  for (let z = 150; z <= 290; z += 28) prop('lamp', -86.5, z)
  prop('sign', -86.8, 200, Math.PI / 2); prop('sign', 37.5, 160, Math.PI / 2)
  // 路地の角のゴミ箱代わりのコーン

  // ======================================== 区間2 工業地帯 (z 330..625)
  road([[0, 360], [0, 400]], 16)
  road([[-62, 400], [8, 400]], 14)                   // A
  road([[-62, 400], [-62, 568]], 14)
  road([[-62, 568], [0, 568]], 14)
  road([[0, 568], [0, 640]], 16)
  road([[0, 400], [0, 418]], 14)                     // B 倉庫へ
  road([[0, 546], [0, 568]], 14)
  road([[52, 308], [52, 336], [56, 352], [56, 362]], 12) // C 高架への取り付け
  road([[56, 590], [56, 600], [6, 616]], 12)
  road([[64, 452], [74, 470], [74, 590], [60, 600]], 8, 'dirt') // 高架から落ちた人の土の道
  labels.push({ x: -62, z: 480, t: 'A' }, { x: 0, z: 480, t: 'B' }, { x: 56, z: 470, t: 'C' })
  dirt.push({ x0: 42, z0: 362, x1: 92, z1: 600 })
  repair.push({ x0: -88, z0: 455, x1: -69.5, z1: 505, name: 'PIT 1' })

  // 倉庫（屋根なし）。南北の真ん中の壁は壊せるが、相当な速さが要る
  const W = { x0: -40, x1: 40, z0: 418, z1: 546 }
  box(W.x0, W.z0, -8, W.z0 + 1.2, 8, 'whouse')
  box(8, W.z0, W.x1, W.z0 + 1.2, 8, 'whouse')
  box(W.x0, W.z1 - 1.2, -8, W.z1, 8, 'whouse')
  box(8, W.z1 - 1.2, W.x1, W.z1, 8, 'whouse')
  box(W.x0, W.z0, W.x0 + 1.2, W.z1, 8, 'whouse')
  box(W.x1 - 1.2, W.z0, W.x1, W.z1, 8, 'whouse')
  prop('wall', 0, W.z0 + 0.6)
  prop('wall', 0, W.z1 - 0.6)
  for (const [x, z] of [[-18, 450], [18, 450], [-18, 515], [18, 515]]) box(x - 0.8, z - 0.8, x + 0.8, z + 0.8, 8, 'pillar')
  prop('lumber', -6, 470, 0.4); prop('lumber', 7, 495, -0.3); prop('lumber', -2, 525, 0)
  prop('sign', -9.5, 410, 0); prop('sign', 9.5, 410, 0)
  // 工業地帯の外周と倉庫まわり
  box(-125, 346, -110, 625, 6, 'wall'); box(95, 346, 110, 625, 6, 'wall')
  box(-110, 346, -12, 392, 9, 'building'); box(12, 366, 44, 392, 9, 'building')
  box(-110, 408, -90, 452, 12, 'building'); box(-110, 508, -90, 560, 12, 'building')
  box(-53, 408, -42, 560, 7, 'building')
  box(-110, 576, -12, 612, 9, 'building'); box(12, 576, 44, 600, 7, 'building')
  for (const [x, z] of [[46, 405], [46, 420], [88, 380], [86, 560]]) box(x - 1.3, z - 6, x + 1.3, z + 6, 2.6, 'container')
  for (let z = 410; z <= 560; z += 30) prop('lamp', -70.5, z)

  // 建設途中の高架。取り付け → 高架1 → 板のジャンプ台 → 36m の切れ目 → 高架2 → 降り
  slabs.push({ cx: 56, cz: 381, yaw: 0, hw: 6, hl: 19, y0: 0, y1: 8, thick: 1.2, surf: 'road', solid: true, kind: 'ramp' })
  slabs.push({ cx: 56, cz: 426, yaw: 0, hw: 6, hl: 26, y0: 8, y1: 8, thick: 1.4, surf: 'road', solid: true, kind: 'deck' })
  slabs.push({ cx: 54, cz: 448, yaw: 0, hw: 3.85, hl: 4, y0: 8, y1: 9.8, thick: 0.4, surf: 'wood', solid: true, kind: 'kicker' })
  slabs.push({ cx: 56, cz: 519, yaw: 0, hw: 6, hl: 31, y0: 7, y1: 7, thick: 1.4, surf: 'road', solid: true, kind: 'deck' })
  slabs.push({ cx: 56, cz: 570, yaw: 0, hw: 6, hl: 20, y0: 7, y1: 0, thick: 1.2, surf: 'road', solid: true, kind: 'ramp' })
  for (const sx of [49.6, 62.4]) { box(sx - 0.3, 362, sx + 0.3, 400, 9, 'sidewall'); box(sx - 0.3, 550, sx + 0.3, 590, 8, 'sidewall') }
  // 倒れる足場。ぶつけると切れ目に倒れて細い板の橋になる（tower の id を needs に入れて後で結ぶ）
  // 鉄塔の高さ 48m がそのまま切れ目（z 452..488）をまたぐ長さになる
  // 倒れ始めてから FALL_SEC 後に通れるようになる（根元の瓦礫が坂、鉄塔の背が細い橋）
  slabs.push({ cx: 59.6, cz: 437.5, yaw: 0, hw: 1.6, hl: 3.5, y0: 8.0, y1: 9.2, thick: 0.6, surf: 'wood', solid: false, kind: 'wedge', needs: 'tower' })
  slabs.push({ cx: 59.6, cz: 464.75, yaw: 0, hw: 1.6, hl: 23.75, y0: 9.2, y1: 8.2, thick: 0.6, surf: 'wood', solid: true, kind: 'plank', needs: 'tower' })
  prop('tower', 59.6, 440, 0, 8)
  for (const sx of [49.8, 62.2]) {
    boxes.push({ cx: sx, cz: 426, yaw: 0, hw: 0.25, hl: 26, y0: 8, h: 1.0, kind: 'rail' })
    boxes.push({ cx: sx, cz: 519, yaw: 0, hw: 0.25, hl: 31, y0: 7, h: 1.0, kind: 'rail' })
  }
  for (let z = 405; z <= 445; z += 20) for (const sx of [51, 61]) box(sx - 0.7, z - 0.7, sx + 0.7, z + 0.7, 6.6, 'pillar')
  for (let z = 495; z <= 545; z += 25) for (const sx of [51, 61]) box(sx - 0.7, z - 0.7, sx + 0.7, z + 0.7, 5.6, 'pillar')
  box(48, 547, 64, 549, 3, 'wall') // 高架下の行き止まり

  // ======================================== 区間3 大峡谷 (z 625..850)
  road([[0, 640], [0, 650]], 14)
  // A 西の大回り
  road([[0, 640], [-260, 640], [-260, 800], [0, 800], [0, 860]], 14)
  // D 東の崖っぷち林道（細い土の道）
  road([[0, 640], [150, 640], [172, 652], [168, 690], [184, 712], [170, 745], [178, 778], [150, 800], [0, 800]], 7, 'dirt')
  labels.push({ x: -255, z: 720, t: 'A' }, { x: 0, z: 720, t: 'E' }, { x: 178, z: 720, t: 'D' })
  repair.push({ x0: -300, z0: 690, x1: -268, z1: 740, name: 'PIT 2' })
  // 崩れた橋。手前の板が跳ね上がっていて、60m 先の降り坂に着地する
  slabs.push({ cx: 0, cz: 666, yaw: 0, hw: 7, hl: 16, y0: 0, y1: 0, thick: 2.2, surf: 'road', solid: true, kind: 'bridge' })
  slabs.push({ cx: 0, cz: 686, yaw: 0, hw: 7, hl: 4, y0: 0, y1: 1.8, thick: 2.2, surf: 'road', solid: true, kind: 'bridge' })
  slabs.push({ cx: 0, cz: 766, yaw: 0, hw: 8, hl: 16, y0: 0, y1: -4, thick: 2.2, surf: 'road', solid: true, kind: 'bridge' })
  for (const sx of [-7.3, 7.3]) {
    boxes.push({ cx: sx, cz: 669, yaw: 0, hw: 0.3, hl: 19, y0: 0, h: 1.1, kind: 'rail' })
    boxes.push({ cx: sx * 8.3 / 7.3, cz: 774, yaw: 0, hw: 0.3, hl: 8, y0: -4, h: 1.1, kind: 'rail' })
  }
  // 主塔（見た目は scene.js が描く）
  for (const z of [650, 776]) for (const sx of [-9.2, 9.2]) boxes.push({ cx: sx, cz: z, yaw: 0, hw: 1.2, hl: 1.2, y0: -70, h: 108, kind: 'pylon' })
  // 橋脚（谷底から）
  for (const z of [664, 680, 756]) for (const sx of [-5, 5]) boxes.push({ cx: sx, cz: z, yaw: 0, hw: 1.1, hl: 1.1, y0: -72, h: 70, kind: 'pillar' })
  // 落ちた橋の残骸（見た目と、谷底の障害）
  decor.push({ kind: 'debris', x: 3, z: 712, y: -66, s: 6 }, { kind: 'debris', x: -4, z: 725, y: -67, s: 5 })
  // 谷の縁のガードレール（壊れない）
  boxes.push({ cx: -120, cz: 650.5, yaw: 0, hw: 112, hl: 0.25, y0: 0, h: 0.9, kind: 'rail' })
  boxes.push({ cx: 79, cz: 650.5, yaw: 0, hw: 71, hl: 0.25, y0: 0, h: 0.9, kind: 'rail' })
  boxes.push({ cx: -120, cz: 790, yaw: 0, hw: 112, hl: 0.25, y0: -4, h: 0.9, kind: 'rail' })
  boxes.push({ cx: 79, cz: 790, yaw: 0, hw: 71, hl: 0.25, y0: -4, h: 0.9, kind: 'rail' })
  prop('sign', -10, 646, 0); prop('sign', 10, 646, 0)
  // 林道の岩
  for (const [x, z, r] of [[160, 670, 3], [180, 690, 2.5], [158, 720, 3], [192, 740, 3], [162, 760, 2.5], [188, 790, 3]])
    boxes.push({ cx: x, cz: z, yaw: x * 0.3, hw: r, hl: r * 0.8, y0: -2, h: r * 1.6, kind: 'rock' })
  for (let z = 660; z <= 790; z += 22) prop('fence', 196, z, Math.PI / 2)

  // ======================================== 区間4 丘と崖 (z 850..1170)
  road([[0, 860], [0, 872], [110, 892], [145, 925], [148, 990], [125, 1065], [50, 1112], [0, 1130]], 14)   // A 東外周
  road([[0, 860], [-70, 876], [-98, 918], [-76, 948], [-100, 982], [-78, 1016], [-98, 1054], [-55, 1100], [0, 1130]], 8)  // D 山道
  road([[0, 872], [0, 1046]], 9, 'dirt')                  // B 鉱山道（丘を直登）
  road([[0, 1060], [0, 1262]], 16)                        // 町の通り

  // ======================================== 区間5 峠の登り (z 1170..1750) と 区間6 下り (..2270)
  // 本道は九十九折り。旧街道（中山道のような細い石と土の道）は真っすぐ登るが狭く、本道と何度も交差する
  const TOUGE_UP = [[0, 1262], [40, 1276], [150, 1300], [168, 1318], [160, 1338], [120, 1350], [-150, 1380], [-168, 1398], [-160, 1418], [-120, 1430],
    [150, 1460], [168, 1478], [160, 1498], [120, 1510], [-140, 1545], [-158, 1563], [-150, 1583], [-110, 1595], [120, 1625], [136, 1643], [128, 1663], [90, 1675], [-50, 1698], [-68, 1708], [-62, 1724], [-30, 1738], [0, 1750]]
  const OLD_ROAD = [[0, 1262], [-42, 1288], [12, 1318], [-58, 1352], [6, 1392], [-62, 1428], [2, 1468], [-58, 1508], [6, 1548], [-54, 1588], [6, 1628], [-48, 1668], [2, 1702], [-24, 1728], [0, 1750]]
  const TOUGE_DOWN = [[0, 1750], [20, 1770], [90, 1800], [110, 1830], [60, 1870], [-60, 1900], [-110, 1935], [-80, 1975], [40, 2005], [100, 2040], [70, 2085], [-40, 2110],
    [-80, 2150], [-40, 2190], [0, 2210], [0, 2330]]
  road(TOUGE_UP, 10)
  road(OLD_ROAD, 6, 'dirt')
  road(TOUGE_DOWN, 10)
  labels.push({ x: 160, z: 1400, t: 'A' }, { x: -30, z: 1500, t: 'D' }, { x: 100, z: 1950, t: 'A' })
  repair.push({ x0: 175, z0: 1450, x1: 200, z1: 1490, name: 'PIT 4' })
  // 峠の茶屋（見た目）と頂上の看板
  box(-40, 1752, -24, 1764, 5, 'building'); box(24, 1736, 40, 1746, 4, 'building')
  prop('sign', 12, 1745, 0.6); prop('sign', -12, 1756, 0.6)
  // ゴールの村
  for (const [x0, z0, x1, z1] of [[-70, 2235, -14, 2262], [-70, 2278, -14, 2310], [14, 2235, 70, 2262], [14, 2278, 70, 2310]])
    box(x0, z0, x1, z1, 7 + ((bi++ * 7919) % 3) * 3, 'building')
  for (let z = 2230; z <= 2310; z += 20) { prop('lamp', -10, z); prop('lamp', 10, z) }
  road([[-60, 1100], [60, 1100]], 10)
  labels.push({ x: 128, z: 990, t: 'A' }, { x: 0, z: 980, t: 'B/E' }, { x: -112, z: 990, t: 'D' })
  repair.push({ x0: 156, z0: 935, x1: 180, z1: 985, name: 'PIT 3' })
  // 鉱山道の封鎖と障害
  prop('sign', -6.5, 880, 0); prop('sign', 6.5, 880, 0)
  // 崖の縁: 壊せるガードレールと板のジャンプ台、町の土砂の山（降り坂で着地すると軽傷）
  rowX('guardrail', -18, 18, 1043.5, 4)
  slabs.push({ cx: 0, cz: 1038, yaw: 0, hw: 4, hl: 4, y0: 20, y1: 21.6, thick: 0.4, surf: 'wood', solid: true, kind: 'kicker' })
  slabs.push({ cx: 0, cz: 1103, yaw: 0, hw: 9, hl: 25, y0: 10, y1: 0, thick: 10, surf: 'dirt', solid: true, kind: 'mound' })
  // 町の建物（ゴール前）
  for (const [x0, z0, x1, z1] of [[-90, 1140, -14, 1170], [-90, 1174, -14, 1210], [14, 1140, 90, 1170], [14, 1174, 90, 1210]])
    box(x0, z0, x1, z1, 9 + ((bi++ * 7919) % 4) * 4, 'building')
  for (let z = 1120; z <= 1200; z += 20) { prop('lamp', -10, z); prop('lamp', 10, z) }
  for (let z = 880; z <= 1040; z += 30) prop('sign', 140, z, Math.PI / 2)

  // 外周の見えない壁
  box(BOUNDS.x0 - 10, BOUNDS.z0, BOUNDS.x0, BOUNDS.z1, 40, 'bound')
  box(BOUNDS.x1, BOUNDS.z0, BOUNDS.x1 + 10, BOUNDS.z1, 40, 'bound')
  box(BOUNDS.x0, BOUNDS.z1, BOUNDS.x1, BOUNDS.z1 + 10, 40, 'bound')


  // チェックポイント（全部 z 一定の線。どのルートを通っても必ず横切る）
  const gates = [
    { z: 330, x0: -110, x1: 100, name: 'CP1', respawn: { x: 0, z: 338, yaw: 0 } },
    { z: 625, x0: -110, x1: 95, name: 'CP2', respawn: { x: 0, z: 588, yaw: 0 } },
    { z: 850, x0: BOUNDS.x0, x1: BOUNDS.x1, name: 'CP3', respawn: { x: 0, z: 856, yaw: 0 } },
    { z: 1170, x0: BOUNDS.x0, x1: BOUNDS.x1, name: 'CP4', respawn: { x: 0, z: 1175, yaw: 0 } },
    { z: 1750, x0: BOUNDS.x0, x1: BOUNDS.x1, name: 'CP5', respawn: { x: 6, z: 1756, yaw: 0.75 } },
    { z: 2270, x0: BOUNDS.x0, x1: BOUNDS.x1, name: 'GOAL', respawn: { x: 0, z: 2275, yaw: 0 } }
  ]
  const grid = []
  for (let i = 0; i < 8; i++) grid.push({ x: i % 2 ? 3.6 : -3.6, z: 2 - Math.floor(i / 2) * 9, yaw: 0 })

  // ---------------- ジャンプ台（道の片側に寄せて置く。避けても乗ってもいい）
  // roll: 1/-1 は曲がった台（飛ぶと横に回る＝バレルロール）。0 は普通の台（ドリフトしながら飛ぶと水平に回る）
  const kicker = (x, z, dx, dz, roll = 0, len = 9, rise = 1.7, hw = 3.2) => {
    const l = Math.hypot(dx, dz); dx /= l; dz /= l
    const g0 = terrain(x - dx * len / 2, z - dz * len / 2), g1 = terrain(x + dx * len / 2, z + dz * len / 2)
    slabs.push({ cx: x, cz: z, yaw: Math.atan2(dx, dz), hw, hl: len / 2, y0: g0 + 0.02, y1: g1 + rise, thick: 0.4, surf: 'wood', solid: true, kind: roll ? 'roll' : 'kicker', roll })
  }
  kicker(-4.5, 62, 0, 1, 1)                 // スタート直後の大通り（左車線）
  kicker(3.5, 205, 0, 1, 0)                 // 区間1 B（封鎖道路はもう開いている）
  kicker(-3.5, 262, 0, 1, -1)
  kicker(-66, 482, 0, 1, 1)                 // 区間2 A の迂回路
  kicker(-120, 636, -1, 0, -1)              // 区間3 A 谷の南の縁（西向き）
  kicker(-150, 804, 1, 0, 1)                // 区間3 A 北の縁（東向き）
  kicker(150, 955, 0.05, 1, 0, 10, 2.2)     // 区間4 A 東の外周
  kicker(-30, 1897, -1, 0.25, 1)            // 峠の下り
  kicker(70, 2022, 0.85, 0.5, -1)
  kicker(-62, 2135, -0.5, 0.75, 0)

  // ---------------- 道沿いのガードレール（区間3〜6の舗装路）。壊すと道の外へ出られる（近道・崖下り）
  const allSegs = []
  roads.forEach((r, ri) => { for (let i = 0; i < r.pts.length - 1; i++) allSegs.push({ ri, i, ax: r.pts[i][0], az: r.pts[i][1], bx: r.pts[i + 1][0], bz: r.pts[i + 1][1], hw: r.w / 2 }) })
  const onSlab = (x, z) => slabs.some(sl => { const q = toLocal(sl, x, z); return Math.abs(q.u) < sl.hw + 1 && Math.abs(q.v) < sl.hl + 1 })
  roads.forEach((r, ri) => {
    if (r.surf !== 'road') return
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1]
      const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L
      for (let d = 3; d < L - 1; d += 4.2) {
        const cx = ax + dx * d, cz = az + dz * d
        if (cz < 640 || (cz > 1050 && cz < 1262) || cz > 2225) continue // 市街・町・村には付けない
        for (const side of [-1, 1]) {
          const off = r.w / 2 + 0.9
          const x = cx - dz * off * side, z = cz + dx * off * side
          if (terrain(x, z) < -3 || onSlab(x, z)) continue
          // 他の道（交差点・分かれ道・九十九折りの内側）にかかるなら付けない
          let blocked = false
          for (const s of allSegs) {
            if (s.ri === ri && s.i === i) continue
            // 同じ道の隣の区間（曲がり角）は、路面にかかるときだけ外す。外側のレールは残す
            const margin = s.ri === ri ? 0.4 : 2.2
            if (segDist(x, z, s.ax, s.az, s.bx, s.bz) < s.hw + margin) { blocked = true; break }
          }
          if (blocked) continue
          props.push({ type: 'guardrail', x, z, yaw: Math.atan2(-dz, dx), rail: true })
        }
      }
    }
  })

  // ---------------- 林（当たり判定あり。道・建物・ピットの近くには生やさない）
  const trees = []
  {
    let seed = 11
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const SP = 8
    for (let z = 640; z < BOUNDS.z1; z += SP) for (let x = BOUNDS.x0 + 4; x < BOUNDS.x1 - 4; x += SP) {
      const px = x + (rnd() - 0.5) * SP * 0.9, pz = z + (rnd() - 0.5) * SP * 0.9
      const s = 0.75 + rnd() * 0.65, r = rnd() * 6.28, keep = rnd()
      if (pz > 1050 && pz < 1240) continue
      if (keep > forestDensity(px, pz) * 0.95) continue
      const h = terrain(px, pz)
      if (h < -2.5) continue
      // 急な斜面（谷の縁など）には生やさない。地面の描画（4m 刻み）と高さがずれて宙に浮いて見える
      const slope = Math.max(Math.abs(terrain(px + 4, pz) - h), Math.abs(terrain(px - 4, pz) - h), Math.abs(terrain(px, pz + 4) - h), Math.abs(terrain(px, pz - 4) - h))
      if (slope > 1.6) continue
      if (allSegs.some(sg => segDist(px, pz, sg.ax, sg.az, sg.bx, sg.bz) < sg.hw + 3.5)) continue
      if (boxes.some(o => Math.abs(px - o.cx) < o.hw + 3 && Math.abs(pz - o.cz) < o.hl + 3)) continue
      if (repair.some(q => px > q.x0 - 4 && px < q.x1 + 4 && pz > q.z0 - 4 && pz < q.z1 + 4)) continue
      if (onSlab(px, pz)) continue
      trees.push({ x: px, y: h, z: pz, s, r })
    }
    // 木は折れる（壊せる物）。見た目は scene.js がまとめて描き、折れた1本だけ差し替える
    trees.forEach((t, ti) => props.push({ type: 'tree', x: t.x, z: t.z, yaw: 0, y: t.y - 0.5, ti }))
  }

  // CPU の走行線。区間ごとにルートを選ぶ。need: 'boost' はブーストを溜めてから入る / risk は挑む確率の目安
  const routes = [
    [ // 区間1
      { id: 'A', risk: 0, pts: [[0, 10], [0, 122], [-90, 128], [-96, 140], [-96, 300], [-88, 308], [0, 310]] },
      { id: 'B', risk: 0.5, pts: [[0, 10], [0, 132], [2.5, 165], [3.8, 180], [3.8, 200], [-1, 212], [-3.8, 222], [-3.8, 238], [1, 248], [3.8, 258], [3.8, 266], [-1, 274], [0, 290], [0, 310]] },
      { id: 'D', risk: 0.3, pts: [[0, 10], [0, 110], [4, 122], [16, 127], [28, 129], [33.5, 136], [34, 172], [37, 179], [44, 180], [55, 180.5], [59.5, 186], [60, 232], [57, 239], [50, 240], [40, 240], [35, 244], [34, 250], [34, 300], [30, 307], [20, 309], [0, 310]] }
    ],
    [ // 区間2
      { id: 'A', risk: 0, pts: [[0, 310], [0, 394], [-8, 400], [-56, 400], [-62, 408], [-62, 560], [-54, 568], [-4, 568], [0, 576], [0, 632]] },
      { id: 'B', risk: 0.7, need: 'boost', boostFrom: 372, pts: [[0, 310], [0, 418], [0, 440], [3, 470], [0, 482], [-3.5, 495], [0, 508], [4, 525], [0, 546], [0, 632]] },
      { id: 'C', risk: 0.6, need: 'boost', boostFrom: 405, pts: [[0, 310], [30, 309], [44, 310], [51, 316], [52, 334], [55, 350], [56, 362], [55, 395], [53.5, 410], [53.5, 452], [54, 490], [56, 552], [56, 590], [52, 602], [20, 612], [0, 622], [0, 632]] }
    ],
    [ // 区間3
      { id: 'A', risk: 0, pts: [[0, 632], [0, 636], [-8, 640], [-252, 640], [-260, 648], [-260, 792], [-252, 800], [-8, 800], [0, 808], [0, 858]] },
      { id: 'D', risk: 0.4, pts: [[0, 632], [0, 636], [8, 640], [148, 640], [170, 652], [168, 690], [182, 712], [170, 745], [176, 778], [150, 800], [8, 800], [0, 808], [0, 858]] },
      { id: 'E', risk: 0.8, need: 'boost', boostFrom: 650, pts: [[0, 632], [0, 690], [0, 760], [0, 858]] }
    ],
    [ // 区間4
      { id: 'A', risk: 0, pts: [[0, 858], [0, 868], [20, 875], [105, 890], [140, 920], [148, 990], [125, 1065], [50, 1112], [10, 1128], [0, 1140], [0, 1190]] },
      { id: 'D', risk: 0.3, pts: [[0, 858], [-20, 864], [-70, 876], [-98, 918], [-76, 948], [-100, 982], [-78, 1016], [-98, 1054], [-55, 1100], [-10, 1128], [0, 1140], [0, 1190]] },
      { id: 'BE', risk: 0.7, pts: [[0, 858], [0, 900], [0, 1046], [0, 1092], [0, 1140], [0, 1190]] }
    ],
    [ // 区間5 峠の登り
      { id: 'A', risk: 0, pts: [[0, 1190], ...TOUGE_UP, [10, 1760]] },
      { id: 'D', risk: 0.5, pts: [[0, 1190], ...OLD_ROAD, [10, 1760]] }
    ],
    [ // 区間6 峠の下り
      { id: 'A', risk: 0, pts: [[10, 1760], ...TOUGE_DOWN.slice(1, -1), [0, 2290]] }
    ]
  ]

  // 近道（看板・地図・案内に使う）とニトロ缶
  const shortcuts = [
    { entry: [0, 400], inA: [0, 418], outB: [0, 546], exit: [0, 560], out: [0, -1], label: 'WALL' },          // 倉庫の壁
    { entry: [40, 345], inA: [56, 362], outB: [56, 590], exit: [40, 610], out: [0, -1], label: 'JUMP' },       // 建設途中の高架
    { entry: [0, 640], inA: [0, 650], outB: [0, 782], exit: [0, 800], out: [0, -1], label: 'JUMP' },          // 崩れた橋
    { entry: [0, 862], inA: [0, 872], outB: [0, 1046], exit: [0, 1100], out: [0, -1], label: 'CLIFF' },       // 鉱山道から崖
    { entry: [0, 1262], inA: [-42, 1288], outB: [-24, 1728], exit: [0, 1750], out: [0, -1], label: 'OLD ROAD' } // 旧街道
  ]
  const pickups = [
    { x: 0, z: 470, amount: 0.3 }, { x: 0, z: 520, amount: 0.3 },
    { x: 56, z: 420, amount: 0.3 }, { x: 0, z: 960, amount: 0.3 }, { x: 0, z: 1020, amount: 0.3 },
    { x: -10, z: 1340, amount: 0.3 }, { x: 2, z: 1468, amount: 0.3 }, { x: 6, z: 1628, amount: 0.3 }
  ]
  return { roads, slabs, boxes, props, dirt, repair, decor, gates, grid, labels, routes, trees, shortcuts, pickups }
}

// ---------------------------------------------------------------- 空間の索引
const CELL = 24
const key = (cx, cz) => cx * 73856093 ^ cz * 19349663

class Grid {
  constructor() { this.m = new Map() }
  add(item, x0, z0, x1, z1) {
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const k = key(cx, cz)
        let a = this.m.get(k); if (!a) this.m.set(k, a = [])
        a.push(item)
      }
  }
  at(x, z) { return this.m.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || EMPTY }
}
const EMPTY = []

// OBB の外接 AABB
function obbAabb(o, pad = 0) {
  const c = Math.abs(Math.cos(o.yaw || 0)), s = Math.abs(Math.sin(o.yaw || 0))
  const ex = o.hw * c + o.hl * s + pad, ez = o.hw * s + o.hl * c + pad
  return [o.cx - ex, o.cz - ez, o.cx + ex, o.cz + ez]
}

// 点を OBB の局所座標へ（u=横, v=縦）
export function toLocal(o, x, z) {
  const c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0)
  const dx = x - o.cx, dz = z - o.cz
  // yaw 回転で局所 +v（長さ方向）が世界の (sin yaw, cos yaw) を向く
  return { u: dx * c - dz * s, v: dx * s + dz * c }
}
export function toWorld(o, u, v) {
  const c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0)
  return { x: o.cx + u * c + v * s, z: o.cz - u * s + v * c }
}

export function slabTop(sl, v) {
  return lerp(sl.y0, sl.y1, (v + sl.hl) / (2 * sl.hl))
}

// ---------------------------------------------------------------- 世界
export function createWorld(stage = 'touge') {
  const city = stage === 'city'
  const T = city ? buildCity() : build()
  currentTerrain = city ? cityTerrain : tougeTerrain
  const w = {
    ...T,
    stage: city ? 'city' : 'touge',
    terrain: city ? cityTerrain : tougeTerrain,
    bounds: T.bounds || BOUNDS,
    fallY: T.fallY ?? GAME.fallY,
    gates: normalizeGates(T.gates),
    laps: T.laps || 1,
    destroyed: new Set(),      // 壊れた物の id
    destroyedAt: new Map(),    // id -> 壊れたレース時刻
    time: 0,                   // レース時刻（倒れる物の判定に使う）
    objects: [],               // 壊せる物（衝突体つき）
    colliders: [],             // 壊れない衝突体
    slabGrid: new Grid(),
    colGrid: new Grid(),
    roadGrid: new Grid(),
    segs: []
  }

  for (const r of T.roads) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1]
      const s = { ax, az, bx, bz, hw: r.w / 2, surf: r.surf }
      w.segs.push(s)
      w.roadGrid.add(s, Math.min(ax, bx) - r.w, Math.min(az, bz) - r.w, Math.max(ax, bx) + r.w, Math.max(az, bz) + r.w)
    }
  }

  T.slabs.forEach((sl, i) => { sl.id = 'slab' + i; const a = obbAabb(sl); w.slabGrid.add(sl, ...a) })

  for (const b of T.boxes) {
    const c = { ...b, y1: b.y0 + b.h }
    w.colliders.push(c)
    w.colGrid.add(c, ...obbAabb(c, 1))
  }
  // 浮いている板（橋・高架）は側面と裏に当たる
  for (const sl of T.slabs) if (sl.solid) {
    const c = { cx: sl.cx, cz: sl.cz, yaw: sl.yaw, hw: sl.hw, hl: sl.hl, slab: sl, kind: 'slab' }
    w.colliders.push(c)
    w.colGrid.add(c, ...obbAabb(c, 1))
  }

  T.props.forEach((p, i) => {
    const d = DESTRUCT[p.type]
    const id = `${p.type}${i}`
    const y = p.y ?? w.terrain(p.x, p.z)
    const o = { id, type: p.type, cx: p.x, cz: p.z, yaw: p.yaw || 0, hw: d.w / 2, hl: d.l / 2, y0: y, y1: y + d.h, def: d }
    if (p.ti != null) { o.ti = p.ti; T.trees[p.ti].id = id }
    w.objects.push(o)
    w.colGrid.add(o, ...obbAabb(o, 1))
  })
  w.objectById = new Map(w.objects.map(o => [o.id, o]))
  // 倒れる足場と板の橋を結ぶ
  const tower = w.objects.find(o => o.type === 'tower')
  for (const sl of T.slabs) if (sl.needs === 'tower') sl.needs = tower.id

  w.isBroken = id => w.destroyed.has(id)
  w.slabActive = sl => !sl.needs || (w.destroyed.has(sl.needs) && w.time - (w.destroyedAt.get(sl.needs) ?? -99) >= FALL_SEC)
  w.breakObj = id => { if (!w.destroyed.has(id)) { w.destroyed.add(id); w.destroyedAt.set(id, w.time) } }

  // 地面の高さと路面。yHint より stepUp 以上高い板は「頭上」なので無視する
  w.groundAt = (x, z, yHint = 1e9) => {
    let h = w.terrain(x, z)
    let surf = null, slab = null
    for (const sl of w.slabGrid.at(x, z)) {
      if (!w.slabActive(sl)) continue
      const p = toLocal(sl, x, z)
      if (Math.abs(p.u) > sl.hw || Math.abs(p.v) > sl.hl) continue
      const top = slabTop(sl, p.v)
      if (top > h && top <= yHint + PHYS.stepUp) { h = top; surf = sl.surf; slab = sl }
    }
    if (!surf) surf = w.surfaceAt(x, z)
    return { h, surf, slab }
  }

  w.surfaceAt = (x, z) => {
    let best = null
    for (const s of w.roadGrid.at(x, z)) {
      if (distSeg(x, z, s) <= s.hw) { if (s.surf === 'road') return 'road'; best = s.surf }
    }
    if (best) return best
    for (const d of T.dirt) if (x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1) return 'dirt'
    return T.ground ? T.ground(x, z) : z < 625 ? 'dirt' : 'grass'
  }

  w.inRepair = (x, z) => T.repair.find(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) || null

  // 近くの衝突体（壊れた物は除く）
  w.nearby = (x, z) => w.colGrid.at(x, z)

  w.reset = () => { w.destroyed.clear(); w.destroyedAt.clear(); w.time = 0 }
  return w
}

export function distSeg(x, z, s) {
  const dx = s.bx - s.ax, dz = s.bz - s.az
  const L = dx * dx + dz * dz
  let t = L ? ((x - s.ax) * dx + (z - s.az) * dz) / L : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t))
}

export function surfaceDef(name) { return SURFACE[name] || SURFACE.grass }

// ---------------------------------------------------------------- チェックポイント
// ゲートは線分 a-b。nx,nz があればその向きに横切ったときだけ数える。周回コースは gates を laps 回くり返す
export function normalizeGates(gates) {
  return gates.map(g => {
    if (g.a) {
      const cx = (g.a.x + g.b.x) / 2, cz = (g.a.z + g.b.z) / 2
      return { ...g, cx, cz, len: Math.hypot(g.b.x - g.a.x, g.b.z - g.a.z) }
    }
    // 旧形式 { z, x0, x1 }（南から北へ）
    const a = { x: g.x0, z: g.z }, b = { x: g.x1, z: g.z }
    return { ...g, a, b, nx: 0, nz: 1, cx: g.respawn.x, cz: g.z, len: g.x1 - g.x0 }
  })
}
export const totalGates = world => world.gates.length * (world.laps || 1)
export const gateAt = (world, cp) => world.gates[((cp % world.gates.length) + world.gates.length) % world.gates.length]

// 移動した線分がゲートを横切ったか。横切ったら線分上の位置 0..1、そうでなければ -1
export function crossedGate(g, x0, z0, x1, z1) {
  if (g.nx != null && (x1 - x0) * g.nx + (z1 - z0) * g.nz <= 0) return -1
  const ax = g.a.x, az = g.a.z, bx = g.b.x, bz = g.b.z
  const d = (x1 - x0) * (bz - az) - (z1 - z0) * (bx - ax)
  if (Math.abs(d) < 1e-9) return -1
  const t = ((ax - x0) * (bz - az) - (az - z0) * (bx - ax)) / d
  const u = ((ax - x0) * (z1 - z0) - (az - z0) * (x1 - x0)) / d
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1
}

// レースの進み具合（順位付け用）: 通ったゲートの数 + 次のゲートへの近さ
export function progressOf(world, cp, x, z) {
  const prev = cp > 0 ? gateAt(world, cp - 1) : null
  const px = prev ? prev.cx : world.grid[0].x, pz = prev ? prev.cz : world.grid[0].z
  const next = gateAt(world, Math.min(cp, totalGates(world) - 1))
  const L = Math.max(1, Math.hypot(next.cx - px, next.cz - pz))
  const f = Math.max(0, Math.min(1, 1 - Math.hypot(next.cx - x, next.cz - z) / L))
  return cp + f * 0.999
}

// 車の見た目（実在の車種ではない架空のクーペ）。断面を前後につないだ曲面の車体に、
// クリア塗装の材質で空を映す。ぶつけた場所の頂点を押し込んで凹ませ、損傷で部品が外れる。
import * as THREE from 'three'
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js'

// 車種ごとの寸法（m）。W=半幅, L=半長, H=屋根の高さ（車の原点から）, hood=ボンネットの高さ
const SHAPES = {
  runner:  { W: 0.98, L: 2.2, H: 0.86, hood: 0.38, cabF: 0.55, cabR: -0.95, track: 0.82, wing: true, bar: false, haunch: 1.04 },
  bruiser: { W: 1.06, L: 2.3, H: 1.04, hood: 0.5, cabF: 0.65, cabR: -1.15, track: 0.9, wing: false, bar: true, haunch: 1.03 },
  dart:    { W: 0.94, L: 2.1, H: 0.76, hood: 0.32, cabF: 0.45, cabR: -0.85, track: 0.79, wing: true, bar: false, haunch: 1.07 },
  // 一般車
  sedan:   { W: 0.92, L: 2.25, H: 0.98, hood: 0.36, cabF: 0.75, cabR: -1.25, track: 0.8, wing: false, bar: false, haunch: 1.0 },
  van:     { W: 1.0, L: 2.35, H: 1.55, hood: 0.5, cabF: 1.55, cabR: -2.2, track: 0.86, wing: false, bar: false, haunch: 1.0 },
  taxi:    { W: 0.92, L: 2.25, H: 0.98, hood: 0.36, cabF: 0.75, cabR: -1.25, track: 0.8, wing: false, bar: false, haunch: 1.0, sign: true }
}

const WHEEL_R = 0.36, WHEEL_Z = 1.35

// 前後方向の断面の並び（z, 半幅倍率, 上面の高さ）から、なめらかな値を取り出す
function curve(stations, z) {
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i], b = stations[i + 1]
    if (z >= a[0] && z <= b[0]) {
      const t = (z - a[0]) / (b[0] - a[0]), s = t * t * (3 - 2 * t)
      return a.map((v, k) => k === 0 ? z : v + (b[k] - v) * s)
    }
  }
  return z < stations[0][0] ? stations[0] : stations[stations.length - 1]
}

// 断面（右半分の点の列, 下から上へ）を z に沿ってつないで閉じた面を作る
function loft(zs, section, { capFront = true, capBack = true } = {}) {
  const ring0 = section(zs[0])
  const n = ring0.length
  const pos = [], idx = []
  // 右半分 + 左半分（鏡）で1周
  for (const z of zs) {
    const r = section(z)
    for (let i = 0; i < n; i++) pos.push(r[i][0], r[i][1], z)
    for (let i = n - 2; i >= 1; i--) pos.push(-r[i][0], r[i][1], z)
  }
  const per = n + (n - 2)
  for (let k = 0; k < zs.length - 1; k++) for (let i = 0; i < per; i++) {
    const a = k * per + i, b = k * per + (i + 1) % per, c = (k + 1) * per + i, d = (k + 1) * per + (i + 1) % per
    idx.push(a, c, b, b, c, d)
  }
  const cap = (k, flip) => {
    const center = pos.length / 3
    let cx = 0, cy = 0
    for (let i = 0; i < per; i++) { cy += pos[(k * per + i) * 3 + 1] }
    pos.push(cx, cy / per, zs[k])
    for (let i = 0; i < per; i++) {
      const a = k * per + i, b = k * per + (i + 1) % per
      if (flip) idx.push(center, b, a); else idx.push(center, a, b)
    }
  }
  if (capBack) cap(0, false)
  if (capFront) cap(zs.length - 1, true)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n)

function bodyGeometry(S) {
  const W = S.W, L = S.L
  // [z, 半幅, 上面の高さ, 下端の高さ]
  const st = [
    [-L, 0.86, S.hood - 0.06, -0.24],
    [-L + 0.12, 0.95, S.hood + 0.02, -0.33],
    [-WHEEL_Z, S.haunch, S.hood + 0.04, -0.36],      // 後ろのフェンダーの張り出し
    [S.cabR, 0.99, S.hood + 0.05, -0.38],
    [S.cabF, 0.97, S.hood + 0.03, -0.38],
    [WHEEL_Z, 0.99, S.hood - 0.02, -0.36],
    [L - 0.3, 0.93, S.hood - 0.16, -0.32],
    [L, 0.78, S.hood - 0.3, -0.2]
  ]
  const section = z => {
    let [, w, top, bot] = curve(st, z)
    // 車輪の上は弧を描いて切り欠く（タイヤが見えるように）
    for (const zc of [WHEEL_Z, -WHEEL_Z]) {
      const d = Math.abs(z - zc), RA = 0.47
      if (d < RA) bot = Math.max(bot, -0.19 + Math.sqrt(RA * RA - d * d) - 0.02)
    }
    const hw = W * w
    // 下から上へ: 底 → 側面の下 → 腰 → 肩 → 上面
    return [
      [0, bot], [hw * 0.82, bot], [hw * 0.97, bot + 0.08], [hw, -0.04], [hw * 0.985, 0.08],
      [hw * 0.94, top - 0.07], [hw * 0.78, top - 0.01], [hw * 0.4, top + 0.015], [0, top + 0.02]
    ]
  }
  return loft(range(-L, L, 46), section)
}

function glassGeometry(S) {
  // 屋根の高さの並び（前の窓の付け根 → 屋根 → 後ろの窓の付け根）
  const zf = S.cabF, zr = S.cabR, len = zf - zr
  const st = [[zr, 0.0], [zr + len * 0.36, 1.0], [zr + len * 0.62, 1.0], [zf, 0.0]]
  const base = S.hood + 0.04
  const section = z => {
    const [, k] = curve(st, z)
    const h = (S.H - base) * k
    const w0 = S.W * 0.93, w1 = S.W * 0.66
    return [[0, base - 0.02], [w0, base - 0.02], [w0 * 0.97, base + h * 0.25], [w1 + (w0 - w1) * 0.25, base + h * 0.85], [w1, base + h], [0, base + h + 0.01]]
  }
  return loft(range(zr, zf, 24), section)
}

function roofGeometry(S) {
  const zf = S.cabF, zr = S.cabR, len = zf - zr
  const za = zr + len * 0.38, zb = zr + len * 0.6
  const base = S.hood + 0.04, top = S.H
  const section = () => [[0, top - 0.02], [S.W * 0.62, top - 0.025], [S.W * 0.655, top + 0.005], [S.W * 0.5, top + 0.02], [0, top + 0.025]]
  return loft(range(za, zb, 4), section)
}

function wheelGeometries() {
  // タイヤ: 断面を回転させた形（角の丸い四角）
  const prof = []
  const r = WHEEL_R, w = 0.14, rr = 0.06
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + i / 6 * Math.PI / 2; prof.push(new THREE.Vector2(r - rr + Math.cos(a) * rr, -w + rr + Math.sin(a) * rr)) }
  for (let i = 0; i <= 6; i++) { const a = i / 6 * Math.PI / 2; prof.push(new THREE.Vector2(r - rr + Math.cos(a) * rr, w - rr + Math.sin(a) * rr)) }
  prof.unshift(new THREE.Vector2(r * 0.68, -w)); prof.push(new THREE.Vector2(r * 0.68, w))
  const tire = new THREE.LatheGeometry(prof, 28).rotateZ(Math.PI / 2)
  // ホイール: 皿 + 5本スポーク + 中心
  const rim = new THREE.CylinderGeometry(r * 0.68, r * 0.68, 0.04, 24).rotateZ(Math.PI / 2).translate(0.1, 0, 0)
  const parts = [rim]
  for (let i = 0; i < 5; i++) {
    const s = new THREE.BoxGeometry(0.035, r * 0.6, 0.06).translate(0, r * 0.3, 0).rotateX(i / 5 * Math.PI * 2).translate(0.125, 0, 0)
    parts.push(s)
  }
  parts.push(new THREE.CylinderGeometry(0.06, 0.07, 0.06, 10).rotateZ(Math.PI / 2).translate(0.13, 0, 0))
  const disc = new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.03, 20).rotateZ(Math.PI / 2).translate(0.04, 0, 0)
  return { tire, rim: mergeSimple(parts), disc }
}

function mergeSimple(geos) {
  const out = new THREE.BufferGeometry()
  const pos = [], nor = []
  for (let g of geos) {
    g = g.index ? g.toNonIndexed() : g
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array)
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  return out
}

// 共有の材質（車ごとに変わるのは塗装だけ）
let shared = null
function sharedMats() {
  if (shared) return shared
  shared = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x06090c, metalness: 0.0, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.42 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.88 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.22 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.8, roughness: 0.45 }),
    black: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.55, metalness: 0.2 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.12 }),
    head: new THREE.MeshPhysicalMaterial({ color: 0xf4f6fa, emissive: 0xfff6e0, emissiveIntensity: 0.4, metalness: 0, roughness: 0.05, clearcoat: 1 }),
    flame: new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
  }
  return shared
}

export class ProcCar {
  constructor(carId = 'runner', paint = 0xe8432e) {
    const S = this.S = SHAPES[carId] || SHAPES.runner
    const M = sharedMats()
    this.group = new THREE.Group()
    this.group.rotation.order = 'YXZ'
    this.paintMat = new THREE.MeshPhysicalMaterial({ color: paint, metalness: 0.3, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.9 })
    this.paintColor = new THREE.Color(paint)
    const add = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; this.group.add(m); return m }

    this.body = add(bodyGeometry(S), this.paintMat)
    this.base = Float32Array.from(this.body.geometry.attributes.position.array)
    add(glassGeometry(S), M.glass)
    add(roofGeometry(S), this.paintMat)

    // 前: グリルと灯火、後ろ: テールランプの帯と排気管
    const grille = add(new THREE.BoxGeometry(S.W * 1.1, 0.12, 0.05), M.black, false); grille.position.set(0, S.hood - 0.38, S.L - 0.02)
    for (const sx of [-1, 1]) {
      const h = add(new THREE.BoxGeometry(0.32, 0.07, 0.14), M.head, false)
      h.position.set(sx * S.W * 0.66, S.hood - 0.2, S.L - 0.18); h.rotation.y = sx * 0.35
      const ex = add(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 10).rotateX(Math.PI / 2), M.chrome, false)
      ex.position.set(sx * S.W * 0.42, -0.3, -S.L - 0.02)
    }
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x400808, emissive: 0x7a0a0a, emissiveIntensity: 0.6, roughness: 0.2 })
    // 後ろ: 左右のテールランプ（つながった細い帯）、黒いディフューザー、ナンバー枠
    for (const sx of [-1, 1]) {
      const lamp = add(new THREE.BoxGeometry(S.W * 0.55, 0.1, 0.06), this.tailMat, false)
      lamp.position.set(sx * S.W * 0.6, S.hood - 0.12, -S.L + 0.02); lamp.rotation.y = -sx * 0.18
    }
    const bar = add(new THREE.BoxGeometry(S.W * 0.7, 0.025, 0.04), this.tailMat, false); bar.position.set(0, S.hood - 0.1, -S.L - 0.005)
    const dif = add(new THREE.BoxGeometry(S.W * 1.55, 0.14, 0.18), M.black, false); dif.position.set(0, -0.3, -S.L + 0.08)
    for (let i = -2; i <= 2; i++) { const fin = add(new THREE.BoxGeometry(0.02, 0.12, 0.2), M.black, false); fin.position.set(i * 0.22, -0.32, -S.L - 0.02) }
    const plate = add(new THREE.BoxGeometry(0.42, 0.13, 0.02), new THREE.MeshStandardMaterial({ color: 0x9d9a92, roughness: 0.6 }), false); plate.position.set(0, -0.08, -S.L - 0.01)
    const fplate = plate.clone(); fplate.position.set(0, -0.16, S.L + 0.0); this.group.add(fplate)

    // 外れる部品
    const P = {}
    P.bumper = add(new THREE.BoxGeometry(S.W * 1.5, 0.08, 0.22), M.black); P.bumper.position.set(0, -0.3, S.L - 0.2)
    P.hood = add(new THREE.BoxGeometry(S.W * 0.9, 0.03, 0.75), this.paintMat); P.hood.position.set(0, S.hood - 0.06, S.L - 0.85); P.hood.rotation.x = 0.13
    if (S.wing) {
      const g = new THREE.Group()
      const blade = new THREE.Mesh(new THREE.BoxGeometry(S.W * 1.8, 0.03, 0.28), this.paintMat); blade.position.y = 0.25; blade.rotation.x = -0.08; blade.castShadow = true
      g.add(blade)
      for (const sx of [-0.62, 0.62]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.24, 0.1), M.black); st.position.set(sx * S.W, 0.12, 0); g.add(st) }
      g.position.set(0, S.hood + 0.02, -S.L + 0.22)
      this.group.add(g); P.wing = g
    }
    if (S.bar) {
      const g = new THREE.Group()
      for (const y of [-0.22, 0.02]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, S.W * 1.6, 8).rotateZ(Math.PI / 2), M.chrome); b.position.y = y; g.add(b) }
      for (const sx of [-0.65, 0.65]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8), M.chrome); b.position.set(sx * S.W, -0.1, 0); g.add(b) }
      g.position.set(0, 0, S.L + 0.18); this.group.add(g); P.bar = g
    }
    for (const [k, sx] of [['mirrorL', 1], ['mirrorR', -1]]) {
      const m = add(new THREE.BoxGeometry(0.12, 0.08, 0.16), this.paintMat); m.position.set(sx * (S.W * 0.97 + 0.07), S.hood + 0.12, S.cabF - 0.05); P[k] = m
    }
    if (S.sign) { const sg = add(new THREE.BoxGeometry(0.5, 0.18, 0.22), new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffc040, emissiveIntensity: 0.6 }), false); sg.position.set(0, S.H + 0.1, S.cabR + (S.cabF - S.cabR) * 0.5) }
    this.parts = P
    this.lost = new Set()

    // 車輪
    const WG = wheelGeometries()
    this.wheels = []
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const pivot = new THREE.Group()
      pivot.position.set(sx * S.track, -0.19, sz * WHEEL_Z)
      const spin = new THREE.Group()
      const tire = new THREE.Mesh(WG.tire, M.tire); tire.castShadow = true
      const rim = new THREE.Mesh(WG.rim, M.rim), disc = new THREE.Mesh(WG.disc, M.disc)
      if (sx < 0) { rim.scale.x = -1; disc.scale.x = -1 }
      spin.add(tire, rim, disc)
      pivot.add(spin)
      this.group.add(pivot)
      this.wheels.push({ pivot, w: spin, front: sz > 0, rest: pivot.position.y })
    }

    // ブーストの炎
    this.flames = []
    for (const sx of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.1, 1.2, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.6), M.flame)
      f.position.set(sx * S.W * 0.42, -0.3, -S.L - 0.08)
      f.visible = false
      this.group.add(f)
      this.flames.push(f)
    }
    this.spin = 0
    this.dentCount = 0
  }

  // 凹みを頂点に反映する（凹みの数が変わったときだけ）
  applyDents(dents) {
    if (dents.length === this.dentCount) return
    this.dentCount = dents.length
    const S = this.S
    const p = this.body.geometry.attributes.position
    const a = p.array
    a.set(this.base)
    for (const d of dents) {
      const l = Math.hypot(d.x, d.z) || 1
      const dx = d.x / l, dz = d.z / l
      const hx = dx * S.W * 1.02, hz = dz * S.L * 1.0
      const r = 0.9 + d.s * 0.6
      const depth = 0.16 + d.s * 0.5
      for (let i = 0; i < p.count; i++) {
        const x = a[i * 3], z = a[i * 3 + 2]
        const dist = Math.hypot(x - hx, z - hz)
        if (dist > r) continue
        const k = (1 - dist / r) ** 2 * depth
        a[i * 3] -= dx * k
        a[i * 3 + 2] -= dz * k
        a[i * 3 + 1] -= k * 0.3 * Math.sin(i * 12.9898) // 板金のよれ
      }
    }
    p.needsUpdate = true
    this.body.geometry.computeVertexNormals()
  }

  // 損傷で外れる部品。外れた瞬間の部品を返す（fx 側で飛ばす）。塗装も傷むほどくすむ
  updateParts(dmg) {
    const k = 0.5 + 0.5 * Math.max(0, Math.min(1, dmg.body))
    const want = this.paintColor.clone().multiplyScalar(k).lerp(new THREE.Color(0x2a2522), (1 - k) * 0.6)
    if (!this.paintMat.color.equals(want)) {
      this.paintMat.color.copy(want)
      this.paintMat.clearcoat = 0.3 + 0.7 * k
      this.paintMat.roughness = 0.38 + (1 - k) * 0.5
    }
    const out = []
    const rules = [['mirrorL', 0.85], ['bumper', 0.7], ['mirrorR', 0.6], ['bar', 0.55], ['hood', 0.45], ['wing', 0.3]]
    for (const [key, th] of rules) {
      const m = this.parts[key]
      if (!m || this.lost.has(key)) continue
      if (dmg.body < th) { this.lost.add(key); m.visible = false; out.push(m) }
    }
    return out
  }

  resetParts() {
    for (const k of Object.keys(this.parts)) if (this.parts[k]) this.parts[k].visible = true
    this.lost.clear()
  }

  update(state, dt, { steer = 0, braking = false, boosting = false } = {}) {
    const g = this.group
    g.position.set(state.x, state.y, state.z)
    g.rotation.set(-state.pitch, state.yaw, state.roll)
    const fwd = state.vx * Math.sin(state.yaw) + state.vz * Math.cos(state.yaw)
    this.spin += fwd * dt / WHEEL_R
    for (const w of this.wheels) {
      w.w.rotation.x = this.spin
      if (w.front) w.pivot.rotation.y = -steer * 0.42
      const drop = state.grounded ? 0 : 0.12
      w.pivot.position.y += (w.rest - drop - w.pivot.position.y) * Math.min(1, dt * 10)
    }
    this.tailMat.emissiveIntensity = braking ? 3.2 : 0.6
    for (const f of this.flames) {
      f.visible = boosting
      if (boosting) f.scale.set(1, 1, 0.8 + Math.random() * 0.5)
    }
  }

  dispose() {
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose() })
    this.paintMat.dispose()
  }
}

// ======================================================================== 実車級モデル
// Khronos glTF Sample Assets「CarConcept」（CC-BY 4.0, Eric Chadwick / Darmstadt Graphics Group）を
// tools/process-car.mjs で軽くした assets/models/car.glb。ロゴは外してある。

let template = null       // 正規化済みの車（複製して使う）
let loading = null

const VARIANT = { // 車種ごとの体格（x=幅, y=高さ, z=長さ の倍率）と追加部品
  runner:  { s: [1, 1, 1], wing: false, bar: false },
  bruiser: { s: [1.07, 1.12, 1.04], wing: false, bar: true },
  dart:    { s: [0.97, 0.92, 0.97], wing: true, bar: false }
}

export function loadCarModel(url = 'assets/models/car.glb') {
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    new GLTFLoader().load(url, gltf => {
      const src = gltf.scene
      src.updateMatrixWorld(true)
      const find = n => src.getObjectByName(n)
      const wp = n => { const o = find(n); const b = new THREE.Box3().setFromObject(o); return b.getCenter(new THREE.Vector3()) }
      const fl = wp('WheelFrontL'), fr = wp('WheelFrontR'), rl = wp('WheelRearL')
      // 前 = 前輪 - 後輪、左 = 左前輪 - 右前輪。これをゲームの +z（前）と +x（左）にそろえる
      const fwd = fl.clone().sub(rl).normalize(), left = fl.clone().sub(fr).normalize()
      const up = new THREE.Vector3().crossVectors(fwd, left).normalize() // +z × +x = +y
      const basis = new THREE.Matrix4().makeBasis(left, up, fwd)        // モデル→ゲームの逆
      const rot = basis.clone().invert()
      const holder = new THREE.Group()
      const inner = new THREE.Group()
      inner.add(src)
      inner.applyMatrix4(rot)
      holder.add(inner)
      holder.updateMatrixWorld(true)
      // 大きさ: 前後輪の間隔をゲームの 2.7m（±1.35）に合わせる
      const wb = fl.distanceTo(rl)
      const sc = 2.7 / wb
      inner.scale.multiplyScalar(sc)
      holder.updateMatrixWorld(true)
      // 位置: 4輪の中心を原点の真下へ、タイヤの接地を y=-0.55 に
      const c = new THREE.Vector3(), wheels = ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR']
      let bottom = Infinity
      for (const n of wheels) { const b = new THREE.Box3().setFromObject(find(n)); c.add(b.getCenter(new THREE.Vector3())); bottom = Math.min(bottom, b.min.y) }
      c.multiplyScalar(1 / 4)
      inner.position.x -= c.x; inner.position.z -= c.z
      inner.position.y += -0.55 - bottom
      holder.updateMatrixWorld(true)
      src.traverse(o => {
        if (!o.isMesh) return
        o.castShadow = true; o.receiveShadow = true
        // 元のモデルはロゴを発光の型抜きに使っていた。ロゴを外したので、灯火と計器以外の発光は消す
        const n = o.material.name || ''
        if (!/^(Headlight|Brakelight|Signallight|Dashboard)$/.test(n) && o.material.emissive) { o.material.emissive.setRGB(0, 0, 0); o.material.emissiveMap = null }
      })
      template = holder
      resolve(holder)
    }, undefined, reject)
  })
  return loading
}

export function carModelReady() { return !!template }

class RealCar {
  constructor(carId, paint) {
    const V = VARIANT[carId] || VARIANT.runner
    this.group = new THREE.Group()
    this.group.rotation.order = 'YXZ'
    const body = template.clone(true)
    body.scale.set(...V.s)
    this.group.add(body)
    this.group.updateMatrixWorld(true)
    const M = sharedMats()
    // 材質は車ごとに複製（塗装と灯火を変えるため）
    const matCache = new Map()
    const own = m => { if (!matCache.has(m)) matCache.set(m, m.clone()); return matCache.get(m) }
    this.paintMats = []
    this.paintColor = new THREE.Color(paint)
    body.traverse(o => {
      if (!o.isMesh) return
      const n = o.material.name || ''
      if (/^Paint 1/.test(n)) { o.material = own(o.material); if (!this.paintMats.includes(o.material)) { o.material.color.set(paint); this.paintMats.push(o.material) } }
      else if (n === 'Brakelight') { o.material = own(o.material); this.brakeMat = o.material }
      else if (n === 'Headlight') { o.material = own(o.material); o.material.emissive = new THREE.Color(0xfff2d8); o.material.emissiveIntensity = 1.2 }
    })
    if (this.brakeMat) { this.brakeMat.emissive = new THREE.Color(0xff1a10) }
    // 車輪: 車輪の中心に軸を作り直す（モデルの原点は車輪の中心ではない）
    this.wheels = []
    for (const [n, front] of [['WheelFrontL', true], ['WheelFrontR', true], ['WheelRearL', false], ['WheelRearR', false]]) {
      const w = body.getObjectByName(n)
      const b = new THREE.Box3().setFromObject(w)
      const ctr = this.group.worldToLocal(b.getCenter(new THREE.Vector3()))
      const steer = new THREE.Group(), spin = new THREE.Group()
      steer.position.copy(ctr)
      this.group.add(steer); steer.add(spin)
      spin.attach(w)
      this.wheels.push({ pivot: steer, w: spin, front, rest: ctr.y })
    }
    // 外れる部品（モデルの実際の部品）
    const P = {}
    const pick = (k, name) => { const o = body.getObjectByName(name); if (o) P[k] = o }
    pick('mirrorL', 'BodyDoorLMirror'); pick('mirrorR', 'BodyDoorRMirror'); pick('hood', 'BodyHood'); pick('door', 'BodyDoorRColor1')
    for (const k of ['mirrorL', 'mirrorR']) { const base = P[k]; if (base) { const extra = [body.getObjectByName(base.name + 'Color1'), body.getObjectByName(base.name + 'Color2')].filter(Boolean); const g = new THREE.Group(); base.parent.add(g); for (const o of [base, ...extra]) g.attach(o); P[k] = g } }
    if (V.wing) {
      const g = new THREE.Group()
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.035, 0.3), this.paintMats[0] || M.black); blade.position.y = 0.2; blade.rotation.x = -0.1; blade.castShadow = true
      g.add(blade)
      for (const sx of [-0.6, 0.6]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.1), M.black); st.position.set(sx, 0.1, 0); g.add(st) }
      const bb = new THREE.Box3().setFromObject(body)
      g.position.set(0, bb.max.y - 0.48, this.group.worldToLocal(new THREE.Vector3(0, 0, bb.min.z)).z + 0.3)
      this.group.add(g); P.wing = g
    }
    if (V.bar) {
      const g = new THREE.Group()
      for (const y of [-0.25, -0.02]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.7, 8).rotateZ(Math.PI / 2), M.chrome); b.position.y = y; g.add(b) }
      for (const sx of [-0.7, 0.7]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8), M.chrome); b.position.set(sx, -0.13, 0); g.add(b) }
      const bb = new THREE.Box3().setFromObject(body)
      g.position.set(0, 0, bb.max.z + 0.12)
      this.group.add(g); P.bar = g
    }
    this.parts = P
    this.lost = new Set()
    // ブーストの炎
    this.flames = []
    const bb = new THREE.Box3().setFromObject(body)
    for (const sx of [-0.35, 0.35]) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.1, 1.2, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.6), M.flame)
      f.position.set(sx, -0.28, bb.min.z - 0.02)
      f.visible = false
      this.group.add(f); this.flames.push(f)
    }
    // 凹ませる面（塗装の大きな面だけ。車の座標での頂点を覚えておく）
    this.dentMeshes = []
    body.traverse(o => {
      if (!o.isMesh || !this.paintMats.includes(o.material)) return
      const g = o.geometry = o.geometry.clone()
      const rel = new THREE.Matrix4().copy(this.group.matrixWorld).invert().multiply(o.matrixWorld)
      this.dentMeshes.push({ mesh: o, base: Float32Array.from(g.attributes.position.array), rel, inv: rel.clone().invert() })
    })
    this.spin = 0
    this.dentCount = 0
  }

  applyDents(dents) {
    if (dents.length === this.dentCount) return
    this.dentCount = dents.length
    const v = new THREE.Vector3()
    for (const d0 of this.dentMeshes) {
      const p = d0.mesh.geometry.attributes.position, a = p.array
      a.set(d0.base)
      if (!dents.length) { p.needsUpdate = true; continue }
      for (let i = 0; i < p.count; i++) {
        v.set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]).applyMatrix4(d0.rel) // 車の座標へ
        let moved = false
        for (const d of dents) {
          const l = Math.hypot(d.x, d.z) || 1, dx = d.x / l, dz = d.z / l
          const hx = dx * 0.98, hz = dz * 2.2
          const r = 0.85 + d.s * 0.6, dist = Math.hypot(v.x - hx, v.z - hz)
          if (dist > r) continue
          const k = (1 - dist / r) ** 2 * (0.12 + d.s * 0.42)
          v.x -= dx * k; v.z -= dz * k; v.y -= k * 0.25
          moved = true
        }
        if (moved) { v.applyMatrix4(d0.inv); a[i * 3] = v.x; a[i * 3 + 1] = v.y; a[i * 3 + 2] = v.z }
      }
      p.needsUpdate = true
      d0.mesh.geometry.computeVertexNormals()
    }
  }

  updateParts(dmg) {
    const k = 0.5 + 0.5 * Math.max(0, Math.min(1, dmg.body))
    const want = this.paintColor.clone().multiplyScalar(k).lerp(new THREE.Color(0x2a2522), (1 - k) * 0.6)
    for (const m of this.paintMats) if (!m.color.equals(want)) { m.color.copy(want); m.roughness = 0.25 + (1 - k) * 0.5 }
    const out = []
    const rules = [['mirrorL', 0.85], ['mirrorR', 0.6], ['bar', 0.55], ['hood', 0.45], ['wing', 0.35], ['door', 0.25]]
    for (const [key, th] of rules) {
      const m = this.parts[key]
      if (!m || this.lost.has(key)) continue
      if (dmg.body < th) { this.lost.add(key); m.visible = false; out.push(m) }
    }
    return out
  }

  resetParts() { for (const k of Object.keys(this.parts)) this.parts[k].visible = true; this.lost.clear() }

  update(state, dt, { steer = 0, braking = false, boosting = false } = {}) {
    const g = this.group
    g.position.set(state.x, state.y, state.z)
    g.rotation.set(-state.pitch, state.yaw, state.roll)
    const fwd = state.vx * Math.sin(state.yaw) + state.vz * Math.cos(state.yaw)
    this.spin += fwd * dt / WHEEL_R
    for (const w of this.wheels) {
      w.w.rotation.x = this.spin
      if (w.front) w.pivot.rotation.y = -steer * 0.42
      const drop = state.grounded ? 0 : 0.1
      w.pivot.position.y += (w.rest - drop - w.pivot.position.y) * Math.min(1, dt * 10)
    }
    if (this.brakeMat) this.brakeMat.emissiveIntensity = braking ? 6 : 1.2
    for (const f of this.flames) { f.visible = boosting; if (boosting) f.scale.set(1, 1, 0.8 + Math.random() * 0.5) }
  }

  dispose() {
    for (const d of this.dentMeshes) d.mesh.geometry.dispose()
    for (const m of this.paintMats) m.dispose()
  }
}

// 実車モデルが読めていればそれを、まだなら手続きの車を使う
export class CarModel {
  constructor(carId = 'runner', paint = 0xe8432e) {
    return template ? new RealCar(carId, paint) : new ProcCar(carId, paint)
  }
}

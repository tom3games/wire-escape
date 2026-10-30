// コースの見た目を作る。形はすべてコードで組む（外部モデルなし）。
import * as THREE from 'three'
import { Builder, textTexture } from './geo.js'
import { pbr, boxMap, terrainMaterial } from './look.js'
import { buildForest, buildTufts } from './trees.js'
import { Q } from './quality.js'
import { createFacade } from './facade.js'
import { terrain, toWorld, slabTop, forestDensity } from '../shared/track.js'
import { DESTRUCT } from '../shared/config.js'

const PAL = {
  grass: 0x6f9a4a, grass2: 0x86ab55, dirt: 0x9a7a52, rock: 0x8a6a55, rockDark: 0x5e4a3f, city: 0x8a8e94,
  asphalt: 0x3b3f46, dirtRoad: 0x8c6c45, line: 0xf4f1e6, concrete: 0xb8b4ab, metal: 0xc9ced6
}
const BUILD_COLORS = [0xd9c7a8, 0xc7d0d9, 0xe0b49a, 0xa8b8c4, 0xd8d2c0, 0xb7a99a, 0x9fb3a1, 0xe3d9c6]

export function buildScene(scene, world) {
  const BOUNDS = world.bounds
  const CITY = world.stage === 'city'
  const root = new THREE.Group()
  scene.add(root)
  const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.02 })
  // 実写の材質（箱投影で貼る）。頂点色が掛け合わさるので、建物ごとの色むらも残る
  const concrete = boxMap(pbr('concrete_wall_004', { vertexColors: true, roughness: 1 }), 0.22)
  const rockMat = boxMap(pbr('rock_face', { vertexColors: true }), 0.12)
  const asphaltMat = boxMap(pbr('asphalt_02', { roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 0.16)
  const dirtMat = boxMap(pbr('dirt', { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 0.18)
  const woodMat = boxMap(new THREE.MeshStandardMaterial({ map: plankTexture(), vertexColors: true, roughness: 0.8 }), 0.3)
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.85 })
  const fac = facadeTextures()
  const buildingMat = boxMap(new THREE.MeshStandardMaterial({ vertexColors: true, map: fac.map, roughnessMap: fac.rough, metalness: 0.0, roughness: 1 }), 1 / 9)

  // ---------------------------------------- 地形
  {
    const X0 = BOUNDS.x0 - 90, X1 = BOUNDS.x1 + 90, Z0 = BOUNDS.z0 - 90, Z1 = BOUNDS.z1 + 90
    const S = 4
    const nx = Math.ceil((X1 - X0) / S), nz = Math.ceil((Z1 - Z0) / S)
    const g = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, nx, nz)
    g.rotateX(-Math.PI / 2)
    g.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2)
    const p = g.attributes.position
    const splat = new Float32Array(p.count * 4), soil = new Float32Array(p.count)
    const sst = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i)
      const h = terrain(x, z)
      p.setY(i, h)
      const hx = terrain(x + 2, z) - terrain(x - 2, z), hz = terrain(x, z + 2) - terrain(x, z - 2)
      const slope = Math.hypot(hx, hz) / 4
      const inside = x > BOUNDS.x0 && x < BOUNDS.x1
      let gr = 1, di = 0, ro = 0, ci = 0
      if (CITY) { ci = 1; gr = 0; if ((world.grassRects || []).some(r => x > r.x0 - 1 && x < r.x1 + 1 && z > r.z0 - 1 && z < r.z1 + 1)) { ci = 0; gr = 1 } }
      else if (z < 626 && inside && h < 2) { ci = z < 346 ? 1 : 0.35; gr = 0; if (z >= 346) soil[i] = 0.75 }
      ro = Math.max(ro, sst(0.5, 0.95, slope))
      if (h < -3) ro = 1
      if (!inside || z < BOUNDS.z0 || z > BOUNDS.z1) ro = Math.max(ro, sst(8, 40, h) * 0.8)
      di = CITY ? 0 : Math.max(0, forestDensity(x, z) - 0.35) * 1.2 * (1 - ro)
      gr = Math.max(0, 1 - ro - di - ci)
      splat.set([gr, di, ro, ci], i * 4)
    }
    for (const d of world.dirt) for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i)
      if (x >= d.x0 - 2 && x <= d.x1 + 2 && z >= d.z0 - 2 && z <= d.z1 + 2) soil[i] = 1
    }
    g.setAttribute('splat', new THREE.BufferAttribute(splat, 4))
    g.setAttribute('soil', new THREE.BufferAttribute(soil, 1))
    g.computeVertexNormals()
    const m = new THREE.Mesh(g, terrainMaterial())
    m.receiveShadow = true
    root.add(m)
  }

  // ---------------------------------------- 道路（地形に沿う帯）＋ 白線・黄線・路肩
  {
    const pave = new Builder(), soilB = new Builder(), lines = new Builder()
    const hAt = (x, z) => terrain(x, z)
    let lift = 0.06
    const WHITE = 0xf2f0e8, YELLOW = 0xf0b419
    // 帯を1本足す（off は中心線からの横のずれ、hw は半幅）
    const strip = (b, ax, az, bx, bz, off, hw, y, col, dash = 0, k0 = 0) => {
      const L = Math.hypot(bx - ax, bz - az)
      const dx = (bx - ax) / L, dz = (bz - az) / L
      const px = -dz, pz = dx
      const n = Math.max(1, Math.ceil(L / 3))
      for (let k = 0; k < n; k++) {
        if (dash && ((k + k0) % 4) >= 2) continue
        const t0 = k / n, t1 = (k + 1) / n
        const x0 = ax + (bx - ax) * t0 + px * off, z0 = az + (bz - az) * t0 + pz * off
        const x1 = ax + (bx - ax) * t1 + px * off, z1 = az + (bz - az) * t1 + pz * off
        const q = (x, z) => [x, hAt(x, z) + y, z]
        const A = q(x0 + px * hw, z0 + pz * hw), B = q(x0 - px * hw, z0 - pz * hw), C = q(x1 - px * hw, z1 - pz * hw), D = q(x1 + px * hw, z1 + pz * hw)
        if (A[1] < -3 || B[1] < -3 || C[1] < -3 || D[1] < -3) continue
        b.tri(A, C, B, col); b.tri(A, D, C, col)
      }
    }
    for (const r of world.roads) {
      lift += 0.004
      const city = r.pts.every(([, z]) => z < 626)
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax0, az0] = r.pts[i], [bx0, bz0] = r.pts[i + 1]
        const L = Math.hypot(bx0 - ax0, bz0 - az0)
        const dx = (bx0 - ax0) / L, dz = (bz0 - az0) / L
        // 角の継ぎ目を隠すため、舗装は両端を半幅ぶん延ばす
        const e = r.w / 2
        const ax = ax0 - dx * e, az = az0 - dz * e, bx = bx0 + dx * e, bz = bz0 + dz * e
        if (r.surf === 'dirt') { strip(soilB, ax, az, bx, bz, 0, r.w / 2, lift, 0xffffff); continue }
        strip(pave, ax, az, bx, bz, 0, r.w / 2, lift, 0xffffff)
        if (r.w < 8) continue
        // 白線（端）は角で途切れさせる。センターは市街なら白の破線、山なら黄色の実線（追い越し禁止）
        const lx0 = ax0 + dx * e * 0.9, lz0 = az0 + dz * e * 0.9, lx1 = bx0 - dx * e * 0.9, lz1 = bz0 - dz * e * 0.9
        if (Math.hypot(lx1 - lx0, lz1 - lz0) < 2 || (lx1 - lx0) * dx + (lz1 - lz0) * dz < 0) continue
        for (const sgn of [-1, 1]) strip(lines, lx0, lz0, lx1, lz1, sgn * (r.w / 2 - 0.55), 0.09, lift + 0.015, WHITE)
        if (city) strip(lines, lx0, lz0, lx1, lz1, 0, 0.08, lift + 0.015, WHITE, 1, i)
        else for (const sgn of [-1, 1]) strip(lines, lx0, lz0, lx1, lz1, sgn * 0.16, 0.07, lift + 0.015, YELLOW)
      }
    }
    const rm = new THREE.Mesh(pave.geometry(), asphaltMat); rm.receiveShadow = true; root.add(rm)
    const dm = new THREE.Mesh(soilB.geometry(), dirtMat); dm.receiveShadow = true; root.add(dm)
    const lm = new THREE.Mesh(lines.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }))
    lm.receiveShadow = true
    root.add(lm)
  }

  // ---------------------------------------- 街: 歩道・横断歩道・運河の水・遠くのビル
  if (CITY) {
    const walk = new Builder(), zebra = new Builder()
    const G = world.cityGrid
    for (const r of world.roads) {
      if (r.w < 12) continue
      const [[ax, az], [bx, bz]] = r.pts
      const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L
      for (const s2 of [-1, 1]) {
        const off = r.w / 2 + 2
        const cx = (ax + bx) / 2 - dz * off * s2, cz = (az + bz) / 2 + dx * off * s2
        walk.box(cx, 0.08, cz, Math.abs(dz) * 2 + Math.abs(dx) * L / 2, 0.08, Math.abs(dx) * 2 + Math.abs(dz) * L / 2, 0xc9c5bc, 0)
      }
    }
    // 交差点の横断歩道（大通りの交差点だけ）
    for (const r of world.roads) {
      if (r.w < 28) continue
      const [[ax, az], [bx, bz]] = r.pts
      const vert = Math.abs(bx - ax) < 1
      const n = Math.floor(r.w / 2 / 2.4)
      for (const q of (vert ? G.ZS : G.XS)) {
        const cw = (vert ? (G.WIDE_Z.includes(q) ? 28 : 18) : (G.WIDE_X.includes(q) ? 28 : 18)) / 2 + 2.5
        for (const side of [-1, 1]) for (let k = -n; k <= n; k++) {
          if (vert) zebra.box(ax + k * 2.4, 0.07, q + side * cw, 0.6, 0.02, 1.4, 0xf2f0e8, 0)
          else zebra.box(q + side * cw, 0.07, az + k * 2.4, 1.4, 0.02, 0.6, 0xf2f0e8, 0)
        }
      }
    }
    const wm = new THREE.Mesh(walk.geometry(), concrete); wm.receiveShadow = true; root.add(wm)
    root.add(new THREE.Mesh(zebra.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 })))
    if (world.water) {
      const w = world.water
      const water = new THREE.Mesh(new THREE.PlaneGeometry(BOUNDS.x1 - BOUNDS.x0 + 80, w.z1 - w.z0 + 4).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x1f4656, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.92 }))
      water.position.set((BOUNDS.x0 + BOUNDS.x1) / 2, w.y, (w.z0 + w.z1) / 2)
      root.add(water)
    }
    // 外側のビル群（見た目だけ）
    const sky = new Builder()
    let sd = 3
    const rr = () => (sd = (sd * 16807) % 2147483647) / 2147483647
    // 街の外周（当たり判定のある外周ビル）よりさらに外にだけ置く
    const cx0 = (BOUNDS.x0 + BOUNDS.x1) / 2, cz0 = (BOUNDS.z0 + BOUNDS.z1) / 2
    const hx = (BOUNDS.x1 - BOUNDS.x0) / 2 + 120, hz = (BOUNDS.z1 - BOUNDS.z0) / 2 + 120
    for (let i = 0; i < 160; i++) {
      const a = rr() * Math.PI * 2, d = 1 + rr() * 0.9
      const x = cx0 + Math.cos(a) * hx * d * 1.15, z = cz0 + Math.sin(a) * hz * d * 1.1
      if (Math.abs(x - cx0) < hx && Math.abs(z - cz0) < hz) continue
      const h = 25 + rr() * 110, w2 = 14 + rr() * 26
      sky.box(x, h / 2, z, w2, h / 2, w2 * (0.6 + rr() * 0.8), BUILD_COLORS[i % BUILD_COLORS.length], rr(), { noTop: true, shade: false })
    }
    const sm = new THREE.Mesh(sky.geometry(), buildingMat)
    root.add(sm)
  }

  // ---------------------------------------- 板（橋・高架・ジャンプ台）
  const plankMeshes = []
  let forest = null
  {
    const sides = new Builder(), tops = new Builder(), soilTop = new Builder(), wood = new Builder(), lines = new Builder()
    for (const sl of world.slabs) {
      if (sl.needs) continue // 倒れた鉄塔そのものが板になる
      const P = (u, v, y) => { const w = toWorld(sl, u, v); return [w.x, y, w.z] }
      const t0 = sl.y0, t1 = sl.y1, th = sl.thick
      const corners = [
        P(-sl.hw, -sl.hl, t0 - th), P(sl.hw, -sl.hl, t0 - th), P(sl.hw, sl.hl, t1 - th), P(-sl.hw, sl.hl, t1 - th),
        P(-sl.hw, -sl.hl, t0), P(sl.hw, -sl.hl, t0), P(sl.hw, sl.hl, t1), P(-sl.hw, sl.hl, t1)
      ]
      if (sl.surf === 'wood') { wood.hexa(corners, 0xffffff); continue }
      sides.hexa(corners, sl.surf === 'dirt' ? 0x9a8068 : 0xdedbd4, { noTop: true })
      const topOnly = sl.surf === 'dirt' ? soilTop : tops
      topOnly.hexa(corners, 0xffffff, { noBottom: true, shade: false })
      if (sl.surf === 'road' && sl.hw >= 5) for (const su of [-sl.hw + 0.55, sl.hw - 0.55]) {
        const a = toWorld(sl, su, -sl.hl), c = toWorld(sl, su, sl.hl)
        lines.box((a.x + c.x) / 2, (t0 + t1) / 2 + 0.02, (a.z + c.z) / 2, 0.09, 0.02, sl.hl, 0xf2f0e8, sl.yaw)
      }
      if (sl.kind === 'mound') for (let i = 0; i < 18; i++) {
        const u = (Math.sin(i * 7.1) * 0.9) * sl.hw, v = (Math.cos(i * 3.3) * 0.9) * sl.hl
        const w = toWorld(sl, u, v)
        sides.box(w.x, slabTop(sl, v) + 0.2, w.z, 0.6 + (i % 3) * 0.3, 0.35, 0.5, 0x8a6a48, i)
      }
    }
    // ジャンプ台の黄黒の縁
    for (const sl of world.slabs) if (sl.kind === 'kicker' || sl.kind === 'roll') {
      const e = toWorld(sl, 0, sl.hl - 0.3)
      lines.box(e.x, sl.y1 - 0.02, e.z, sl.hw, 0.08, 0.3, 0xf2c230, sl.yaw)
      // 曲がった台（バレルロール）は斜めの黄黒、普通の台は矢印の白線
      for (let k = 0; k < 3; k++) {
        const v = -sl.hl + 1.5 + k * (sl.hl * 2 - 3) / 2
        const w = toWorld(sl, 0, v)
        const top = slabTop(sl, v) + 0.03
        if (sl.roll) lines.box(w.x, top, w.z, sl.hw * 0.9, 0.03, 0.35, k % 2 ? 0x14161a : 0xf2c230, sl.yaw + sl.roll * 0.5)
        else lines.box(w.x, top, w.z, sl.hw * 0.25, 0.03, 0.6, 0xf2f0e8, sl.yaw)
      }
    }
    for (const [b, mat] of [[sides, concrete], [tops, asphaltMat], [soilTop, dirtMat], [wood, woodMat], [lines, vc]]) {
      if (b.empty) continue
      const m = new THREE.Mesh(b.geometry(), mat)
      m.castShadow = true; m.receiveShadow = true
      root.add(m)
    }
  }

  // ---------------------------------------- 壊れない箱（建物・壁・柵）
  {
    const bld = new Builder(), conc = new Builder(), rock = new Builder(), met = new Builder(), other = new Builder()
    const facade = createFacade()
    let k = 0
    for (const o of world.colliders) {
      if (o.slab || o.kind === 'bound' || o.kind === 'pylon' || o.kind === 'tree') continue
      const cy = o.y0 + o.h / 2
      if (o.kind === 'building') {
        const kk = k++
        const color = new THREE.Color(BUILD_COLORS[(kk * 5) % BUILD_COLORS.length]).lerp(new THREE.Color(0xffffff), 0.35)
        // 外壁の型: 高いビルはガラスか事務所、低いものはマンション・レンガ・事務所
        const style = o.h > 55 ? [2, 0, 1, 2, 0][kk % 5] : [1, 0, 3, 1, 2, 3, 0][kk % 7]
        if (o.yaw) bld.box(o.cx, cy, o.cz, o.hw, o.h / 2, o.hl, color.getHex(), o.yaw, { noTop: true, shade: false })
        else facade.building(o.cx - o.hw, o.cz - o.hl, o.cx + o.hw, o.cz + o.hl, o.y0, o.h, style, color.getHex(), (kk * 0.618) % 1)
        // 縦看板（通りから見える面の角）と屋上の広告
        if (!o.yaw && kk % 3 === 0 && o.hw < 80) facade.sign(o.cx + o.hw - 2.2, o.y0 + 5.2, o.cz + o.hl, 0, 1, 1.25, 5, kk % 2, kk)
        if (!o.yaw && kk % 3 === 1 && o.hl < 80) facade.sign(o.cx - o.hw, o.y0 + 5.2, o.cz - o.hl + 2.2, -1, 0, 1.25, 5, (kk + 1) % 2, kk)
        if (!o.yaw && kk % 5 === 2 && o.h < 45 && o.hw > 8) {
          const by = o.y0 + o.h + 2.2
          facade.billboard(o.cx, by, o.cz + o.hl - 3, 0, 1, 12, 6, kk)
          for (const sx of [-4.5, 4.5]) met.box(o.cx + sx, o.y0 + o.h + 1.1, o.cz + o.hl - 3.3, 0.15, 1.1, 0.15, 0x6d7278, 0)
        }
        // 屋上: 給水タンクとアンテナ（高いビル）
        if (kk % 4 === 3) met.box(o.cx - o.hw * 0.3, o.y0 + o.h + 1.6, o.cz + o.hl * 0.25, 1.4, 1.3, 1.4, 0x9aa3ab, 0)
        if (o.h > 55) met.box(o.cx, o.y0 + o.h + 5, o.cz, 0.12, 5, 0.12, 0xc9ced6, 0)
        // 屋上（コンクリート）と塔屋・室外機
        conc.box(o.cx, o.y0 + o.h + 0.15, o.cz, o.hw + 0.25, 0.3, o.hl + 0.25, 0xbab6ae, o.yaw)
        conc.box(o.cx + o.hw * 0.3, o.y0 + o.h + 1.4, o.cz - o.hl * 0.2, Math.min(3, o.hw * 0.3), 1.2, Math.min(2.5, o.hl * 0.25), 0xcfcac2, 0)
        for (let j = 0; j < 3; j++) met.box(o.cx - o.hw * 0.4 + j * 1.6, o.y0 + o.h + 0.75, o.cz + o.hl * 0.4, 0.6, 0.45, 0.6, 0xb8bcc2, 0)
      } else if (o.kind === 'whouse') conc.box(o.cx, cy, o.cz, o.hw, o.h / 2, o.hl, 0x9aa6b2, o.yaw)
      else if (o.kind === 'rail') {
        // ガードレール: 波形の横板と支柱
        const len = Math.max(o.hw, o.hl)
        const along = o.hl > o.hw
        met.box(o.cx, o.y0 + o.h * 0.72, o.cz, along ? 0.06 : o.hw, 0.17, along ? o.hl : 0.06, 0xd7dbe0, o.yaw)
        for (let t = -len; t <= len; t += 2) met.box(o.cx + (along ? 0 : t), o.y0 + o.h * 0.4, o.cz + (along ? t : 0), 0.06, o.h * 0.4, 0.06, 0x9aa0a8, 0)
      } else if (o.kind === 'pillar' || o.kind === 'sidewall' || o.kind === 'wall') conc.box(o.cx, cy, o.cz, o.hw, o.h / 2, o.hl, 0xe0ddd6, o.yaw)
      else if (o.kind === 'container') {
        const cc = [0xa8352a, 0x2a5f98, 0x2e7a50, 0xc07a2b][k++ % 4]
        met.box(o.cx, cy, o.cz, o.hw, o.h / 2, o.hl, cc, o.yaw)
        for (let t = -o.hl + 0.5; t < o.hl; t += 0.6) met.box(o.cx + o.hw + 0.02, cy, o.cz + t, 0.03, o.h / 2 - 0.1, 0.1, cc, 0, { shade: false })
      } else if (o.kind === 'rock') {
        rock.box(o.cx, cy, o.cz, o.hw, o.h / 2, o.hl, 0xd8d0c8, o.yaw)
        rock.box(o.cx + 0.4, o.y0 + o.h * 0.9, o.cz - 0.3, o.hw * 0.6, o.h * 0.25, o.hl * 0.6, 0xe4dcd2, o.yaw + 0.5)
      } else conc.box(o.cx, cy, o.cz, o.hw, o.h / 2, o.hl, 0xd0ccc4, o.yaw)
    }
    for (const [b, mat] of [[bld, buildingMat], [conc, concrete], [rock, rockMat], [met, metal], [other, vc]]) {
      if (b.empty) continue
      const m = new THREE.Mesh(b.geometry(), mat)
      m.castShadow = true; m.receiveShadow = true
      root.add(m)
    }
    if (!facade.empty) {
      const m = new THREE.Mesh(facade.geometry(), facade.material)
      m.castShadow = true; m.receiveShadow = true
      root.add(m)
    }
  }

  // ---------------------------------------- 崩れた橋の主塔・ケーブル・垂れ下がった残骸（見た目だけ）
  if (!CITY) {
    const b = new Builder()
    const steel = 0xb5442e, conc = 0xaaa59b
    for (const z of [650, 776]) {
      const base = z === 650 ? 0 : -4
      for (const sx of [-9.2, 9.2]) {
        b.box(sx, base - 20, z, 1.2, 50, 1.2, conc)       // 谷底からの柱
        b.box(sx, base + 34, z, 0.9, 4, 0.9, steel)
      }
      b.box(0, base + 37, z, 10.1, 0.8, 0.8, steel)      // 門
      b.box(0, base + 26, z, 10.1, 0.5, 0.5, steel)
    }
    // ケーブル（主塔から板へ）。切れた側は垂れ下がる
    const cable = (x, y0, z0, y1, z1) => {
      const n = 10
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n
        const ya = y0 + (y1 - y0) * t0 - Math.sin(t0 * Math.PI) * 4, yb = y0 + (y1 - y0) * t1 - Math.sin(t1 * Math.PI) * 4
        const za = z0 + (z1 - z0) * t0, zb = z0 + (z1 - z0) * t1
        const len = Math.hypot(yb - ya, zb - za) / 2
        const ang = Math.atan2(yb - ya, zb - za)
        const g = new Builder(); g.box(0, 0, 0, 0.12, 0.12, len, 0x2b2e33)
        const geo = g.geometry()
        geo.rotateX(-ang); geo.translate(x, (ya + yb) / 2, (za + zb) / 2)
        const p = geo.attributes.position.array, nn = geo.attributes.normal.array, cc = geo.attributes.color.array
        for (let k = 0; k < p.length; k += 3) { b.pos.push(p[k], p[k + 1], p[k + 2]); b.nor.push(nn[k], nn[k + 1], nn[k + 2]); b.col.push(cc[k], cc[k + 1], cc[k + 2]); b.uv.push(0.01, 0.01) }
      }
    }
    for (const sx of [-8.6, 8.6]) {
      cable(sx, 37, 650, 1, 686)          // 手前の塔から跳ね上がった端へ
      cable(sx, 37, 650, -60, 704)        // 切れて谷へ垂れたケーブル
      cable(sx, 33, 776, 0, 752)          // 奥の塔から着地側へ
      cable(sx, 33, 776, -55, 735)
    }
    // 垂れ下がった板の残骸（谷側へ傾いた板）
    const hang = (z, y, tilt, len, dir) => {
      const g = new Builder(); g.box(0, 0, 0, 6.5, 0.9, len, 0x6f6a62, 0, { top: 0x3b3f46 })
      const geo = g.geometry(); geo.translate(0, 0, dir * len); geo.rotateX(tilt * dir); geo.translate(0, y, z)
      const p = geo.attributes.position.array, nn = geo.attributes.normal.array, cc = geo.attributes.color.array
      for (let k = 0; k < p.length; k += 3) { b.pos.push(p[k], p[k + 1], p[k + 2]); b.nor.push(nn[k], nn[k + 1], nn[k + 2]); b.col.push(cc[k], cc[k + 1], cc[k + 2]); b.uv.push(0.01, 0.01) }
    }
    hang(691, -2.4, 1.15, 7, 1)
    hang(749, -2.6, 1.2, 8, -1)
    // 鉄筋の飛び出し
    for (let i = -6; i <= 6; i += 1.5) { b.box(i, 1.2, 691, 0.06, 0.06, 1.6, 0x5a3a2a, 0); b.box(i, -0.6, 749.2, 0.06, 0.06, 1.4, 0x5a3a2a, 0) }
    const m = new THREE.Mesh(b.geometry(), vc)
    m.castShadow = true
    root.add(m)
  }

  // ---------------------------------------- 杉林・残骸
  {
    const spots = []
    let seed = 11
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const clearOf = (x, z) => {
      for (const sg of world.roadGrid.at(x, z)) {
        const dx = sg.bx - sg.ax, dz = sg.bz - sg.az, L = dx * dx + dz * dz
        let t = L ? ((x - sg.ax) * dx + (z - sg.az) * dz) / L : 0
        t = Math.max(0, Math.min(1, t))
        if (Math.hypot(x - (sg.ax + dx * t), z - (sg.az + dz * t)) < sg.hw + 3.5) return false
      }
      for (const o of world.nearby(x, z)) {
        const c = Math.cos(o.yaw || 0), sn = Math.sin(o.yaw || 0), ddx = x - o.cx, ddz = z - o.cz
        if (Math.abs(ddx * c - ddz * sn) < o.hw + 3 && Math.abs(ddx * sn + ddz * c) < o.hl + 3) return false
      }
      for (const r of world.repair) if (x > r.x0 - 4 && x < r.x1 + 4 && z > r.z0 - 4 && z < r.z1 + 4) return false
      return true
    }
    // コースの中の木は当たり判定と同じ位置（world.trees）。外周の山は見た目だけ（街は外周も建物）
    for (const t of world.trees) spots.push(t)
    const SP = 9
    if (!CITY) for (let z = BOUNDS.z0 - 80; z < BOUNDS.z1 + 80; z += SP) for (let x = BOUNDS.x0 - 80; x < BOUNDS.x1 + 80; x += SP) {
      const px = x + (rnd() - 0.5) * SP * 0.9, pz = z + (rnd() - 0.5) * SP * 0.9
      const inPlay = px > BOUNDS.x0 && px < BOUNDS.x1 && pz > BOUNDS.z0 && pz < BOUNDS.z1
      if (inPlay) continue
      if (rnd() > 0.7 * Q.trees) continue
      const h = terrain(px, pz)
      spots.push({ x: px, y: h, z: pz, s: 0.75 + rnd() * 0.65, r: rnd() * 6.28 })
    }
    forest = buildForest(root, spots)
    // 道の脇 3〜25m に草むら
    const tufts = []
    for (const sg of world.segs) {
      if (CITY || (Math.min(sg.az, sg.bz) < 626 && Math.max(sg.az, sg.bz) < 626)) continue
      const L = Math.hypot(sg.bx - sg.ax, sg.bz - sg.az)
      for (let d = 0; d < L; d += 1.6) {
        for (const side of [-1, 1]) {
          if (rnd() < 1 - 0.65 * Q.tufts) continue
          const off = sg.hw + 1.5 + Math.pow(rnd(), 1.6) * 22
          const tx = sg.ax + (sg.bx - sg.ax) * d / L + (-(sg.bz - sg.az) / L) * off * side + (rnd() - 0.5) * 2
          const tz = sg.az + (sg.bz - sg.az) * d / L + ((sg.bx - sg.ax) / L) * off * side + (rnd() - 0.5) * 2
          const h = terrain(tx, tz)
          if (h < -2.5 || world.surfaceAt(tx, tz) !== 'grass' || !clearOf(tx, tz)) continue
          tufts.push({ x: tx, y: h, z: tz, s: 0.45 + rnd() * 0.6, r: rnd() * 6.28 })
        }
      }
    }
    buildTufts(root, tufts)
    const trunk = new Builder()
    for (const d of world.decor) if (d.kind === 'debris') {
      for (let i = 0; i < 6; i++) trunk.box(d.x + Math.sin(i * 2) * d.s, d.y + (i % 3), d.z + Math.cos(i * 3) * d.s, 2 + i % 2, 0.8, 3, 0xd0ccc4, i)
    }
    if (!trunk.empty) { const m = new THREE.Mesh(trunk.geometry(), concrete); m.castShadow = true; root.add(m) }
  }

  // ---------------------------------------- チェックポイントの門
  const gates = []
  world.gates.forEach((g, i) => {
    const grp = new THREE.Group()
    const isGoal = i === world.gates.length - 1
    // 門は復帰位置を中心に、ゲートの線の向きに 16m 幅で立てる（線そのものは光る帯で示す）
    const dx = (g.b.x - g.a.x) / g.len, dz = (g.b.z - g.a.z) / g.len
    const w = Math.min(16, g.len)
    const x = g.respawn.x, z = g.respawn.z
    const h0 = world.groundAt(x, z, 60).h
    const postM = new THREE.MeshStandardMaterial({ color: isGoal ? 0xffffff : 0x1f2633, roughness: 0.6 })
    for (const s2 of [-w / 2, w / 2]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), postM)
      p.position.set(x + dx * s2, h0 + 3.5, z + dz * s2)
      p.castShadow = true
      grp.add(p)
    }
    const label = isGoal ? (world.laps > 1 ? 'FINISH' : 'GOAL') : g.name
    const tex = isGoal ? checkerTexture() : textTexture(label, { bg: '#ff5a1f', fg: '#fff', font: 'bold 56px sans-serif' })
    const banner = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 1.6, 0.3), [postM, postM, postM, postM, new THREE.MeshStandardMaterial({ map: tex }), new THREE.MeshStandardMaterial({ map: tex })])
    banner.position.set(x, h0 + 7, z)
    banner.rotation.y = Math.atan2(-dz, dx)
    grp.add(banner)
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(g.len, 1.2), new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }))
    beam.position.set(g.cx, world.groundAt(g.cx, g.cz, 60).h + 0.7, g.cz)
    beam.rotation.y = Math.atan2(-dz, dx)
    grp.add(beam)
    root.add(grp)
    gates.push({ grp, beam })
  })

  // ---------------------------------------- 看板（ルートの案内）
  const signs = CITY ? [] : [
    { x: 0, z: 116, t: 'ROAD CLOSED', yaw: Math.PI, y: 0, stripes: true },
    { x: 0, z: 405, t: 'NO ENTRY', yaw: Math.PI, y: 0, stripes: true },
    { x: 0, z: 626, t: 'BRIDGE OUT', yaw: Math.PI, y: 0, stripes: true },
    { x: -14, z: 632, t: '< DETOUR', yaw: Math.PI, y: 0 },
    { x: 0, z: 872, t: 'MINE ROAD', yaw: Math.PI, y: 0, stripes: true },
    { x: 56, z: 358, t: 'UNDER CONSTRUCTION', yaw: Math.PI, y: 4 }
  ]
  for (const s of signs) {
    const tex = textTexture(s.t, { stripes: s.stripes, w: 512, h: 128, font: 'bold 54px sans-serif' })
    const h0 = terrain(s.x, s.z) + s.y
    const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide }))
    m.position.set(s.x, h0 + 5.5, s.z); m.rotation.y = s.yaw
    root.add(m)
    for (const sx of [-3.6, 3.6]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5.5, 0.2), new THREE.MeshStandardMaterial({ color: 0x555b63 }))
      p.position.set(s.x + sx * Math.cos(s.yaw), h0 + 2.75, s.z)
      root.add(p)
    }
  }

  // ---------------------------------------- 近道の看板と、地面の矢印
  {
    const paint = new Builder()
    for (const sc of world.shortcuts || []) {
      const [ax, az] = sc.inA, [bx, bz] = sc.outB
      const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L
      const yaw = Math.atan2(dx, dz)
      for (let d = 6; d < L - 4; d += 9) {
        const x = ax + dx * d, z = az + dz * d, y = world.groundAt(x, z, 50).h + 0.06
        // くの字の矢印（進む向きを指す）
        for (const s2 of [-1, 1]) paint.box(x + Math.cos(yaw) * s2 * 0.9 - dx * 0.6, y, z - Math.sin(yaw) * s2 * 0.9 - dz * 0.6, 0.35, 0.02, 1.3, 0xff8a1f, yaw + s2 * 0.6)
      }
      // 入口の看板（道の側を向く）
      const [ox, oz] = sc.out
      const sx = sc.inA[0] + ox * 4, sz = sc.inA[1] + oz * 4
      const h0 = world.groundAt(sx, sz, 50).h
      const label = (sc.label || '') + '  近道 SHORTCUT'
      const board = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.6), new THREE.MeshStandardMaterial({ map: textTexture(label.trim(), { bg: '#ff6a1a', fg: '#fff', w: 512, h: 148, font: 'bold 52px sans-serif', stripes: false }), emissive: 0xff6a1a, emissiveIntensity: 0.35, side: THREE.DoubleSide }))
      board.position.set(sx, h0 + 5.2, sz)
      board.rotation.y = Math.atan2(ox, oz)
      root.add(board)
      for (const s2 of [-4, 4]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4, 0.22), new THREE.MeshStandardMaterial({ color: 0x2b2e33 }))
        p.position.set(sx + Math.cos(board.rotation.y) * s2, h0 + 2, sz - Math.sin(board.rotation.y) * s2)
        root.add(p)
      }
    }
    if (!paint.empty) root.add(new THREE.Mesh(paint.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0xff5a10, emissiveIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 })))
  }

  // ---------------------------------------- 修理ピット
  for (const r of world.repair) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2
    const h0 = terrain(cx, cz)
    // 文字が鏡写しにならないよう横に裏返して貼る
    const padTex = textTexture('REPAIR', { bg: '#1d6fd1', fg: '#fff', w: 256, h: 256, font: 'bold 56px sans-serif' })
    padTex.wrapS = THREE.RepeatWrapping; padTex.repeat.x = -1
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -6 }))
    pad.position.set(cx, h0 + 0.12, cz)
    root.add(pad)
    const roof = new THREE.Mesh(new THREE.BoxGeometry(r.x1 - r.x0, 0.4, r.z1 - r.z0), new THREE.MeshStandardMaterial({ color: 0x2b78d6, roughness: 0.6 }))
    roof.position.set(cx, h0 + 6, cz); roof.castShadow = true
    root.add(roof)
    for (const [sx, sz] of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.4), new THREE.MeshStandardMaterial({ color: 0xdddddd }))
      p.position.set(sx, h0 + 3, sz); root.add(p)
    }
  }

  return { root, gates, plankMeshes, forest }
}

function checkerTexture() {
  const cv = document.createElement('canvas')
  cv.width = 256; cv.height = 32
  const g = cv.getContext('2d')
  for (let y = 0; y < 2; y++) for (let x = 0; x < 16; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 16, y * 16, 16, 16) }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.magFilter = THREE.NearestFilter
  return t
}

// ======================================== 壊せる物
// 1物体 = 1メッシュ（色を頂点に焼く）。壊れたら非表示にして、破片か倒れる動きに置き換える
export function propGeometry(type) {
  const d = DESTRUCT[type]
  const b = new Builder()
  const W = d.w / 2, L = d.l / 2, H = d.h
  switch (type) {
    case 'cone':
      b.box(0, 0.03, 0, 0.32, 0.03, 0.32, 0x222222)
      b.box(0, 0.35, 0, 0.18, 0.3, 0.18, 0xff7a1a)
      b.box(0, 0.45, 0, 0.19, 0.06, 0.19, 0xffffff)
      break
    case 'barricade':
      for (const sx of [-W + 0.2, W - 0.2]) b.box(sx, 0.5, 0, 0.08, 0.5, 0.25, 0x666666)
      for (let i = 0; i < 6; i++) b.box(-W + 0.25 + i * (2 * W - 0.5) / 6 + (2 * W - 0.5) / 12, 0.85, 0, (2 * W - 0.5) / 12, 0.18, 0.06, i % 2 ? 0xffffff : 0xe8432e)
      b.box(0, 0.45, 0, W, 0.06, 0.05, 0xffffff)
      break
    case 'fence':
      b.box(0, 0.5, 0, W, 0.07, 0.06, 0x8a5c33); b.box(0, 1.05, 0, W, 0.07, 0.06, 0x8a5c33)
      for (let x = -W + 0.2; x <= W; x += 0.5) b.box(x, 0.7, 0, 0.09, 0.7, 0.04, 0xa8784a)
      break
    case 'tempfence':
      b.box(0, 0.1, 0, W, 0.1, 0.25, 0x555555)
      b.box(0, H / 2, 0, W - 0.1, H / 2 - 0.05, 0.03, 0x8aa0b0)
      for (const sx of [-W, 0, W]) b.box(sx * 0.98, H / 2, 0, 0.05, H / 2, 0.05, 0xbfc6cc)
      b.box(0, 1.0, 0.04, W * 0.6, 0.35, 0.01, 0xf2c230)
      break
    case 'sign':
      b.box(0, 1.0, 0, 0.06, 1.0, 0.06, 0x666b72)
      b.box(0, 2.0, 0, W, 0.55, 0.05, 0x2e8bd8, 0, { top: 0xffffff })
      b.box(0, 2.0, 0.06, W * 0.8, 0.12, 0.01, 0xffffff)
      break
    case 'lamp':
      b.box(0, 0.15, 0, 0.25, 0.15, 0.25, 0x555b63)
      b.box(0, H / 2, 0, 0.1, H / 2, 0.1, 0x6d7480)
      b.box(0, H - 0.1, 0.6, 0.08, 0.06, 0.6, 0x6d7480)
      b.box(0, H - 0.22, 1.1, 0.22, 0.08, 0.3, 0xfff3c4)
      break
    case 'lumber':
      for (let row = 0; row < 4; row++) for (let i = 0; i < 4 - (row % 2); i++)
        b.box(-W + 0.45 + i * 0.8 + (row % 2) * 0.4, 0.2 + row * 0.38, 0, 0.36, 0.18, L, row % 2 ? 0xc4904f : 0xb47f42)
      break
    case 'guardrail':
      b.box(0, 0.65, 0, W, 0.17, 0.05, 0xc9ced6)
      for (const sx of [-W + 0.2, 0, W - 0.2]) b.box(sx, 0.4, -0.08, 0.07, 0.4, 0.07, 0x8b9099)
      break
    case 'wall':
      for (let row = 0; row < 10; row++) for (let i = 0; i < 8; i++)
        b.box(-W + 1 + i * 2 + (row % 2 ? 0.5 : -0.5), 0.3 + row * 0.6, 0, 0.97, 0.28, L, (row * 3 + i) % 4 ? 0xa65a3f : 0x8f4b35)
      b.box(0, H + 0.2, 0, W, 0.2, L + 0.1, 0x6b5a4c)
      break
    case 'parked': {
      // 停めてある車（駐車場）
      const cols = [0xd8d8d8, 0x2b2e33, 0x8b0f14, 0x3c5a8a, 0xc9c2a8]
      const c = cols[Math.floor(Math.abs(Math.sin(W * 91 + L * 7)) * 5) % 5]
      b.box(0, 0.5, 0, W, 0.35, L, c, 0, { top: c })
      b.box(0, 1.05, -0.2, W * 0.86, 0.3, L * 0.5, 0x1b2a3a)
      for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) b.box(sx * (W - 0.05), 0.32, sz * (L - 0.75), 0.12, 0.32, 0.32, 0x15161a)
      break
    }
    case 'signal':
      b.box(0, 2.6, 0, 0.09, 2.6, 0.09, 0x3a3e45)
      b.box(0, 5.0, 1.0, 0.07, 0.07, 1.0, 0x3a3e45)
      b.box(0, 4.7, 1.9, 0.18, 0.45, 0.16, 0x1b1d21)
      b.box(0, 4.95, 2.07, 0.11, 0.11, 0.02, 0xff3b30)
      b.box(0, 4.45, 2.07, 0.11, 0.11, 0.02, 0x36c37a)
      break
    case 'tower': {
      // 工事用の鉄塔（格子）
      const s = W
      for (const [x, z] of [[-s, -s], [s, -s], [s, s], [-s, s]]) b.box(x * 0.9, H / 2, z * 0.9, 0.15, H / 2, 0.15, 0xe0a020)
      for (let y = 2; y < H; y += 3) {
        b.box(0, y, -s * 0.9, s, 0.08, 0.08, 0xd09018); b.box(0, y, s * 0.9, s, 0.08, 0.08, 0xd09018)
        b.box(-s * 0.9, y, 0, 0.08, 0.08, s, 0xd09018); b.box(s * 0.9, y, 0, 0.08, 0.08, s, 0xd09018)
      }
      b.box(0, H, 0, s + 0.3, 0.3, s + 0.3, 0xe8432e)
      // 南面の足場板。倒れるとこの面が上になり、細い橋の路面になる
      for (let y = 1; y < H; y += 1.2) b.box(0, y, -s - 0.08, 1.6, 0.55, 0.06, y % 2.4 < 1.2 ? 0xc49a5c : 0xb08850)
      break
    }
  }
  return b.geometry()
}

// 板の木目
function plankTexture() {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 256
  const g = cv.getContext('2d')
  for (let i = 0; i < 8; i++) {
    const v = 150 + (i * 37) % 50
    g.fillStyle = `rgb(${v},${(v * 0.72) | 0},${(v * 0.45) | 0})`
    g.fillRect(0, i * 32, 256, 31)
    g.strokeStyle = 'rgba(60,35,15,0.25)'
    for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(0, i * 32 + 4 + k * 5); g.bezierCurveTo(80, i * 32 + k * 5, 170, i * 32 + 9 + k * 5, 256, i * 32 + 3 + k * 5); g.stroke() }
  }
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// ビルの外壁（9m 四方 = 3階 x 窓3つ）。窓ガラスは粗さを低くして空を映す
function facadeTextures() {
  const S = 512
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return [c, c.getContext('2d')] }
  const [cv, g] = mk(), [cr, gr] = mk()
  let seed = 5
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  g.fillStyle = '#d9d6cf'; g.fillRect(0, 0, S, S)
  // 壁のむら
  for (let i = 0; i < 1800; i++) { const v = 190 + rnd() * 50; g.fillStyle = `rgba(${v},${v},${v - 6},0.25)`; g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 6, 2 + rnd() * 6) }
  gr.fillStyle = 'rgb(225,225,225)'; gr.fillRect(0, 0, S, S)
  const fl = S / 3, wn = S / 3
  for (let fy = 0; fy < 3; fy++) {
    // 階の帯
    g.fillStyle = 'rgba(120,118,112,0.55)'; g.fillRect(0, fy * fl + fl - 10, S, 7)
    for (let wx = 0; wx < 3; wx++) {
      const x = wx * wn + 18, y = fy * fl + 26, w = wn - 36, h = fl - 60
      // 枠
      g.fillStyle = '#5d6168'; g.fillRect(x - 5, y - 5, w + 10, h + 10)
      // ガラス（上が明るい空、下が暗い）
      const grd = g.createLinearGradient(0, y, 0, y + h)
      const lit = rnd() < 0.12
      grd.addColorStop(0, lit ? '#d9c79a' : '#5f7387'); grd.addColorStop(1, lit ? '#a78e5c' : '#1f2833')
      g.fillStyle = grd; g.fillRect(x, y, w, h)
      if (!lit && rnd() < 0.4) { g.fillStyle = 'rgba(230,225,210,0.55)'; g.fillRect(x, y, w * (0.3 + rnd() * 0.5), h) } // カーテン
      g.fillStyle = '#5d6168'; g.fillRect(x + w / 2 - 2, y, 4, h); g.fillRect(x, y + h * 0.35, w, 3)
      gr.fillStyle = 'rgb(28,28,28)'; gr.fillRect(x, y, w, h)
    }
  }
  const map = new THREE.CanvasTexture(cv), rough = new THREE.CanvasTexture(cr)
  for (const t of [map, rough]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8 }
  map.colorSpace = THREE.SRGBColorSpace
  return { map, rough }
}

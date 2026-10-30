// 杉林。1本 = 幹（実写の杉の樹皮）＋ 葉の板3枚（手描きの枝葉の絵を透かして十字に立てる）。
// 全部を InstancedMesh 2つで描く（何千本でも描画は2回）。
import * as THREE from 'three'
import { tex } from './look.js'
import { Q } from './quality.js'

// 葉の絵: 下から上へ、垂れた枝の房を重ねて細長い円錐の樹冠を描く
function crownTexture() {
  const W = 256, H = 1024
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const g = cv.getContext('2d')
  let seed = 3
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const layers = 46
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1)              // 0 = 下, 1 = 上
    const y = H * (0.97 - t * 0.93)
    const half = (W * 0.47) * Math.pow(1 - t, 0.85) + 6
    // 枝の房（左右へ垂れる楕円の集まり）
    for (let k = 0; k < 14; k++) {
      const side = rnd() < 0.5 ? -1 : 1
      const reach = half * (0.25 + rnd() * 0.8)
      const x = W / 2 + side * reach * (0.4 + rnd() * 0.6)
      const yy = y + rnd() * 26 - 6 + reach * 0.12
      const rw = 10 + rnd() * 22 * (1 - t * 0.6), rh = 6 + rnd() * 10
      const light = 0.55 + 0.45 * ((side > 0 ? 0.65 : 0.35) + (1 - (yy / H)) * 0.3) + (rnd() - 0.5) * 0.2
      const r = 28 * light, gg = 62 * light + 8, b = 30 * light
      g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`
      g.beginPath(); g.ellipse(x, yy, rw, rh, side * (0.25 + rnd() * 0.3), 0, Math.PI * 2); g.fill()
      // 細かい葉先
      g.strokeStyle = `rgba(${(r * 1.3) | 0},${(gg * 1.25) | 0},${(b * 1.2) | 0},0.9)`
      g.lineWidth = 1.4
      for (let n = 0; n < 6; n++) {
        const a = rnd() * Math.PI * 2, l = rw * (0.6 + rnd() * 0.7)
        g.beginPath(); g.moveTo(x, yy); g.lineTo(x + Math.cos(a) * l, yy + Math.abs(Math.sin(a)) * l * 0.6); g.stroke()
      }
    }
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function crownGeometry() {
  // 高さ1・幅1の板を3枚、60度ずつ回して十字に立てる。法線は幹から外向き＋上向き（丸く見える）
  const pos = [], nor = [], uv = [], idx = []
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI / 3, c = Math.cos(a), s = Math.sin(a)
    const base = pos.length / 3
    const P = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]
    for (const [u, v] of P) {
      pos.push(u * c, v, u * s)
      const n = new THREE.Vector3(u * c, 0.55, u * s).normalize()
      nor.push(n.x, n.y, n.z)
      uv.push(u + 0.5, v)
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

// spots: [{ x, y, z, s(高さの倍率), r(回転) }]
export function buildForest(scene, spots) {
  const n = spots.length
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.34, 1, 7, 1, true).translate(0, 0.5, 0)
  const bark = new THREE.TextureLoader().load(`assets/${Q.tex}/japanese_cedar_bark_diff.webp`); bark.colorSpace = THREE.SRGBColorSpace; bark.wrapS = bark.wrapT = THREE.RepeatWrapping; bark.repeat.set(1, 6)
  const trunkMat = new THREE.MeshStandardMaterial({ map: bark, roughness: 0.95, color: 0xb8a898 })
  const crownMat = new THREE.MeshStandardMaterial({ map: crownTexture(), alphaTest: 0.45, alphaToCoverage: Q.msaa > 0, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 })
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n)
  const crowns = new THREE.InstancedMesh(crownGeometry(), crownMat, n)
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3()
  const col = new THREE.Color()
  spots.forEach((t, i) => {
    const H = 16 * t.s                        // 木の高さ
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.r)
    // 幹は樹冠の下を少し越えるところまで
    m.compose(p.set(t.x, t.y - 0.3, t.z), q, sc.set(t.s * 1.1, H * 0.75, t.s * 1.1))
    trunks.setMatrixAt(i, m)
    // 樹冠は高さの 30% から上
    const cw = H * 0.34
    m.compose(p.set(t.x, t.y + H * 0.28, t.z), q, sc.set(cw, H * 0.74, cw))
    crowns.setMatrixAt(i, m)
    const v = 0.78 + ((i * 7919) % 100) / 100 * 0.38
    crowns.setColorAt(i, col.setRGB(v * 0.96, v, v * 0.92))
  })
  for (const im of [trunks, crowns]) { im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; scene.add(im) }
  crowns.instanceColor.needsUpdate = true
  crowns.frustumCulled = trunks.frustumCulled = false
  // 折れた木を消す・戻す（i は spots の順番）
  const saveT = trunks.instanceMatrix.array.slice(), saveC = crowns.instanceMatrix.array.slice()
  const zero = new THREE.Matrix4().makeScale(0, 0, 0)
  return {
    trunks, crowns,
    hide(i) { trunks.setMatrixAt(i, zero); crowns.setMatrixAt(i, zero); trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true },
    show(i) { for (const [im, sv] of [[trunks, saveT], [crowns, saveC]]) { im.instanceMatrix.array.set(sv.subarray(i * 16, i * 16 + 16), i * 16); im.instanceMatrix.needsUpdate = true } },
    reset() { trunks.instanceMatrix.array.set(saveT); crowns.instanceMatrix.array.set(saveC); trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true },
    // 1本だけの見た目（倒れる演出用）。原点は根元
    single(i) {
      const g = new THREE.Group(), m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
      trunks.getMatrixAt(i, m); m.decompose(p, q, s)
      const base = p.clone()
      for (const im of [trunks, crowns]) {
        im.getMatrixAt(i, m)
        const mesh = new THREE.Mesh(im.geometry, im.material)
        m.decompose(mesh.position, mesh.quaternion, mesh.scale)
        mesh.position.sub(base); mesh.castShadow = true
        g.add(mesh)
      }
      g.position.copy(base)
      return g
    }
  }
}

// 道ばたの草むら（板2枚の十字）。近くだけに置く
function grassTexture() {
  const cv = document.createElement('canvas')
  cv.width = 256; cv.height = 128
  const g = cv.getContext('2d')
  let seed = 9
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 260; i++) {
    const x = rnd() * 256, h = 40 + rnd() * 85, lean = (rnd() - 0.5) * 30
    const v = 0.55 + rnd() * 0.45
    g.strokeStyle = `rgb(${(60 * v) | 0},${(105 * v + 20) | 0},${(38 * v) | 0})`
    g.lineWidth = 1.5 + rnd() * 2
    g.beginPath(); g.moveTo(x, 128); g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h); g.stroke()
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function buildTufts(scene, spots) {
  const pos = [], uv = [], nor = [], idx = []
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI / 2, c = Math.cos(a), s = Math.sin(a), b = pos.length / 3
    for (const [u, v] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) { pos.push(u * c, v, u * s); uv.push(u + 0.5, v); nor.push(0, 1, 0) }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setIndex(idx)
  const mat = new THREE.MeshStandardMaterial({ map: grassTexture(), alphaTest: 0.4, alphaToCoverage: Q.msaa > 0, side: THREE.DoubleSide, roughness: 1 })
  const im = new THREE.InstancedMesh(geo, mat, spots.length)
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3()
  spots.forEach((t, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.r)
    m.compose(p.set(t.x, t.y - 0.05, t.z), q, sc.set(t.s * 1.6, t.s, t.s * 1.6))
    im.setMatrixAt(i, m)
  })
  im.receiveShadow = true
  im.frustumCulled = false
  scene.add(im)
  return im
}

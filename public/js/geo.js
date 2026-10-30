// 形を組む小道具。色を頂点に焼いて1つのジオメトリにまとめる（ドローコールを減らす）。
import * as THREE from 'three'

const _c = new THREE.Color()

// 箱（任意の回転・位置）を色つきで足していくビルダー
export class Builder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = [] }

  // 8頂点で決まる六面体（坂や傾いた板もこれで作る）。p は [x,y,z] x8:
  // 0..3 = 下面（-u-v, +u-v, +u+v, -u+v）、4..7 = 上面（同順）
  hexa(p, color, { top = null, uvScale = 0, shade = true, noTop = false, noBottom = false } = {}) {
    const faces = [
      [4, 5, 6, 7, 'top'], [3, 2, 1, 0, 'bottom'],
      [0, 1, 5, 4, 's'], [1, 2, 6, 5, 's'], [2, 3, 7, 6, 's'], [3, 0, 4, 7, 's']
    ]
    for (const [a, b, c, d, kind] of faces) {
      if ((noTop && kind === 'top') || (noBottom && kind === 'bottom')) continue
      const col = kind === 'top' && top != null ? top : color
      _c.set(col)
      if (shade && kind === 's') _c.multiplyScalar(0.86)
      if (kind === 'bottom') _c.multiplyScalar(0.6)
      const A = p[a], B = p[b], C = p[c], D = p[d]
      const n = new THREE.Vector3().crossVectors(
        new THREE.Vector3(C[0] - A[0], C[1] - A[1], C[2] - A[2]),
        new THREE.Vector3(B[0] - A[0], B[1] - A[1], B[2] - A[2])).normalize()
      const w = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2])
      const h = Math.hypot(D[0] - A[0], D[1] - A[1], D[2] - A[2])
      const us = uvScale && kind === 's' ? w / uvScale : 0, vs = uvScale && kind === 's' ? h / uvScale : 0
      const uvs = kind === 's' && uvScale ? [[0, 0], [us, 0], [us, vs], [0, vs]] : [[0.01, 0.01], [0.01, 0.01], [0.01, 0.01], [0.01, 0.01]]
      for (const [i, q] of [[0, A], [2, C], [1, B], [0, A], [3, D], [2, C]]) {
        this.pos.push(...q); this.nor.push(n.x, n.y, n.z); this.col.push(_c.r, _c.g, _c.b); this.uv.push(...uvs[i])
      }
    }
  }

  // 中心・半寸法・ヨー回転の箱
  box(cx, cy, cz, hw, hh, hl, color, yaw = 0, opts) {
    const c = Math.cos(yaw), s = Math.sin(yaw)
    const P = (u, y, v) => [cx + u * c + v * s, cy + y, cz - u * s + v * c]
    this.hexa([
      P(-hw, -hh, -hl), P(hw, -hh, -hl), P(hw, -hh, hl), P(-hw, -hh, hl),
      P(-hw, hh, -hl), P(hw, hh, -hl), P(hw, hh, hl), P(-hw, hh, hl)
    ], color, opts)
  }

  // 三角形を直接足す
  tri(a, b, c, color) {
    _c.set(color)
    const n = new THREE.Vector3().crossVectors(
      new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
      new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])).normalize()
    for (const q of [a, b, c]) { this.pos.push(...q); this.nor.push(n.x, n.y, n.z); this.col.push(_c.r, _c.g, _c.b); this.uv.push(0.01, 0.01) }
  }

  geometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.computeBoundingSphere()
    return g
  }
  get empty() { return this.pos.length === 0 }
}

// 窓の柄（建物の側面に繰り返す）。左下の小さな角は無地として使う
export function windowTexture() {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const g = cv.getContext('2d')
  g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128)
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const lit = (x + y * 3) % 3 === 0
    g.fillStyle = lit ? '#fff1c4' : '#3a4656'
    g.fillRect(14 + x * 64, 18 + y * 64, 36, 30)
    g.fillStyle = 'rgba(255,255,255,0.35)'
    g.fillRect(14 + x * 64, 18 + y * 64, 36, 4)
  }
  g.fillStyle = '#fff'; g.fillRect(0, 0, 6, 6)
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

// 文字の看板テクスチャ
export function textTexture(text, { bg = '#f2c230', fg = '#14161a', w = 256, h = 96, font = 'bold 44px sans-serif', stripes = false } = {}) {
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const g = cv.getContext('2d')
  g.fillStyle = bg; g.fillRect(0, 0, w, h)
  if (stripes) {
    g.fillStyle = '#14161a'
    for (let x = -h; x < w; x += 36) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 18, h); g.lineTo(x + 18 + h, 0); g.lineTo(x + h, 0); g.fill() }
    g.fillStyle = bg; g.fillRect(10, 14, w - 20, h - 28)
  }
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'
  // 長い文字は枠に収まるまで小さくする
  let size = Number((font.match(/(\d+)px/) || [0, 40])[1])
  while (g.measureText(text).width > w * 0.9 && size > 12) { size -= 2; g.font = font.replace(/\d+px/, size + 'px') }
  g.fillText(text, w / 2, h / 2 + 2)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// ぼかした丸（煙・土ぼこり・火花）
export function softDot() {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const g = cv.getContext('2d')
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(cv)
}

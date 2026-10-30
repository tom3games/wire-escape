// ビルの外壁。実写の壁（Poly Haven, CC0）に窓・店先・看板を描いた1枚のアトラスを、全部のビルで使い回す（描画は1回）。
// アトラスは 横4 x 縦3 マス:
//   上の段 = 上の階（幅 6m x 高さ 7.2m = 2部屋 x 2階）、中の段 = 1階の店先（6m x 4.5m）、下の段 = 看板（縦看板2つ + 横長の屋上広告）
// 型: 0 事務所（コンクリート板）/ 1 タイル張りのマンション / 2 ガラスのビル / 3 レンガ
import * as THREE from 'three'
import { Q } from './quality.js'

const UP_W = 6, UP_H = 7.2, GF_H = 4.5
const WALLS = {
  tiles: ['rectangular_facade_tiles', 2.0],
  panels: ['concrete_panels', 4.0],
  brick: ['red_brick_03', 1.2],
  plaster: ['plastered_wall_04', 3.2],
  iron: ['corrugated_iron', 1.12]
}

export function createFacade() {
  const S = Q.tex === 'tex512' ? 1024 : 2048
  const cw = S / 4, ch = S / 3
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c }
  const cv = { a: mk(), n: mk(), r: mk(), e: mk() }
  const g = { a: cv.a.getContext('2d'), n: cv.n.getContext('2d'), r: cv.r.getContext('2d'), e: cv.e.getContext('2d') }
  const tex = {
    a: new THREE.CanvasTexture(cv.a), n: new THREE.CanvasTexture(cv.n), r: new THREE.CanvasTexture(cv.r), e: new THREE.CanvasTexture(cv.e)
  }
  tex.a.colorSpace = THREE.SRGBColorSpace; tex.e.colorSpace = THREE.SRGBColorSpace
  for (const t of Object.values(tex)) { t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter }

  let imgs = null
  draw()
  // 実写の壁を読み込んだら描き直す
  const load = (name, m) => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = `assets/${Q.tex}/${name}_${m}.webp` })
  Promise.all(Object.entries(WALLS).map(async ([k, [name]]) => [k, { a: await load(name, 'diff'), n: await load(name, 'nor_gl'), r: await load(name, 'rough') }]))
    .then(list => { imgs = Object.fromEntries(list); draw(); for (const t of Object.values(tex)) t.needsUpdate = true })

  // マス (col,row) を、左下原点・メートル単位（W x H）で描けるようにする
  function cell(col, row, W, H, span = 1) {
    const x0 = col * cw, y0 = S - (row + 1) * ch
    for (const k of 'anre') {
      const c = g[k]
      c.setTransform(cw * span / W, 0, 0, -ch / H, x0, y0 + ch)
      c.save(); c.beginPath(); c.rect(0, 0, W, H); c.clip()
    }
  }
  function endCell() { for (const k of 'anre') { g[k].restore(); g[k].setTransform(1, 0, 0, 1, 0, 0) } }
  // 壁の地: 実写があれば並べて貼る（無ければ単色）。tint は色むらの掛け合わせ
  function wall(kind, x, y, w, h, base, rough = 220, tint = null) {
    const im = imgs && imgs[kind], size = WALLS[kind][1]
    for (const k of 'anr') {
      const c = g[k]
      const src = im && im[k]
      if (!src) { c.fillStyle = k === 'a' ? base : k === 'n' ? 'rgb(128,128,255)' : `rgb(${rough},${rough},${rough})`; c.fillRect(x, y, w, h); continue }
      c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip()
      for (let yy = y; yy < y + h; yy += size) for (let xx = x; xx < x + w; xx += size) {
        // 画像は上が上。ここは y が上向きなので反転して置く
        c.save(); c.translate(xx, yy + size); c.scale(1, -1); c.drawImage(src, 0, 0, size, size); c.restore()
      }
      c.restore()
    }
    if (tint) { const c = g.a; c.save(); c.globalCompositeOperation = 'multiply'; c.fillStyle = tint; c.fillRect(x, y, w, h); c.restore() }
    g.e.fillStyle = '#000'; g.e.fillRect(x, y, w, h)
  }
  // 凹んだ窓: ガラス（空を映す濃い色・つるつる）と、枠の4辺の陰影（法線）
  function win(x, y, w, h, { frame = '#4d535b', glass = ['#6c8196', '#1e2834'], depth = 0.12, lit = '#ffd9a0', mull = true } = {}) {
    const a = g.a, n = g.n, r = g.r, e = g.e
    const grd = a.createLinearGradient(0, y + h, 0, y)
    grd.addColorStop(0, glass[0]); grd.addColorStop(1, glass[1])
    a.fillStyle = grd; a.fillRect(x, y, w, h)
    n.fillStyle = 'rgb(128,128,255)'; n.fillRect(x, y, w, h)
    r.fillStyle = 'rgb(18,18,18)'; r.fillRect(x, y, w, h)
    e.fillStyle = lit; e.fillRect(x, y, w, h)
    // 枠の内側（凹みの側面）
    const d = depth
    n.fillStyle = 'rgb(224,128,190)'; n.fillRect(x, y, d, h)          // 左の側面は右を向く
    n.fillStyle = 'rgb(32,128,190)'; n.fillRect(x + w - d, y, d, h)   // 右の側面
    n.fillStyle = 'rgb(128,32,190)'; n.fillRect(x, y + h - d, w, d)   // 上（下を向く）
    n.fillStyle = 'rgb(128,224,190)'; n.fillRect(x, y, w, d * 1.4)    // 窓台（上を向く）
    a.fillStyle = 'rgba(0,0,0,0.35)'; a.fillRect(x, y + h - d * 2, w, d * 2) // 上の庇の影
    a.fillStyle = frame
    a.fillRect(x - 0.06, y - 0.06, w + 0.12, 0.08); a.fillRect(x - 0.06, y + h - 0.02, w + 0.12, 0.08)
    a.fillRect(x - 0.06, y, 0.08, h); a.fillRect(x + w - 0.02, y, 0.08, h)
    if (mull) { a.fillRect(x + w / 2 - 0.03, y, 0.06, h); e.fillStyle = '#000'; e.fillRect(x + w / 2 - 0.03, y, 0.06, h) }
    r.fillStyle = 'rgb(90,90,90)'; r.fillRect(x + w / 2 - 0.03, y, mull ? 0.06 : 0, h)
  }
  function band(x, y, w, h, col, nrm = 'rgb(128,200,220)') {
    g.a.fillStyle = col; g.a.fillRect(x, y, w, h)
    g.n.fillStyle = nrm; g.n.fillRect(x, y + h - 0.05, w, 0.05)
    g.e.fillStyle = '#000'; g.e.fillRect(x, y, w, h)
  }
  function text(str, x, y, size, col, { vertical = false, glow = true, font = '900' } = {}) {
    for (const k of glow ? 'ae' : 'a') {
      const c = g[k]
      c.save(); c.scale(1, -1)
      c.fillStyle = col; c.font = `${font} ${size}px "Hiragino Sans","Noto Sans JP",sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'
      if (vertical) [...str].forEach((ch_, i) => c.fillText(ch_, x, -(y - i * size * 1.05)))
      else c.fillText(str, x, -y)
      c.restore()
    }
  }

  function draw() {
    for (const k of 'anre') { g[k].setTransform(1, 0, 0, 1, 0, 0); g[k].fillStyle = k === 'n' ? 'rgb(128,128,255)' : '#000'; g[k].fillRect(0, 0, S, S) }
    // ---- 上の階
    // 0 事務所: 大きい窓とコンクリートの腰壁
    cell(0, 0, UP_W, UP_H)
    wall('panels', 0, 0, UP_W, UP_H, '#b9b6ae', 200, '#e6e2da')
    for (let f = 0; f < 2; f++) for (let b = 0; b < 2; b++) win(b * 3 + 0.35, f * 3.6 + 0.95, 2.3, 2.2, { glass: ['#7d93a8', '#26313d'] })
    for (let f = 0; f < 2; f++) band(0, f * 3.6 + 3.5, UP_W, 0.1, 'rgba(70,70,70,0.35)')
    endCell()
    // 1 タイルのマンション: 窓とベランダ（手すり）
    cell(1, 0, UP_W, UP_H)
    wall('tiles', 0, 0, UP_W, UP_H, '#c9b39a', 210)
    for (let f = 0; f < 2; f++) for (let b = 0; b < 2; b++) {
      win(b * 3 + 0.5, f * 3.6 + 1.25, 2.0, 1.9, { frame: '#d8d8d8', glass: ['#8aa0b2', '#2c3640'] })
      // ベランダの床と手すり
      band(b * 3 + 0.15, f * 3.6 + 0.2, 2.7, 0.18, '#d9d6cf')
      const a = g.a
      a.fillStyle = 'rgba(70,78,88,0.85)'; a.fillRect(b * 3 + 0.15, f * 3.6 + 1.15, 2.7, 0.06)
      for (let t = 0; t <= 2.7; t += 0.15) a.fillRect(b * 3 + 0.15 + t, f * 3.6 + 0.38, 0.025, 0.8)
    }
    endCell()
    // 2 ガラスのビル: 全面ガラスと細い方立て、階ごとの暗い腰
    cell(2, 0, UP_W, UP_H)
    wall('panels', 0, 0, UP_W, UP_H, '#5c6670', 120, '#5d6873')
    for (let f = 0; f < 2; f++) for (let b = 0; b < 4; b++) win(b * 1.5 + 0.04, f * 3.6 + 0.55, 1.42, 2.95, { frame: '#a9b1ba', glass: ['#9fb6c9', '#33465a'], depth: 0.04, mull: false })
    endCell()
    // 3 レンガ: 縦長の窓と白い枠
    cell(3, 0, UP_W, UP_H)
    wall('brick', 0, 0, UP_W, UP_H, '#8a4a38', 230)
    for (let f = 0; f < 2; f++) for (let b = 0; b < 2; b++) {
      win(b * 3 + 0.85, f * 3.6 + 0.9, 1.3, 2.1, { frame: '#e8e4dc', glass: ['#7a8c9a', '#232c35'], depth: 0.16 })
      band(b * 3 + 0.7, f * 3.6 + 0.75, 1.6, 0.14, '#d9d2c4')
    }
    endCell()

    // ---- 1階の店先
    // 0 ガラスの店: 上に看板の帯
    cell(0, 1, UP_W, GF_H)
    wall('plaster', 0, 0, UP_W, GF_H, '#cfc8bc', 220)
    win(0.3, 0.05, 5.4, 3.1, { frame: '#3a3f46', glass: ['#9fb0bd', '#3a4652'], lit: '#6a5638', depth: 0.06 })
    band(0, 3.45, UP_W, 0.8, '#1f5d8c'); text('OPEN', 3, 3.85, 0.5, '#ffffff')
    endCell()
    // 1 シャッター
    cell(1, 1, UP_W, GF_H)
    wall('plaster', 0, 0, UP_W, GF_H, '#bdb7ad', 220)
    g.a.save(); g.a.beginPath(); g.a.rect(0.3, 0, 5.4, 3.3); g.a.clip(); g.n.save(); g.n.beginPath(); g.n.rect(0.3, 0, 5.4, 3.3); g.n.clip()
    wall('iron', 0.3, 0, 5.4, 3.3, '#9aa0a6', 150, '#c4c8cc')
    g.a.restore(); g.n.restore()
    band(0.2, 3.3, 5.6, 0.25, '#7b8086')
    band(0, 3.6, UP_W, 0.75, '#b8402e'); text('ラーメン', 3, 3.98, 0.48, '#fff6e0')
    endCell()
    // 2 ロビー: 石張りとガラスの扉
    cell(2, 1, UP_W, GF_H)
    wall('panels', 0, 0, UP_W, GF_H, '#8d8a84', 160, '#9a968e')
    win(0.6, 0.05, 4.8, 3.6, { frame: '#20242a', glass: ['#b4c2cc', '#46525e'], lit: '#6e6250', depth: 0.08 })
    band(0.6, 3.75, 4.8, 0.12, '#c9c4ba')
    endCell()
    // 3 カフェ: しま模様の日よけ
    cell(3, 1, UP_W, GF_H)
    wall('brick', 0, 0, UP_W, GF_H, '#7d4535', 230)
    win(0.5, 0.05, 5.0, 2.9, { frame: '#2e3a2c', glass: ['#a5b4b8', '#3d4848'], lit: '#6f5432', depth: 0.08 })
    for (let i = 0; i < 10; i++) band(i * 0.6, 3.05, 0.6, 0.85, i % 2 ? '#f2efe6' : '#2f7a4a', 'rgb(128,190,230)')
    text('CAFE', 3, 4.15, 0.36, '#2f7a4a', { glow: false })
    endCell()

    // ---- 看板（縦看板は 1 x 4、横長の広告は 2 x 1 の比で描く）
    cell(0, 2, 1, 4)
    band(0, 0, 1, 4, '#c8102e'); g.e.fillStyle = '#5a0010'; g.e.fillRect(0, 0, 1, 4)
    text('ホテル', 0.5, 3.35, 0.62, '#fff4d8', { vertical: true })
    endCell()
    cell(1, 2, 1, 4)
    band(0, 0, 1, 4, '#13324f'); g.e.fillStyle = '#04101c'; g.e.fillRect(0, 0, 1, 4)
    text('居酒屋', 0.5, 3.35, 0.62, '#ffd23a', { vertical: true })
    endCell()
    cell(2, 2, 2, 1, 2)
    band(0, 0, 2, 1, '#111418'); g.e.fillStyle = '#060708'; g.e.fillRect(0, 0, 2, 1)
    band(0.04, 0.06, 1.92, 0.88, '#ff5a1f')
    text('BREAK THE ROUTE', 1, 0.62, 0.15, '#ffffff')
    text('24H 駐車場 P', 1, 0.3, 0.17, '#ffd23a')
    endCell()
  }

  const material = new THREE.MeshStandardMaterial({ map: tex.a, normalMap: tex.n, roughnessMap: tex.r, emissiveMap: tex.e, emissive: 0xffffff, emissiveIntensity: 0.28, vertexColors: true, roughness: 1, metalness: 0 })
  material.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 fac;\nattribute float fseed;\nvarying vec4 vFac;\nvarying float vSeed;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFac = fac; vSeed = fseed;\n#ifdef USE_NORMALMAP\nvNormalMapUv = fac.xy;\n#endif')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vFac;
varying float vSeed;
vec2 fUv; vec2 fGx; vec2 fGy; float fLit;
float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('void main() {', `void main() {
  {
    float st = floor(vFac.z + 0.5);
    vec2 cs = vec2(0.25, 1.0 / 3.0);
    vec2 rep = vFac.xy, local; vec2 org; vec2 size = cs;
    fLit = 1.0;
    if (vFac.w > 0.5) {
      // 看板
      local = clamp(rep, 0.004, 0.996);
      if (st < 1.5) org = vec2(st, 2.0) * cs; else { org = vec2(0.5, 2.0 / 3.0); size = vec2(0.5, 1.0 / 3.0); }
    } else if (rep.y < 1.0) {
      // 1階は区画（6m）ごとに違う店にする（同じ看板が並ばないように）
      float shop = floor(fHash(vec2(floor(rep.x), vSeed * 31.0)) * 3.999);
      local = vec2(fract(rep.x), clamp(rep.y, 0.0, 1.0)); org = vec2(shop, 1.0) * cs;
    } else {
      local = fract(vec2(rep.x, rep.y - 1.0)); org = vec2(st, 0.0) * cs;
      // 部屋ごとに明かりが点いているかどうか（ビルごとに違う並び）
      vec2 room = floor(vec2(rep.x * (st > 1.5 && st < 2.5 ? 4.0 : 2.0), (rep.y - 1.0) * 2.0));
      fLit = step(fHash(room + vSeed * 17.0), 0.08);
    }
    local = clamp(local, 0.003, 0.997);
    fUv = org + local * size;
    fGx = dFdx(rep) * size; fGy = dFdy(rep) * size;
  }`)
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n diffuseColor *= textureGrad(map, fUv, fGx, fGy);\n#endif')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness;\n#ifdef USE_ROUGHNESSMAP\n roughnessFactor *= textureGrad(roughnessMap, fUv, fGx, fGy).g;\n#endif')
      .replace('#include <normal_fragment_maps>', '#ifdef USE_NORMALMAP_TANGENTSPACE\n vec3 mapN = textureGrad(normalMap, fUv, fGx, fGy).xyz * 2.0 - 1.0;\n mapN.xy *= normalScale;\n normal = normalize(tbn * mapN);\n#endif')
      .replace('#include <emissivemap_fragment>', '#ifdef USE_EMISSIVEMAP\n totalEmissiveRadiance *= textureGrad(emissiveMap, fUv, fGx, fGy).rgb * fLit;\n#endif')
  }
  material.customProgramCacheKey = () => 'facade2'

  // 頂点を集める
  const P = [], N = [], C = [], U = [], F = [], SD = []
  const _c = new THREE.Color()
  function quad(a, b, c, d, nrm, col, fa, fb, fc, fd, style, kind, seed) {
    _c.set(col)
    for (const [p, f] of [[a, fa], [c, fc], [b, fb], [a, fa], [d, fd], [c, fc]]) {
      P.push(...p); N.push(...nrm); C.push(_c.r, _c.g, _c.b); U.push(f[0], f[1]); F.push(f[0], f[1], style, kind); SD.push(seed)
    }
  }
  // 軸に沿った箱のビル（x0..x1, z0..z1, 高さ h）。窓が角で切れないよう、面の幅を 6m 前後の整数マスに合わせる
  function building(x0, z0, x1, z1, y0, h, style, tint, seed) {
    const nUp = Math.max(1, Math.round((h - GF_H) / UP_H))
    // 外から見て左端 L・右端 R・外向き法線
    const faces = [
      [[x1, z0], [x0, z0], [0, 0, -1]], [[x1, z1], [x1, z0], [1, 0, 0]],
      [[x0, z1], [x1, z1], [0, 0, 1]], [[x0, z0], [x0, z1], [-1, 0, 0]]
    ]
    const yG = y0 + Math.min(GF_H, h * 0.4)
    for (const [L, R, n] of faces) {
      const nT = Math.max(1, Math.round(Math.hypot(R[0] - L[0], R[1] - L[1]) / UP_W))
      const q = (ya, yb, va, vb) => quad([R[0], ya, R[1]], [L[0], ya, L[1]], [L[0], yb, L[1]], [R[0], yb, R[1]], n, tint, [nT, va], [0, va], [0, vb], [nT, vb], style, 0, seed)
      q(y0, yG, 0, 1)
      q(yG, y0 + h, 1, 1 + nUp)
    }
  }
  function sign(cx, cy, cz, nx, nz, w, h, idx, seed) {
    // 壁から垂直に出す縦看板（両面）。nx,nz は壁の外向き
    const tx = -nz, tz = nx // 壁に沿う向き
    const out = 0.15, depth = w
    const p0 = [cx + nx * out, cy, cz + nz * out], p1 = [cx + nx * (out + depth), cy, cz + nz * (out + depth)]
    for (const s of [1, -1]) {
      const o = 0.05 * s
      const a = [p0[0] + tx * o, p0[1], p0[2] + tz * o], b = [p1[0] + tx * o, p1[1], p1[2] + tz * o]
      const nn = [tx * s, 0, tz * s]
      // 外から見て右端が u=1（どちらの面も最初の点が右下）
      const fa = [[1, 0], [0, 0], [0, 1], [1, 1]]
      if (s > 0) quad(b, a, [a[0], a[1] + h, a[2]], [b[0], b[1] + h, b[2]], nn, 0xffffff, ...fa, idx, 1, seed)
      else quad(a, b, [b[0], b[1] + h, b[2]], [a[0], a[1] + h, a[2]], nn, 0xffffff, ...fa, idx, 1, seed)
    }
  }
  function billboard(cx, cy, cz, nx, nz, w, h, seed) {
    const tx = -nz, tz = nx
    const L = [cx - tx * w / 2, cy, cz - tz * w / 2], R = [cx + tx * w / 2, cy, cz + tz * w / 2]
    for (const s of [1, -1]) {
      const nn = [nx * s, 0, nz * s]
      const o = [nx * 0.05 * s, nz * 0.05 * s]
      const a = [L[0] + o[0], L[1], L[2] + o[1]], b = [R[0] + o[0], R[1], R[2] + o[1]]
      if (s > 0) quad(a, b, [b[0], b[1] + h, b[2]], [a[0], a[1] + h, a[2]], nn, 0xffffff, [1, 0], [0, 0], [0, 1], [1, 1], 2, 1, seed)
      else quad(b, a, [a[0], a[1] + h, a[2]], [b[0], b[1] + h, b[2]], nn, 0xffffff, [1, 0], [0, 0], [0, 1], [1, 1], 2, 1, seed)
    }
  }
  function geometry() {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2))
    geo.setAttribute('fac', new THREE.Float32BufferAttribute(F, 4))
    geo.setAttribute('fseed', new THREE.Float32BufferAttribute(SD, 1))
    geo.computeBoundingSphere()
    return geo
  }
  return { material, building, sign, billboard, geometry, get empty() { return !P.length } }
}

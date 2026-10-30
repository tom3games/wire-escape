// 演出: 破片・火花・煙・土ぼこり・吹き飛ぶ物体。どれも各画面だけで作る（通信しない）。
// 数に上限を持たせ、古いものから使い回す。
import * as THREE from 'three'
import { softDot } from './geo.js'

const MAX_DEBRIS = 420
const MAX_PARTS = 900

export class FX {
  constructor(scene, world) {
    this.scene = scene
    this.world = world
    // 破片（箱）
    this.debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.8 }), MAX_DEBRIS)
    this.debrisMesh.castShadow = true
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.debrisMesh.count = MAX_DEBRIS
    this.debrisMesh.frustumCulled = false
    scene.add(this.debrisMesh)
    this.debris = []
    const hide = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < MAX_DEBRIS; i++) {
      this.debris.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1), life: 0, rest: false })
      this.debrisMesh.setMatrixAt(i, hide)
      this.debrisMesh.setColorAt(i, new THREE.Color(0xffffff))
    }
    this.di = 0

    // 粒（火花・煙・ほこり）: 1つの Points を自前シェーダで描く
    const geo = new THREE.BufferGeometry()
    this.pPos = new Float32Array(MAX_PARTS * 3)
    this.pCol = new Float32Array(MAX_PARTS * 4)
    this.pSize = new Float32Array(MAX_PARTS)
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('color4', new THREE.BufferAttribute(this.pCol, 4).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage))
    const mkMat = blending => new THREE.ShaderMaterial({
      uniforms: { map: { value: softDot() }, scale: { value: 600 } },
      vertexShader: [
        'attribute vec4 color4;', 'attribute float size;', 'varying vec4 vC;', 'uniform float scale;',
        'void main() {', '  vC = color4;', '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  gl_PointSize = size * scale / max(1.0, -mv.z);', '  gl_Position = projectionMatrix * mv;', '}'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D map;', 'varying vec4 vC;',
        'void main() {', '  vec4 t = texture2D(map, gl_PointCoord);', '  gl_FragColor = vec4(vC.rgb, vC.a * t.a);', '  if (gl_FragColor.a < 0.01) discard;', '}'
      ].join('\n'),
      transparent: true, depthWrite: false, blending
    })
    this.parts = []
    for (let i = 0; i < MAX_PARTS; i++) this.parts.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, grow: 0, r: 1, g: 1, b: 1, a: 1, drag: 0, grav: 0, add: false })
    this.pi = 0
    // 加算（火花）と通常（煙）を分ける
    this.pointsN = new THREE.Points(geo, mkMat(THREE.NormalBlending))
    this.pointsN.frustumCulled = false
    scene.add(this.pointsN)
    const geoA = geo.clone()
    this.aPos = geoA.attributes.position.array; this.aCol = geoA.attributes.color4.array; this.aSize = geoA.attributes.size.array
    this.pointsA = new THREE.Points(geoA, mkMat(THREE.AdditiveBlending))
    this.pointsA.frustumCulled = false
    scene.add(this.pointsA)

    // 吹き飛ぶ物体（壊れた看板やフェンス、外れた部品）
    this.bodies = []
    this.shake = 0
    this._m = new THREE.Matrix4()
    this._c = new THREE.Color()
  }

  addShake(a) { this.shake = Math.min(1.6, this.shake + a) }

  debrisAt(x, y, z, n, color, { speed = 8, up = 6, size = 0.4, dir = null, spread = 1, plank = false } = {}) {
    const c = this._c.set(color)
    for (let k = 0; k < n; k++) {
      const d = this.debris[this.di]
      const idx = this.di
      this.di = (this.di + 1) % MAX_DEBRIS
      d.alive = true; d.rest = false; d.life = 14 + Math.random() * 6
      d.p.set(x + (Math.random() - 0.5) * spread, y + Math.random() * spread, z + (Math.random() - 0.5) * spread)
      const a = Math.random() * Math.PI * 2
      d.v.set(Math.cos(a) * speed * Math.random(), up * (0.4 + Math.random()), Math.sin(a) * speed * Math.random())
      if (dir) d.v.add(new THREE.Vector3(dir.x, 0, dir.z).multiplyScalar(0.55 + Math.random() * 0.4))
      d.q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6))
      d.w.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14)
      const s = size * (0.6 + Math.random() * 0.8)
      if (plank) d.s.set(s * 0.6, s * 0.4, s * 5)
      else d.s.set(s, s * (0.5 + Math.random() * 0.6), s * (0.7 + Math.random() * 0.6))
      const shade = 0.75 + Math.random() * 0.35
      this.debrisMesh.setColorAt(idx, this._c.copy(c).multiplyScalar(shade))
    }
    this.debrisMesh.instanceColor.needsUpdate = true
  }

  // 粒を1つ出す
  emit(x, y, z, o) {
    const p = this.parts[this.pi]
    this.pi = (this.pi + 1) % MAX_PARTS
    p.alive = true
    p.x = x; p.y = y; p.z = z
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0
    p.life = 0; p.max = o.life || 1; p.size = o.size || 1; p.grow = o.grow || 0
    p.r = o.r ?? 1; p.g = o.g ?? 1; p.b = o.b ?? 1; p.a = o.a ?? 1
    p.drag = o.drag ?? 1; p.grav = o.grav ?? 0; p.add = !!o.add
  }

  sparks(x, y, z, n, dir = null, speed = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      this.emit(x, y, z, {
        vx: Math.cos(a) * speed * Math.random() + (dir ? dir.x * 0.3 : 0), vy: 2 + Math.random() * speed * 0.7, vz: Math.sin(a) * speed * Math.random() + (dir ? dir.z * 0.3 : 0),
        life: 0.35 + Math.random() * 0.4, size: 0.35, r: 1, g: 0.75 + Math.random() * 0.2, b: 0.3, a: 1, drag: 1.5, grav: 18, add: true
      })
    }
  }

  smoke(x, y, z, { dark = 0.25, size = 2.2, life = 1.6, vy = 1.6, a = 0.5 } = {}) {
    this.emit(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4, {
      vx: (Math.random() - 0.5) * 0.8, vy, vz: (Math.random() - 0.5) * 0.8,
      life, size, grow: size * 1.2, r: dark, g: dark, b: dark * 1.05, a, drag: 0.6
    })
  }

  dust(x, y, z, n, color = [0.66, 0.58, 0.46], power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      this.emit(x, y + 0.3, z, {
        vx: Math.cos(a) * 6 * power * Math.random(), vy: 1 + Math.random() * 2.5 * power, vz: Math.sin(a) * 6 * power * Math.random(),
        life: 1.2 + Math.random() * 1.2, size: 2.4 * power, grow: 3 * power, r: color[0], g: color[1], b: color[2], a: 0.5, drag: 1.4
      })
    }
  }

  flash(x, y, z) {
    this.emit(x, y, z, { life: 0.18, size: 9, grow: 8, r: 1, g: 0.7, b: 0.35, a: 0.9, add: true })
  }

  // 物体をまるごと吹き飛ばす（mesh はこちらで持つ）
  launch(mesh, { vx = 0, vy = 5, vz = 0, spin = 6, life = 20, pivotFall = null } = {}) {
    if (!mesh.parent) this.scene.add(mesh)
    this.bodies.push({ mesh, vx, vy, vz, wx: (Math.random() - 0.5) * spin, wy: (Math.random() - 0.5) * spin, wz: (Math.random() - 0.5) * spin, life, rest: false, pivotFall, t: 0 })
  }

  update(dt) {
    const W = this.world
    // 破片
    let any = false
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const d = this.debris[i]
      if (!d.alive) continue
      any = true
      d.life -= dt
      if (d.life <= 0) { d.alive = false; this.debrisMesh.setMatrixAt(i, this._m.makeScale(0, 0, 0)); continue }
      if (!d.rest) {
        d.v.y -= 22 * dt
        d.p.addScaledVector(d.v, dt)
        const g = W.groundAt(d.p.x, d.p.z, d.p.y).h + d.s.y * 0.5
        if (d.p.y < g) {
          d.p.y = g
          if (Math.abs(d.v.y) < 2.5 && Math.hypot(d.v.x, d.v.z) < 1.5) d.rest = true
          d.v.y = -d.v.y * 0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.6)
        }
        const wl = d.w.length()
        if (wl > 0.01) d.q.multiply(new THREE.Quaternion().setFromAxisAngle(this._tmpAxis(d.w, wl), wl * dt))
      }
      const s = d.life < 2 ? d.life / 2 : 1
      this._m.compose(d.p, d.q, this._tmpScale(d.s, s))
      this.debrisMesh.setMatrixAt(i, this._m)
    }
    if (any) this.debrisMesh.instanceMatrix.needsUpdate = true

    // 吹き飛ぶ物体
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i]
      b.life -= dt; b.t += dt
      const m = b.mesh
      if (b.pivotFall) {
        // 根元を軸に倒れる（街灯・鉄塔）
        const pf = b.pivotFall
        const k = Math.min(1, b.t / pf.dur)
        pf.angle = pf.target * k * k
        m.quaternion.setFromAxisAngle(pf.axis, pf.angle).premultiply(pf.base)
        const off = pf.offset.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(pf.axis, pf.angle))
        m.position.copy(pf.pivot).sub(off)
        if (k >= 1 && !pf.done) { pf.done = true; if (pf.onDone) pf.onDone() }
        continue
      }
      if (!b.rest) {
        b.vy -= 22 * dt
        m.position.x += b.vx * dt; m.position.y += b.vy * dt; m.position.z += b.vz * dt
        m.rotation.x += b.wx * dt; m.rotation.y += b.wy * dt; m.rotation.z += b.wz * dt
        const g = W.groundAt(m.position.x, m.position.z, m.position.y + 1).h + 0.15
        if (m.position.y < g) {
          m.position.y = g
          b.vy = -b.vy * 0.25; b.vx *= 0.55; b.vz *= 0.55; b.wx *= 0.5; b.wy *= 0.5; b.wz *= 0.5
          if (Math.abs(b.vy) < 1.5 && Math.hypot(b.vx, b.vz) < 1) {
            b.rest = true
            // 寝かせる
            m.rotation.x = Math.round(m.rotation.x / (Math.PI / 2)) * (Math.PI / 2)
            m.rotation.z = Math.round(m.rotation.z / (Math.PI / 2)) * (Math.PI / 2)
          }
        }
      }
      if (b.life <= 0) {
        // 落ち着いた物は残す。道の真ん中に転がって視界をふさぐものは沈めて消す
        m.position.y -= dt * 0.5
        if (b.life < -3) { m.parent && m.parent.remove(m); this.bodies.splice(i, 1) }
      }
    }

    // 粒
    let nN = 0, nA = 0
    for (let i = 0; i < MAX_PARTS; i++) {
      const p = this.parts[i]
      if (!p.alive) continue
      p.life += dt
      if (p.life >= p.max) { p.alive = false; continue }
      const k = Math.exp(-p.drag * dt)
      p.vx *= k; p.vz *= k; p.vy = p.vy * k - p.grav * dt
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt
      const t = p.life / p.max
      const alpha = p.a * (1 - t) * Math.min(1, p.life * 12)
      const size = p.size + p.grow * t
      if (p.add) { this._put(this.aPos, this.aCol, this.aSize, nA++, p, alpha, size) }
      else { this._put(this.pPos, this.pCol, this.pSize, nN++, p, alpha, size) }
    }
    this.pointsN.geometry.setDrawRange(0, nN)
    this.pointsA.geometry.setDrawRange(0, nA)
    for (const pts of [this.pointsN, this.pointsA]) {
      const g = pts.geometry
      g.attributes.position.needsUpdate = true; g.attributes.color4.needsUpdate = true; g.attributes.size.needsUpdate = true
    }
    this.shake = Math.max(0, this.shake - dt * 2.4)
  }

  setScale(h) { for (const p of [this.pointsN, this.pointsA]) p.material.uniforms.scale.value = h * 0.9 }

  _put(pos, col, size, i, p, a, s) {
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z
    col[i * 4] = p.r; col[i * 4 + 1] = p.g; col[i * 4 + 2] = p.b; col[i * 4 + 3] = a
    size[i] = s
  }
  _tmpAxis(w, l) { return (this.__ax || (this.__ax = new THREE.Vector3())).copy(w).divideScalar(l) }
  _tmpScale(s, k) { return (this.__sc || (this.__sc = new THREE.Vector3())).copy(s).multiplyScalar(k) }
}

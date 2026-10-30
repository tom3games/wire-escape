// ワイヤーの人の見た目。手続きのローポリ人形を、関節を回して動かす（ボーンは使わない）。
// 車の見た目（CarModel）と同じ口（group / update / updateParts / applyDents / resetParts / dispose）にして main.js から同じように扱う。
// 原点は足元。+z が前
import * as THREE from 'three'

const SKIN = 0xd9a47e
const HOOD = 0x23262d   // 黒に近い紺のパーカー
const PANTS = 0x30343c
const ACCENT = 0xff7a1a // 橙の差し色（ワイヤーの射出機とライン）
const METAL = 0xb9c2cc

function mat(color, opt = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...opt }) }

// 関節（回す点）の下に部品をぶら下げる
function limb(len, r0, r1, m) {
  const pivot = new THREE.Group()
  const g = new THREE.CylinderGeometry(r1, r0, len, 7)
  g.translate(0, -len / 2, 0)
  const mesh = new THREE.Mesh(g, m)
  mesh.castShadow = true
  pivot.add(mesh)
  return pivot
}

export class RunnerModel {
  constructor({ police = false } = {}) {
    const color = police ? 0x1d2f5c : HOOD
    this.group = new THREE.Group()
    this.paintColor = null
    const mHood = mat(color), mPants = mat(PANTS), mSkin = mat(SKIN, { roughness: 0.6 })
    const mAcc = mat(ACCENT, { emissive: ACCENT, emissiveIntensity: 0.35 }), mMetal = mat(METAL, { metalness: 0.7, roughness: 0.35 })
    this.mats = [mHood, mPants, mSkin, mAcc, mMetal]

    // 体の向き（傾き）をつける枠。腰の高さを回転の中心にする
    const body = this.body = new THREE.Group()
    body.position.y = 0.95
    this.group.add(body)
    const hips = this.hips = new THREE.Group()
    body.add(hips)

    // 胴
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.52, 0.24).translate(0, 0.3, 0), mHood)
    torso.castShadow = true
    hips.add(torso)
    // 胸の橙のライン（ワイヤーの帯）と腰の装置
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.26).translate(0, 0.38, 0), mAcc)
    hips.add(strap)
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.08, 0.28).translate(0, 0.05, 0), mMetal)
    hips.add(belt)
    for (const s of [-1, 1]) {
      const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10).rotateZ(Math.PI / 2).translate(s * 0.26, 0.05, 0), mMetal)
      hips.add(reel)
    }
    // 頭（フード付き）
    const neck = this.neck = new THREE.Group()
    neck.position.y = 0.58
    hips.add(neck)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10).translate(0, 0.14, 0.01), mSkin)
    head.castShadow = true
    neck.add(head)
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62).rotateX(-0.35).translate(0, 0.15, -0.02), mHood)
    neck.add(hood)
    if (police) {
      // 警官: フードの代わりに制帽、胸に反射ベスト
      hood.visible = false
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.14, 0.09, 12).translate(0, 0.27, 0), mat(0x14203d))
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.1).translate(0, 0.23, 0.13), mat(0x0e1528))
      const badge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02).translate(0, 0.29, 0.15), mat(0xf2c230, { metalness: 0.6 }))
      neck.add(cap, brim, badge)
      strap.material = mat(0xd8ff3a, { emissive: 0xb8e02a, emissiveIntensity: 0.4 })
    } else {
      // 目元の覆面（顔を隠す）
      const mask = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05).translate(0, 0.16, 0.12), mat(0x111214))
      neck.add(mask)
    }

    // 腕
    const arm = (s) => {
      const sh = limb(0.3, 0.06, 0.055, mHood)
      sh.position.set(s * 0.25, 0.52, 0)
      const el = limb(0.28, 0.05, 0.045, mHood)
      el.position.y = -0.3
      sh.add(el)
      // 手首の射出機
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.09).translate(0, -0.22, 0.02), mAcc)
      el.add(gun)
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6).translate(0, -0.32, 0), mSkin)
      el.add(hand)
      const tip = new THREE.Object3D(); tip.position.set(0, -0.34, 0); el.add(tip)
      hips.add(sh)
      return { sh, el, tip }
    }
    this.armL = arm(1); this.armR = arm(-1)
    // 脚
    const leg = (s) => {
      const hp = limb(0.44, 0.085, 0.07, mPants)
      hp.position.set(s * 0.11, 0, 0)
      const kn = limb(0.44, 0.065, 0.05, mPants)
      kn.position.y = -0.44
      hp.add(kn)
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.24).translate(0, -0.47, 0.05), mat(0xe8e8e8))
      shoe.castShadow = true
      kn.add(shoe)
      body.add(hp)
      return { hp, kn }
    }
    this.legL = leg(1); this.legR = leg(-1)

    this.phase = 0
    this.handWorld = new THREE.Vector3()
    this._v = new THREE.Vector3()
    this.state = 'idle'
  }

  // s: 補間済みの状態（x y z yaw と runner の中身）。opts は使わない（車と同じ呼び方のため）
  update(s, dt) {
    const g = this.group
    g.position.set(s.x, s.y, s.z)
    const v = Math.hypot(s.vx, s.vz)
    const b = this.body
    let pitch = 0, roll = 0
    const L = this.legL, R = this.legR, AL = this.armL, AR = this.armR
    const set = (o, x = 0, y = 0, z = 0) => o.rotation.set(x, y, z)
    const k = 1 - Math.exp(-dt * 14)
    const ease = (o, x, z = 0) => { o.rotation.x += (x - o.rotation.x) * k; o.rotation.z += (z - o.rotation.z) * k }

    if (s.wreck > 0) {
      // 倒れている: あお向けに寝る
      this.state = 'down'
      g.rotation.set(0, s.yaw, 0)
      b.position.y = 0.18
      pitch = -Math.PI / 2
      ease(L.hp, 0.2); ease(R.hp, -0.1); ease(L.kn, 0.4); ease(R.kn, 0.2)
      ease(AL.sh, -0.6, 0.9); ease(AR.sh, -0.3, -1.1); ease(AL.el, -0.3); ease(AR.el, -0.2)
    } else if (s.climbing) {
      this.state = 'climb'
      this.phase += dt * 9
      const c = Math.sin(this.phase)
      g.rotation.set(0, Math.atan2(-s.climbing.nx, -s.climbing.nz), 0)
      b.position.y = 0.95
      pitch = 0.12
      ease(AL.sh, -2.6 + c * 0.5); ease(AR.sh, -2.6 - c * 0.5); ease(AL.el, -0.5); ease(AR.el, -0.5)
      ease(L.hp, -0.9 - c * 0.5); ease(R.hp, -0.9 + c * 0.5); ease(L.kn, 1.2); ease(R.kn, 1.2)
    } else if (s.rope) {
      // ワイヤーにぶら下がる: 体をワイヤーの向きにそろえ、ワイヤー側の腕を伸ばす
      this.state = s.zipping ? 'zip' : 'swing'
      const dx = s.rope.x - s.x, dy = s.rope.y - (s.y + 1.2), dz = s.rope.z - s.z
      const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw)
      const lx = dx * cy - dz * sy, lz = dx * sy + dz * cy // 体の左右・前後
      g.rotation.set(0, s.yaw, 0)
      b.position.y = 0.95
      pitch = Math.atan2(lz, Math.max(0.5, dy)) * 0.9
      roll = -Math.atan2(lx, Math.max(0.5, dy)) * 0.9
      const side = lx >= 0 ? AL : AR, other = lx >= 0 ? AR : AL
      ease(side.sh, -Math.PI + 0.15, 0); ease(side.el, 0)
      ease(other.sh, s.zipping ? -2.6 : -0.9, lx >= 0 ? -0.6 : 0.6); ease(other.el, -0.6)
      const sw = Math.sin(this.phase += dt * 3) * 0.2
      ease(L.hp, s.zipping ? 0.3 : -0.5 + sw); ease(R.hp, s.zipping ? 0.1 : -0.2 - sw); ease(L.kn, s.zipping ? 0.3 : 0.9); ease(R.kn, s.zipping ? 0.2 : 0.5)
    } else if (!s.grounded) {
      // 空中: 脚をたたみ腕を広げる。上りと下りで少し変える
      this.state = 'air'
      g.rotation.set(0, s.yaw, 0)
      b.position.y = 0.95
      const up = s.vy > 0
      pitch = up ? 0.15 : 0.35
      if (s.stun > 0) { this.phase += dt * 14; roll = Math.sin(this.phase) * 0.8; pitch = Math.cos(this.phase * 0.7) * 0.9 }
      ease(AL.sh, -1.2, 1.1); ease(AR.sh, -1.2, -1.1); ease(AL.el, -0.4); ease(AR.el, -0.4)
      ease(L.hp, up ? -1.1 : -0.4); ease(R.hp, up ? -0.3 : 0.2); ease(L.kn, up ? 1.6 : 0.6); ease(R.kn, up ? 0.9 : 0.3)
    } else if (s.sneaking) {
      // しゃがみ歩き（隠密）: 腰を落として前かがみ、ゆっくり足を出す
      this.state = 'sneak'
      g.rotation.set(0, s.yaw, 0)
      this.phase += dt * (v > 0.3 ? 5 : 0)
      const c = Math.sin(this.phase), a = v > 0.3 ? 1 : 0
      b.position.y = 0.68
      pitch = 0.55
      ease(L.hp, -1.1 - c * 0.35 * a); ease(R.hp, -1.1 + c * 0.35 * a); ease(L.kn, 1.6); ease(R.kn, 1.6)
      ease(AL.sh, -0.7, 0.2); ease(AR.sh, -0.7, -0.2); ease(AL.el, -1.2); ease(AR.el, -1.2)
    } else if (v > 0.6) {
      // 走る: 速さで足の回転と前傾を変える
      this.state = 'run'
      g.rotation.set(0, s.yaw, 0)
      this.phase += dt * (4 + v * 0.95)
      const c = Math.sin(this.phase), a = Math.min(1, v / 10)
      b.position.y = 0.92 + Math.abs(Math.cos(this.phase)) * 0.06 * a
      pitch = 0.08 + a * 0.22
      set(L.hp, -c * 0.9 * a); set(R.hp, c * 0.9 * a)
      set(L.kn, Math.max(0, c) * 1.3 * a + 0.1); set(R.kn, Math.max(0, -c) * 1.3 * a + 0.1)
      set(AL.sh, c * 0.8 * a, 0, 0.12); set(AR.sh, -c * 0.8 * a, 0, -0.12)
      set(AL.el, -0.9 * a - 0.2); set(AR.el, -0.9 * a - 0.2)
    } else {
      this.state = 'idle'
      g.rotation.set(0, s.yaw, 0)
      this.phase += dt * 2
      b.position.y = 0.95 + Math.sin(this.phase) * 0.01
      ease(L.hp, 0); ease(R.hp, 0); ease(L.kn, 0.05); ease(R.kn, 0.05)
      ease(AL.sh, 0.05, 0.15); ease(AR.sh, 0.05, -0.15); ease(AL.el, -0.25); ease(AR.el, -0.25)
    }
    b.rotation.x += (pitch - b.rotation.x) * (1 - Math.exp(-dt * 10))
    b.rotation.z += (roll - b.rotation.z) * (1 - Math.exp(-dt * 10))
    // ワイヤーを出す手の位置（画面側がワイヤーを描くのに使う）
    if (s.rope) {
      const dx = s.rope.x - s.x, dz = s.rope.z - s.z
      const lx = dx * Math.cos(s.yaw) - dz * Math.sin(s.yaw)
      g.updateMatrixWorld(true)
      ;(lx >= 0 ? this.armL : this.armR).tip.getWorldPosition(this.handWorld)
    }
  }

  updateParts() { return [] }
  applyDents() {}
  resetParts() {}
  dispose() {
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose() })
    for (const m of this.mats) m.dispose()
  }
}

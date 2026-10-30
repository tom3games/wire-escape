// キーボードとゲームパッド。空中の前後傾きは「離陸してから押したキー」だけを効かせる
// （アクセルを踏んだまま飛び出しても、勝手に鼻先が下がらないように）。
const KEYS = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  drift: ['Space'], boost: ['ShiftLeft', 'ShiftRight', 'KeyQ'], jump: ['Space'], wire: ['KeyE', 'KeyK', 'KeyL'], sneak: ['KeyX', 'ControlLeft', 'KeyZ'], respawn: ['KeyR'], pause: ['Escape', 'KeyP'], cam: ['KeyC'], mute: ['KeyM']
}

export class Input {
  constructor() {
    this.down = new Set()
    this.pressed = new Set()   // このフレームで押された
    this.airFresh = new Set()  // 離陸後に押し直されたキー
    this.wasAir = false
    this.onKey = null
    addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
      if (!this.down.has(e.code)) { this.pressed.add(e.code); this.airFresh.add(e.code) }
      this.down.add(e.code)
      if (this.onKey) this.onKey(e.code)
    })
    addEventListener('keyup', e => { this.down.delete(e.code); this.airFresh.delete(e.code) })
    addEventListener('blur', () => { this.down.clear(); this.airFresh.clear() })
    this.padPrev = {}
    this.touch = null // Touch（スマホ）
    // マウスの左ボタン（ゲーム画面の上）でもワイヤー
    this.mouse = false
    const view = document.getElementById('view')
    if (view) {
      view.addEventListener('mousedown', e => { if (e.button === 0) { this.mouse = true; this.mouseHit = true } })
      addEventListener('mouseup', e => { if (e.button === 0) this.mouse = false })
    }
  }

  any(name) { return KEYS[name].some(k => this.down.has(k)) }
  hit(name) { return KEYS[name].some(k => this.pressed.has(k)) }
  fresh(name) { return KEYS[name].some(k => this.airFresh.has(k) && this.down.has(k)) }

  // 車への入力を作る。airborne は自車が空中か
  read(airborne) {
    if (airborne && !this.wasAir) this.airFresh.clear() // 離陸の瞬間に押していたキーは数えない
    this.wasAir = airborne
    const inp = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, pitch: 0, roll: 0, respawn: false }
    if (this.any('up')) inp.throttle = 1
    if (this.any('down')) inp.brake = 1
    let ks = 0
    const TS = this.touch && this.touch.active ? this.touch.state : null
    if (this.any('left') || (TS && TS.left)) ks -= 1
    if (this.any('right') || (TS && TS.right)) ks += 1
    // キーは一気に全開にせず、0.15秒ほどかけて切る（戻すときは速く）
    const now = performance.now(), dt = Math.min(0.05, (now - (this.lastT || now)) / 1000); this.lastT = now
    const rate = ks === 0 || Math.sign(ks) !== Math.sign(this.ks || 0) ? 12 : 6.5
    this.ks = (this.ks || 0) + Math.max(-rate * dt, Math.min(rate * dt, ks - (this.ks || 0)))
    inp.steer = Math.abs(this.ks) < 0.02 ? 0 : this.ks
    inp.handbrake = this.any('drift')
    inp.boost = this.any('boost') || this.hit('boost')
    inp.respawn = this.hit('respawn')
    // ワイヤーの人: ジャンプとワイヤー。押して離すまでが1コマより短くても拾う（このコマで押されたものも数える）
    inp.jump = this.any('jump') || this.hit('jump')
    inp.wire = this.any('wire') || this.hit('wire') || this.mouse || this.mouseHit
    inp.sneak = this.any('sneak') || this.hit('sneak')
    if (airborne) {
      // W で鼻先を下げ、S で上げる。A/D で傾ける
      inp.pitch = (this.fresh('down') ? 1 : 0) - (this.fresh('up') ? 1 : 0)
      inp.roll = inp.steer
    }
    // タッチ
    const T = this.touch && this.touch.active ? this.touch.state : null
    if (T) {
      inp.throttle = Math.max(inp.throttle, T.throttle)
      inp.brake = Math.max(inp.brake, T.brake)
      if (T.brake) inp.throttle = 0 // ブレーキ中はアクセルのスイッチより優先
      if (T.drift) inp.handbrake = true
      if (T.boost) inp.boost = true
      const tap = k => this.touch.consume ? this.touch.consume(k) : false
      if (T.jump || tap('jump')) inp.jump = true
      if (T.wire || tap('wire')) inp.wire = true
      if (T.sneak || tap('sneak')) inp.sneak = true
      if (tap('boost')) inp.boost = true
      if (airborne) inp.roll = inp.steer
    }
    // NITRO はアクセル込み（スマホで2つ同時に押さなくていい）
    if (inp.boost) { inp.throttle = 1; inp.brake = 0 }
    // ゲームパッド（標準配置）
    const pads = navigator.getGamepads ? navigator.getGamepads() : []
    for (const p of pads) {
      if (!p || !p.connected) continue
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0
      const dz = v => Math.abs(v) < 0.15 ? 0 : v
      const rt = p.buttons[7]?.value || 0, lt = p.buttons[6]?.value || 0
      if (rt > 0.05) inp.throttle = Math.max(inp.throttle, rt)
      if (lt > 0.05) inp.brake = Math.max(inp.brake, lt)
      if (dz(ax)) inp.steer = dz(ax)
      if (p.buttons[2]?.pressed || p.buttons[5]?.pressed) inp.wire = true
      if (p.buttons[0]?.pressed) inp.jump = true
      if (p.buttons[1]?.pressed || p.buttons[4]?.pressed) inp.boost = true
      const y = !!p.buttons[3]?.pressed
      if (y && !this.padPrev.y) inp.respawn = true
      this.padPrev.y = y
      if (airborne) { if (dz(ay)) inp.pitch = dz(ay); if (dz(ax)) inp.roll = dz(ax) }
      const start = !!p.buttons[9]?.pressed
      if (start && !this.padPrev.start && this.onKey) this.onKey('Escape')
      this.padPrev.start = start
      break
    }
    return inp
  }

  endFrame() { this.pressed.clear(); this.mouseHit = false }
}

// スマホのタッチ操作。左手: 左右のボタンで向きを変える
// 右手: ワイヤー（大）・ジャンプ・巻き取り・走る（スイッチ式）・下がる。上: ポーズ・カメラ・リスポーン
// 複数の指を同時に使えるよう、ボタンごとに pointerId を覚えておく。
export class Touch {
  constructor(root, { onPause, onCam, onRespawn }) {
    this.root = root
    this.state = { left: false, right: false, throttle: 0, brake: 0, boost: false, drift: false, jump: false, wire: false, sneak: false }
    this.active = false
    this.taps = new Set() // 押された印（すぐ離しても1回は拾う）
    const hold = (el, key, on = 1) => {
      const ids = new Set()
      const down = e => { e.preventDefault(); ids.add(e.pointerId); try { el.setPointerCapture(e.pointerId) } catch {}; this.state[key] = on; this.taps.add(key); el.classList.add('on') }
      const up = e => { ids.delete(e.pointerId); if (!ids.size) { this.state[key] = typeof on === 'boolean' ? false : 0; el.classList.remove('on') } }
      el.addEventListener('pointerdown', down)
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up)
    }
    const q = s => root.querySelector(s)
    // アクセルはスイッチ式: 1回押すと入りっぱなし、もう1回で切れる
    const gas = q('[data-k=gas]')
    gas.addEventListener('pointerdown', e => { e.preventDefault(); this.setGas(!this.gasOn) })
    hold(q('[data-k=brake]'), 'brake')
    hold(q('[data-k=boost]'), 'boost', true)
    hold(q('[data-k=jump]'), 'jump', true)
    hold(q('[data-k=wire]'), 'wire', true)
    hold(q('[data-k=sneak]'), 'sneak', true)
    const tap = (sel, fn) => q(sel).addEventListener('pointerdown', e => { e.preventDefault(); fn() })
    tap('[data-k=pause]', onPause); tap('[data-k=cam]', onCam); tap('[data-k=respawn]', onRespawn)

    // 左右のボタン（押している間だけ切る。切れ方は input.js でなめらかにする）
    hold(q('[data-k=left]'), 'left', true)
    hold(q('[data-k=right]'), 'right', true)
    // 長押しメニュー・選択・拡大を出さない
    root.addEventListener('contextmenu', e => e.preventDefault())
  }

  // ワイヤーを掛けられる点があるときは、ワイヤーのボタンを光らせる
  setAim(ok) { const b = this.root.querySelector('[data-k=wire]'); if (b && b._aim !== ok) { b._aim = ok; b.classList.toggle('aim', ok) } }
  // 巻き取り: ワイヤー中で使えるときだけ光る
  setReel(state) { const b = this.root.querySelector('[data-k=boost]'); if (b && b._st !== state) { b._st = state; b.classList.toggle('ready', state === 'ready'); b.classList.toggle('cool', state === 'cool') } }

  consume(key) { const had = this.taps.has(key); this.taps.delete(key); return had }

  setGas(on) {
    this.gasOn = on
    this.state.throttle = on ? 1 : 0
    this.root.querySelector('[data-k=gas]').classList.toggle('on', on)
  }

  show(on) {
    const was = this.active
    this.active = on
    this.root.classList.toggle('hidden', !on)
    if (!on) for (const k of Object.keys(this.state)) if (k !== 'throttle') this.state[k] = typeof this.state[k] === 'boolean' ? false : 0
    if (on && !was) this.setGas(this.gasOn ?? true) // レースに出たらアクセルは入った状態から
  }
}

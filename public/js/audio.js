// 音はすべてその場で合成する（音声ファイルなし）。最初のクリックで有効になる。
export class Audio {
  constructor() {
    this.ctx = null
    this.muted = false
    try { this.muted = localStorage.getItem('we-mute') === '1' } catch {}
    this.bgmOn = true
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return }
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    const ctx = this.ctx = new AC()
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.8
    const comp = ctx.createDynamicsCompressor()
    this.master.connect(comp).connect(ctx.destination)
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master)
    this.music = ctx.createGain(); this.music.gain.value = 0.22; this.music.connect(this.master)
    // 雑音の元
    const len = ctx.sampleRate * 2
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1

    // エンジン: のこぎり波2本＋矩形波をローパス
    this.eng = ctx.createGain(); this.eng.gain.value = 0
    this.engF = ctx.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 600; this.engF.Q.value = 3
    this.engF.connect(this.eng).connect(this.sfx)
    this.osc = []
    for (const [type, mul, g] of [['sawtooth', 1, 0.5], ['sawtooth', 1.007, 0.35], ['square', 0.5, 0.25]]) {
      const o = ctx.createOscillator(); o.type = type
      const og = ctx.createGain(); og.gain.value = g
      o.connect(og).connect(this.engF); o.start()
      this.osc.push({ o, mul })
    }
    // タイヤの鳴き
    this.screech = this._loopNoise('bandpass', 1700, 6)
    // ブーストの噴射音
    this.jet = this._loopNoise('bandpass', 900, 0.8)
    // 風切り
    this.wind = this._loopNoise('lowpass', 500, 0.5)
    this.beatT = 0
    this.step16 = 0
  }

  _loopNoise(type, freq, q) {
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q
    const g = this.ctx.createGain(); g.gain.value = 0
    src.connect(f).connect(g).connect(this.sfx); src.start()
    return { g, f }
  }

  setMuted(m) {
    this.muted = m
    try { localStorage.setItem('we-mute', m ? '1' : '0') } catch {}
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05)
  }

  // 毎フレーム: 車の状態から連続音を動かす
  drive({ speed = 0, top = 46, throttle = 0, slip = 0, boosting = false, grounded = true, engineHealth = 1, active = true }) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const r = Math.min(1.4, speed / top)
    // 疑似ギア: 速度帯ごとに回転数が上がって落ちる
    const gears = [0, 0.18, 0.36, 0.56, 0.78, 1.0, 1.5]
    let gi = 0; while (gi < gears.length - 2 && r > gears[gi + 1]) gi++
    const within = (r - gears[gi]) / (gears[gi + 1] - gears[gi])
    const rpm = 0.35 + within * 0.65
    const base = 48 + rpm * 120 + gi * 8 + (boosting ? 40 : 0)
    // 壊れたエンジンはがたつく
    const rough = (1 - engineHealth) * (Math.random() * 18)
    for (const { o, mul } of this.osc) o.frequency.setTargetAtTime((base + rough) * mul, t, 0.03)
    this.engF.frequency.setTargetAtTime(400 + throttle * 1400 + rpm * 600, t, 0.05)
    this.eng.gain.setTargetAtTime(active ? 0.1 + throttle * 0.12 + Math.min(0.08, r * 0.07) + (boosting ? 0.05 : 0) : 0, t, 0.08)
    this.screech.g.gain.setTargetAtTime(active && grounded && slip > 4 ? Math.min(0.22, (slip - 4) * 0.02) : 0, t, 0.06)
    this.jet.g.gain.setTargetAtTime(active && boosting ? 0.32 : 0, t, 0.05)
    this.jet.f.frequency.setTargetAtTime(700 + r * 600, t, 0.1)
    this.wind.g.gain.setTargetAtTime(active ? Math.min(0.25, r * r * 0.22) + (grounded ? 0 : 0.08) : 0, t, 0.2)
  }

  // ワイヤーの人: エンジンは鳴らさず、速さと高さで風切りだけ
  body({ speed = 0, air = false, active = true }) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.drive({ active: false })
    const r = Math.min(1, speed / 34)
    this.wind.g.gain.setTargetAtTime(active ? r * r * 0.34 + (air ? 0.04 : 0) : 0, t, 0.15)
    this.wind.f.frequency.setTargetAtTime(350 + r * 900, t, 0.15)
  }
  // ワイヤーを撃つ（ヒュッ＋ガチッ）
  whip() { this._burst({ freq: 3200, type: 'bandpass', q: 2, dur: 0.12, gain: 0.3, decay: 0.11 }); this._tone({ freq: 1400, to: 420, dur: 0.1, gain: 0.08, type: 'triangle' }); this._tone({ freq: 240, to: 160, dur: 0.06, gain: 0.18, type: 'square', when: 0.08 }) }
  zip() { this._tone({ freq: 300, to: 1200, dur: 0.4, gain: 0.1, type: 'sawtooth' }); this._burst({ freq: 1800, type: 'bandpass', q: 1, dur: 0.45, gain: 0.25, decay: 0.4 }) }
  miss() { this._tone({ freq: 220, to: 140, dur: 0.12, gain: 0.12, type: 'square' }) }
  netPop() { this._burst({ freq: 700, type: 'bandpass', q: 1.2, dur: 0.18, gain: 0.35, decay: 0.16 }); this._tone({ freq: 160, to: 90, dur: 0.12, gain: 0.25 }) }
  netWrap() { for (let i = 0; i < 4; i++) this._tone({ freq: 500 - i * 60, to: 300 - i * 40, dur: 0.07, gain: 0.08, type: 'triangle', when: i * 0.05 }) }
  rumble() { this._tone({ freq: 70, to: 35, dur: 0.6, gain: 0.5 }); this._burst({ freq: 300, dur: 0.6, gain: 0.35, decay: 0.55 }) }
  warn() { for (let i = 0; i < 2; i++) this._tone({ freq: 980, to: 980, dur: 0.08, gain: 0.07, type: 'square', when: i * 0.14 }) }
  tick() { this._tone({ freq: 1200, to: 900, dur: 0.04, gain: 0.05, type: 'square' }) }
  splash() { this._burst({ freq: 1200, dur: 0.6, gain: 0.5, decay: 0.55 }) }
  // 通行人の叫び（高い声の上がり下がり）
  scream(v = 1) { this._tone({ freq: 900, to: 1500, dur: 0.18, gain: 0.08 * v, type: 'sawtooth' }); this._tone({ freq: 1500, to: 700, dur: 0.45, gain: 0.07 * v, type: 'sawtooth', when: 0.17 }) }
  stomp() { this._tone({ freq: 120, to: 40, dur: 0.35, gain: 0.8 }); this.crash(1.3) }

  // 一発音
  _burst({ freq = 800, type = 'lowpass', q = 1, dur = 0.3, gain = 0.6, decay = 0.25 }) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf
    src.playbackRate.value = 0.8 + Math.random() * 0.4
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + decay)
    src.connect(f).connect(g).connect(this.sfx)
    src.start(t, Math.random() * 1.5, dur)
  }
  _tone({ freq = 80, to = 40, dur = 0.3, gain = 0.6, type = 'sine', when = 0 }) {
    if (!this.ctx) return
    const t = this.ctx.currentTime + when
    const o = this.ctx.createOscillator(); o.type = type
    o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur)
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + dur + 0.05)
  }

  crash(power = 1) {
    const p = Math.min(1.5, power)
    this._burst({ freq: 1200, dur: 0.5, gain: 0.5 * p, decay: 0.45 })
    this._burst({ freq: 3500, type: 'highpass', dur: 0.25, gain: 0.25 * p, decay: 0.2 })
    this._tone({ freq: 120, to: 35, dur: 0.35, gain: 0.7 * p })
    // 金属の鳴り
    for (const f of [430, 610, 890]) this._tone({ freq: f * (0.9 + Math.random() * 0.2), to: f * 0.8, dur: 0.4, gain: 0.05 * p, type: 'triangle' })
  }
  // ガラスが割れる: 高い音の粒をばらばらに
  glass(power = 1) {
    for (let i = 0; i < 7; i++) setTimeout(() => {
      this._burst({ freq: 4500 + Math.random() * 3500, type: 'bandpass', q: 6, dur: 0.06, gain: 0.22 * power, decay: 0.06 })
      this._tone({ freq: 2400 + Math.random() * 2600, to: 1800, dur: 0.12, gain: 0.03 * power, type: 'triangle' })
    }, i * 18 + Math.random() * 20)
  }
  scrape() { this._burst({ freq: 2600, type: 'bandpass', q: 3, dur: 0.15, gain: 0.12, decay: 0.12 }) }
  wood(power = 1) {
    for (let i = 0; i < 3; i++) setTimeout(() => this._burst({ freq: 1800 + Math.random() * 1500, type: 'bandpass', q: 2, dur: 0.08, gain: 0.35 * power, decay: 0.08 }), i * 35)
    this._tone({ freq: 220, to: 90, dur: 0.15, gain: 0.25 * power, type: 'triangle' })
  }
  metal(power = 1) {
    for (const f of [520, 780, 1230]) this._tone({ freq: f, to: f * 0.93, dur: 0.6, gain: 0.09 * power, type: 'triangle' })
    this._burst({ freq: 2000, type: 'bandpass', q: 1.5, dur: 0.2, gain: 0.25 * power, decay: 0.2 })
  }
  rubble(power = 1) {
    this._burst({ freq: 400, dur: 1.2, gain: 0.7 * power, decay: 1.1 })
    this._tone({ freq: 70, to: 28, dur: 0.8, gain: 0.8 * power })
    for (let i = 0; i < 6; i++) setTimeout(() => this._burst({ freq: 900, dur: 0.1, gain: 0.2, decay: 0.1 }), 80 + i * 70)
  }
  land(power = 1) { this._tone({ freq: 90, to: 40, dur: 0.25, gain: Math.min(0.9, 0.3 + power * 0.04) }); this._burst({ freq: 500, dur: 0.2, gain: 0.25, decay: 0.2 }) }
  boostStart() { this._burst({ freq: 600, type: 'bandpass', q: 0.7, dur: 0.5, gain: 0.4, decay: 0.45 }); this._tone({ freq: 180, to: 520, dur: 0.35, gain: 0.12, type: 'sawtooth' }) }
  // サイレン（ピーポー: 770Hz と 960Hz を 0.65 秒ずつ）。vol 0..1
  siren(vol) {
    if (!this.ctx) return
    const ctx = this.ctx, t = ctx.currentTime
    if (!this.sir) {
      if (vol <= 0) return
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 865
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 0.77
      const lg = ctx.createGain(); lg.gain.value = 95
      lfo.connect(lg).connect(o.frequency)
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8
      const g = ctx.createGain(); g.gain.value = 0
      o.connect(f).connect(g).connect(this.sfx); o.start(); lfo.start()
      this.sir = { g }
    }
    this.sir.g.gain.setTargetAtTime(Math.max(0, Math.min(1, vol)) * 0.11, t, 0.2)
  }
  // ヘリのローター（低いバタバタ）。vol 0..1
  rotor(vol) {
    if (!this.ctx) return
    const ctx = this.ctx, t = ctx.currentTime
    if (!this.rot) {
      if (vol <= 0) return
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180
      const am = ctx.createGain(); am.gain.value = 0.5
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 11
      const lg = ctx.createGain(); lg.gain.value = 0.5
      lfo.connect(lg).connect(am.gain)
      const g = ctx.createGain(); g.gain.value = 0
      src.connect(f).connect(am).connect(g).connect(this.sfx); src.start(); lfo.start()
      this.rot = { g }
    }
    this.rot.g.gain.setTargetAtTime(Math.max(0, Math.min(1, vol)) * 0.5, t, 0.3)
  }
  // ロックオンの警告音（ピピッ）
  lockon() { for (let i = 0; i < 3; i++) this._tone({ freq: 1800, to: 1800, dur: 0.05, gain: 0.08, type: 'square', when: i * 0.09 }) }
  // 拳銃の発砲音（乾いた破裂音）
  gunshot(power = 1) {
    this._burst({ freq: 2400, type: 'highpass', dur: 0.09, gain: 0.5 * power, decay: 0.08 })
    this._burst({ freq: 900, dur: 0.18, gain: 0.35 * power, decay: 0.16 })
    this._tone({ freq: 160, to: 60, dur: 0.1, gain: 0.35 * power })
  }
  // パンク（破裂音と空気が抜ける音）
  puncture() {
    this._burst({ freq: 1800, type: 'highpass', dur: 0.12, gain: 0.6, decay: 0.1 })
    this._burst({ freq: 3000, type: 'bandpass', q: 0.6, dur: 0.9, gain: 0.25, decay: 0.85 })
    this._tone({ freq: 140, to: 50, dur: 0.18, gain: 0.5 })
  }
  // 自分の車に弾が当たった（金属に跳ねる音）
  ricochet() {
    this._tone({ freq: 3200, to: 1400, dur: 0.16, gain: 0.08, type: 'triangle' })
    this._burst({ freq: 5000, type: 'bandpass', q: 4, dur: 0.05, gain: 0.25, decay: 0.05 })
  }
  // 着弾の爆発
  explosion(power = 1) {
    this._burst({ freq: 700, dur: 1.4, gain: 0.9 * power, decay: 1.3 })
    this._tone({ freq: 90, to: 25, dur: 1.0, gain: 1.0 * power })
    this._burst({ freq: 3000, type: 'highpass', dur: 0.3, gain: 0.3 * power, decay: 0.3 })
  }
  // 無線の合図（短い2音と雑音）
  radio() {
    this._tone({ freq: 1250, to: 1250, dur: 0.06, gain: 0.07, type: 'square' })
    this._tone({ freq: 1650, to: 1650, dur: 0.07, gain: 0.06, type: 'square', when: 0.08 })
    this._burst({ freq: 2200, type: 'bandpass', q: 0.8, dur: 0.25, gain: 0.05, decay: 0.22 })
  }
  horn() { for (const f of [392, 494]) this._tone({ freq: f, to: f, dur: 0.38, gain: 0.07, type: 'square' }) }
  beep(high = false) { this._tone({ freq: high ? 1320 : 660, to: high ? 1320 : 660, dur: high ? 0.6 : 0.22, gain: 0.25, type: 'square' }) }
  cp() { this._tone({ freq: 880, to: 880, dur: 0.1, gain: 0.18, type: 'square' }); this._tone({ freq: 1320, to: 1320, dur: 0.18, gain: 0.18, type: 'square', when: 0.1 }) }
  ui() { this._tone({ freq: 700, to: 900, dur: 0.06, gain: 0.08, type: 'square' }) }
  fanfare() { [523, 659, 784, 1046].forEach((f, i) => this._tone({ freq: f, to: f, dur: 0.35, gain: 0.16, type: 'square', when: i * 0.12 })) }

  // BGM: 16分音符の簡単な打ち込み（キック・スネア・ハイハット・ベース・アルペジオ）
  tickMusic(dt, intensity = 1) {
    if (!this.ctx || !this.bgmOn) return
    const bpm = 132
    const s16 = 60 / bpm / 4
    this.beatT += dt
    while (this.beatT >= s16) {
      this.beatT -= s16
      const i = this.step16 = (this.step16 + 1) % 64
      const t = this.ctx.currentTime + 0.02
      const bar = Math.floor(i / 16)
      const roots = [41.2, 41.2, 49, 36.7]
      const root = roots[bar]
      const n = i % 16
      if (n % 4 === 0) this._mTone(t, 110, 38, 0.18, 0.9, 'sine')            // キック
      if (n === 4 || n === 12) this._mNoise(t, 1800, 0.14, 0.5)             // スネア
      if (n % 2 === 1) this._mNoise(t, 8000, 0.03, 0.18 * intensity, 'highpass') // ハイハット
      if ([0, 3, 6, 8, 10, 14].includes(n)) this._mTone(t, root * 2, root * 2, 0.12, 0.45, 'sawtooth', 300)
      if (intensity > 0.5 && n % 2 === 0) {
        const arp = [4, 7, 12, 7][(n / 2) % 4]
        const f = root * 4 * Math.pow(2, arp / 12)
        this._mTone(t, f, f, 0.08, 0.12, 'square', 2200)
      }
    }
  }
  _mTone(t, f0, f1, dur, gain, type, lp = 0) {
    const o = this.ctx.createOscillator(); o.type = type
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    let node = o
    if (lp) { const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); node = f }
    node.connect(g).connect(this.music); o.start(t); o.stop(t + dur + 0.02)
  }
  _mNoise(t, freq, dur, gain, type = 'bandpass') {
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    src.connect(f).connect(g).connect(this.music); src.start(t, Math.random(), dur + 0.02)
  }
}

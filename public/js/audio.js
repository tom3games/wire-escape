// 音は録音素材（public/snd、出所は public/CREDITS.md）。2026-11-02 合成音から置き換え（「AI特有のSE」対策）。
// 鳴らした回数は window.__sfxCalls（テストの mute.mjs が __soundCalls を数値で使うので名前を分けた）
// 合成で鳴らすのはタイヤの鳴き（車モードだけ）。風は 2026-11-03 に録音のループへ置き換え
const F = n => 'snd/' + n + '.mp3'
const B = '75-cc0-breaking-falling-hit-sfx_sfx_breaking_and_falling_bfh1_', IF = 'interface-sounds_kenney_interfaceSounds_Audio_', RPG = '50-rpg-sound-effects_RPGsounds_Kenney_OGG_'
const S = {
  whip: ['swishes-sound-pack_swishes_swishes_swish-1', 'swishes-sound-pack_swishes_swishes_swish-2', 'swishes-sound-pack_swishes_swishes_swish-3'],
  hook: [RPG + 'metalClick'],
  miss: [IF + 'error_004'], ui: [IF + 'click_001'], tick: [IF + 'tick_001'], lockon: [IF + 'select_002'], beep: [IF + 'bong_001'], warn: [IF + 'confirmation_002'],
  thwack: ['thwack-sounds_thwack-1.0_PCM_thwack-04', 'thwack-sounds_thwack-1.0_PCM_thwack-07'],
  cloth: [RPG + 'cloth1', RPG + 'cloth2'],
  rumble: [B + 'rock_falling_02'], rubble: [B + 'rock_breaking_01', B + 'rock_breaking_02'],
  hit: [B + 'hit_01', B + 'hit_03', B + 'hit_05'], metal: [B + 'metal_hit_01', B + 'metal_hit_03', B + 'metal_hit_05'],
  wood: [B + 'wood_hit_01', B + 'wood_breaking_02'], glass: [B + 'glass_breaking_01', B + 'glass_breaking_03'],
  step: ['100-cc0-sfx-2_sfx_100_v2_sfx100v2_footstep_01', '100-cc0-sfx-2_sfx_100_v2_sfx100v2_footstep_02'],
  air: ['100-cc0-sfx-2_sfx_100_v2_sfx100v2_air_01', '100-cc0-sfx-2_sfx_100_v2_sfx100v2_air_02'],
  shot: ['100-cc0-sfx_100-CC0-SFX_0_shot_01', '100-cc0-sfx_100-CC0-SFX_0_shot_02'], boom: ['100-cc0-sfx_100-CC0-SFX_0_explosion'],
  splash: ['40-cc0-water-splash-slime-sfx_water-splash-slime-sfx_splash_05', '40-cc0-water-splash-slime-sfx_water-splash-slime-sfx_splash_12'],
  grunt: ['little-grunts_sliced_grunt_01', 'little-grunts_sliced_grunt_02', 'little-grunts_sliced_grunt_03'],
  scream: ['female-high-pitched-scream-sfx_scream_02', 'female-high-pitched-scream-sfx_scream_03', 'female-scream-1_female_scream_1'],
  radio: ['frequency-static-sound-effects_static4'],
  whistle: ['squeak-toy-sounds_squeak_toy_squeak_toy_squeak_toy_-_squeak1'],
  bell: ['bell-dingschimes_bell_ding2'],
  fanfare: ['85-short-music-jingles_jingleSounds_Kenney_OGG_jingles_SAX_jingles_SAX03'],
  whoosh: ['air-whoosh_whoosh2_0'],
  wind: ['100-cc0-sfx-2_sfx_100_v2_sfx100v2_air_01'],   // 風の環境音（録音をループ。速さで大きく）
  siren: ['sirens-and-alarm-noise_siren_0'], rotor: ['helicopter-sounds_helicopter_0'], engine: ['racing-car-engine-sound-loops_loop_0'],
  bgm: ['music_catch-me-if-you-can_dominoespizzaakacatchme_0']
}

export class Audio {
  constructor() {
    this.ctx = null
    this.muted = false
    try { this.muted = localStorage.getItem('we-mute') === '1' } catch {}
    this.bgmOn = true
    this.bufs = {}; this.last = {}; this.loops = {}
    window.__sfxCalls = window.__sfxCalls || {}
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
    this.music = ctx.createGain(); this.music.gain.value = 0.32; this.music.connect(this.master)
    // タイヤの鳴き（車モード）だけノイズを絞って作る
    const len = ctx.sampleRate * 2
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    this.screech = this._loopNoise('bandpass', 1700, 6)
    this._load()
  }

  _load() {
    for (const k in S) for (const n of S[k]) {
      const u = F(n); if (this.bufs[u]) continue
      this.bufs[u] = 'loading'
      // 古い Safari はコールバック形の decodeAudioData しか無い
      fetch(u).then(r => r.arrayBuffer()).then(ab => new Promise((ok, ng) => this.ctx.decodeAudioData(ab, ok, ng))).then(b => { this.bufs[u] = b }).catch(() => { delete this.bufs[u] })
    }
  }

  _loopNoise(type, freq, q) {
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q
    const g = this.ctx.createGain(); g.gain.value = 0
    src.connect(f).connect(g).connect(this.sfx); src.start()
    return { g, f }
  }

  // 素材を1回鳴らす。差分からランダム（同じのは続けない）、高さを少し揺らす
  _play(key, { vol = 1, rate = 1, jitter = 0.06, when = 0 } = {}) {
    window.__sfxCalls[key] = (window.__sfxCalls[key] || 0) + 1
    if (!this.ctx) return null
    const list = S[key]; let n = list[0]
    if (list.length > 1) { do { n = list[Math.floor(Math.random() * list.length)] } while (n === this.last[key]); this.last[key] = n }
    const buf = this.bufs[F(n)]; if (!buf || buf === 'loading') return null
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain()
    s.buffer = buf; s.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter)
    g.gain.value = vol
    s.connect(g).connect(this.sfx); s.start(this.ctx.currentTime + when)
    return s
  }
  // ずっと鳴る音（サイレン・ヘリ・エンジン・BGM）。vol 0 で静かにする
  _loop(key, vol, dest, rate = 1) {
    if (!this.ctx) return
    let L = this.loops[key]
    if (!L) {
      if (vol <= 0.001) return
      const buf = this.bufs[F(S[key][0])]; if (!buf || buf === 'loading') return
      const s = this.ctx.createBufferSource(), g = this.ctx.createGain()
      s.buffer = buf; s.loop = true; g.gain.value = 0
      s.connect(g).connect(dest || this.sfx); s.start(0, Math.random() * buf.duration * 0.5)
      L = this.loops[key] = { s, g }
      window.__sfxCalls['loop:' + key] = (window.__sfxCalls['loop:' + key] || 0) + 1
    }
    const t = this.ctx.currentTime
    L.g.gain.setTargetAtTime(Math.max(0, vol), t, 0.2)
    L.s.playbackRate.setTargetAtTime(rate, t, 0.1)
  }

  setMuted(m) {
    this.muted = m
    try { localStorage.setItem('we-mute', m ? '1' : '0') } catch {}
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05)
  }

  // 車（オンラインの車モード）: エンジンの録音を速さで高くする
  drive({ speed = 0, top = 46, throttle = 0, slip = 0, boosting = false, grounded = true, engineHealth = 1, active = true }) {
    if (!this.ctx) return
    const t = this.ctx.currentTime, r = Math.min(1.4, speed / top)
    this._loop('engine', active ? 0.12 + throttle * 0.12 + (boosting ? 0.05 : 0) : 0, null, 0.7 + r * 0.9 + (1 - engineHealth) * (Math.random() * 0.1))
    this.screech.g.gain.setTargetAtTime(active && grounded && slip > 4 ? Math.min(0.22, (slip - 4) * 0.02) : 0, t, 0.06)
    this._loop('wind', active ? Math.min(0.25, r * r * 0.22) + (grounded ? 0 : 0.08) : 0)
  }

  // ワイヤーの人: エンジンは鳴らさず、速さと高さで風切りだけ
  body({ speed = 0, air = false, active = true }) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this._loop('engine', 0); this.screech.g.gain.setTargetAtTime(0, t, 0.06)
    // 風の環境音: 速さで大きく・少し高く（空中しっぽ取り v5 と同じ曲線）
    const k = Math.min(1, Math.max(0, (speed - 6) / 32))
    this._loop('wind', active ? Math.min(0.75, k + (air ? 0.03 : 0)) : 0, null, 0.85 + k * 0.35)
  }
  // 速く離した瞬間の風切り（録音の whoosh）
  swoosh(vol) { this._play('whoosh', { vol, rate: 0.9 + Math.random() * 0.2 }) }
  // ワイヤーを撃つ（ヒュッ＋ガチッ）
  whip() { this._play('whip', { vol: 0.8 }); this._play('hook', { vol: 0.6, when: 0.07 }) }
  zip() { this._play('whoosh', { vol: 0.6 }) }
  miss() { this._play('miss', { vol: 0.5 }) }
  netPop() { this._play('thwack', { vol: 0.7, rate: 0.8 }) }
  netWrap() { this._play('cloth', { vol: 0.9 }) }
  rumble() { this._play('rumble', { vol: 1, rate: 0.8 }) }
  warn() { this._play('warn', { vol: 0.5 }) }
  tick() { this._play('tick', { vol: 0.4 }) }
  splash() { this._play('splash', { vol: 1 }) }
  // 情けない裏声の「きゃー！」（毎回少し高さを変える）
  scream(v = 1) { this._play('scream', { vol: 0.75 * v, rate: 1.05, jitter: 0.12 }) }
  // 情けない声の一発（「ぐえっ」「あいたた」）
  grunt(v = 1, high = false) { this._play('grunt', { vol: 0.9 * v, rate: high ? 1.35 : 1, jitter: 0.1 }) }
  whistle(v = 1) { this._play('whistle', { vol: 0.5 * v, rate: 1.6 }); this._play('whistle', { vol: 0.5 * v, rate: 1.6, when: 0.22 }) }
  stomp() { this._play('thwack', { vol: 1, rate: 0.7 }); this.crash(1.3) }
  crash(power = 1) { const p = Math.min(1.5, power); this._play('hit', { vol: 0.7 * p, rate: 1.1 - p * 0.15 }); this._play('metal', { vol: 0.35 * p, when: 0.03 }) }
  glass(power = 1) { this._play('glass', { vol: Math.min(1, 0.4 + power * 0.3) }) }
  scrape() { this._play('metal', { vol: 0.25, rate: 1.4 }) }
  wood(power = 1) { this._play('wood', { vol: Math.min(1, 0.4 + power * 0.3) }) }
  metal(power = 1) { this._play('metal', { vol: Math.min(1, 0.35 + power * 0.3) }) }
  rubble(power = 1) { this._play('rubble', { vol: Math.min(1, 0.4 + power * 0.3) }) }
  land(power = 1) { this._play('step', { vol: Math.min(1, 0.4 + power * 0.04), rate: 0.85 }); if (power > 10) this._play('hit', { vol: Math.min(0.7, power * 0.03), rate: 0.8 }) }
  boostStart() { this._play('whoosh', { vol: 0.6 }) }
  siren(vol) { this._loop('siren', Math.max(0, Math.min(1, vol)) * 0.35) }
  rotor(vol) { this._loop('rotor', Math.max(0, Math.min(1, vol)) * 0.7) }
  lockon() { for (let i = 0; i < 3; i++) this._play('lockon', { vol: 0.4, when: i * 0.09, jitter: 0 }) }
  gunshot(power = 1) { this._play('shot', { vol: Math.min(1, 0.5 + power * 0.3) }) }
  puncture() { this._play('air', { vol: 0.8 }) }
  ricochet() { this._play('metal', { vol: 0.4, rate: 1.7 }) }
  explosion(power = 1) { this._play('boom', { vol: Math.min(1, 0.6 + power * 0.3) }) }
  radio() { this._play('radio', { vol: 0.25 }) }
  horn() { this._play('beep', { vol: 0.5, rate: 0.7 }) }
  beep(high = false) { this._play('beep', { vol: 0.5, rate: high ? 1.5 : 1, jitter: 0 }) }
  cp() { this._play('bell', { vol: 0.6 }) }
  ui() { this._play('ui', { vol: 0.5, jitter: 0.03 }) }
  fanfare() { this._play('fanfare', { vol: 0.8, jitter: 0 }) }
  // BGM（録音の曲）。逃げている最中は大きく、待ち時間は小さく
  tickMusic(dt, intensity = 1) { if (this.ctx) this._loop('bgm', this.bgmOn ? 0.35 + intensity * 0.65 : 0, this.music) }
}

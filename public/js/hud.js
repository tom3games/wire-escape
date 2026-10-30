// 追跡中の表示（役・残り時間・手配度・逮捕ゲージ・無線・損傷・速度・ブースト・小地図）
import { GAME, CARS, CHASE } from '../shared/config.js'
import { speedOf } from '../shared/physics.js'
import { RUN } from '../shared/runner.js'
import { t } from './i18n.js'

const $ = id => document.getElementById(id)
const COLORS = ['#ff5a1f', '#3b8cff', '#f2c230', '#36c37a', '#f07acb', '#eeeeee', '#9b6bff', '#ff8a1f']

function hpColor(v) {
  if (v > 0.7) return '#36c37a'
  if (v > 0.4) return '#f2c230'
  if (v > 0.15) return '#ff7a1a'
  return '#ff3b30'
}

export class HUD {
  constructor(world) {
    this.world = world
    this.msgT = 0; this.hintT = 0; this.standT = 0; this.vig = 0; this.lastCount = null
    this.map = $('miniMap').getContext('2d')
    // 小地図の下絵（道と建物）を一度だけ作る
    this.mapScale = 0.9
  }

  setup(race, me) {
    this.race = race; this.me = me
    const myE = me ? race.entries.find(e => e.car === me) : null
    this.role = myE ? myE.role : null
    const role = $('hRole')
    role.className = 'role ' + (this.role || '')
    role.innerHTML = this.role === 'cop' ? `${ICON_COP}<span>${t('roleCop')}</span>` : this.role === 'robber' ? `${ICON_ROBBER}<span>${t('roleRobber')}</span>` : ''
    // 手配度の星（SVG）
    const heat = $('hHeat'); heat.innerHTML = ''
    for (let i = 0; i < 5; i++) { const sp = document.createElement('span'); sp.innerHTML = STAR; heat.appendChild(sp) }
    this.heatSeen = 0
    race.entries.forEach((e, i) => { e.color = e.car === me ? '#ff5a1f' : e.role === 'cop' ? '#5aa8ff' : '#ff4d6d' })
    $('hCount').textContent = ''
    this.lastCount = null
    this.message('', '', 0)
    this.dmgEls = null
    this.radio('', 0)
  }

  // 無線（画面の上の帯）
  radio(text, dur = 3.2) {
    const el = $('hRadio')
    if (!text) { el.classList.remove('show'); this.radioT = 0; return }
    el.innerHTML = `${ICON_RADIO}<span></span>`
    el.querySelector('span').textContent = text
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show')
    this.radioT = dur
  }

  message(text, sub = '', dur = 1.2) {
    const el = $('hMsg')
    el.innerHTML = ''
    if (!text) { el.classList.remove('show'); return }
    el.textContent = text
    if (sub) { const s = document.createElement('small'); s.textContent = sub; el.appendChild(s) }
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show')
    this.msgT = dur
  }
  toast(text) { this.hint(text, 1.6) }
  hint(text, dur = 4) { const el = $('hHint'); el.textContent = text; el.classList.add('show'); this.hintT = dur }
  // 技やノックダウンを右に積んで流す
  feed(text, sub = '') {
    const box = $('hFeed')
    const d = document.createElement('div')
    d.textContent = text
    if (sub) { const b = document.createElement('b'); b.textContent = sub; d.appendChild(b) }
    box.appendChild(d)
    while (box.children.length > 4) box.firstChild.remove()
    setTimeout(() => d.remove(), 1700)
  }
  // ご褒美の大きな文字（コンボが続くと x2, x3…）
  reward(text, sub = '', combo = 1) {
    const el = $('hReward')
    el.innerHTML = ''
    const b = document.createElement('b'); b.textContent = text; el.appendChild(b)
    if (combo > 1) { const c = document.createElement('i'); c.textContent = 'x' + combo; el.appendChild(c) }
    if (sub) { const s = document.createElement('small'); s.textContent = sub; el.appendChild(s) }
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show')
  }
  flashScreen(kind) { const el = $('hFlash'); el.className = 'flashov'; void el.offsetWidth; el.classList.add(kind) }
  speedLines(k, boost) {
    const el = $('hSpeedLines')
    const o = Math.round((boost ? Math.max(0.55, k) : k * 0.55) * 100) / 100
    if (el._o !== o) { el._o = o; el.style.opacity = o }
    if (el._b !== boost) { el._b = boost; el.classList.toggle('boost', !!boost) }
  }
  flashDamage(d) { this.vig = Math.min(1, this.vig + d * 4 + 0.15) }

  update(race, me, dt, camera) {
    const W = this.world
    // カウントダウン
    if (race.phase === 'countdown') {
      const n = Math.ceil(-race.t)
      if (n !== this.lastCount && n <= 3) { this.lastCount = n; const el = $('hCount'); el.className = 'count'; el.textContent = n; this.onBeep && this.onBeep(false) }
    } else if (this.lastCount !== 0 && race.t < 1.2) { this.lastCount = 0; const el = $('hCount'); el.className = 'count go'; el.textContent = t('countGo') }
    else if (race.t >= 1.2 && $('hCount').textContent) $('hCount').textContent = ''

    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) $('hMsg').classList.remove('show') }
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) $('hHint').classList.remove('show') }
    this.vig = Math.max(0, this.vig - dt * 1.5)
    const low = me ? Math.max(0, 0.35 - me.dmg.body) * 1.2 : 0
    $('hVig').style.boxShadow = `inset 0 0 ${120 + this.vig * 80}px rgba(255,30,20,${Math.min(0.75, this.vig * 0.6 + low)})`

    if (this.radioT > 0) { this.radioT -= dt; if (this.radioT <= 0) $('hRadio').classList.remove('show') }
    // 手配度
    for (let i = 0; i < 5; i++) $('hHeat').children[i].classList.toggle('on', i < race.heat)
    if (race.heat !== this.heatSeen) { this.heatSeen = race.heat; $('hHeat').classList.remove('bump'); void $('hHeat').offsetWidth; $('hHeat').classList.add('bump') }
    // 残り時間
    const left = Math.max(0, race.timeLimit - Math.max(0, race.t))
    $('hTime').textContent = fmtClock(left)
    $('hTime').classList.toggle('low', left < 20)

    if (!me) return
    const myE = race.entries.find(e => e.car === me)
    // 逮捕ゲージ（自分が犯人なら自分の、警察ならいちばんたまっている犯人の）
    const rob = this.role === 'robber' ? myE : race.robbers.reduce((a, r) => (!a || r.bust > a.bust ? r : a), null)
    const bust = rob ? rob.bust : 0
    const bustEl = $('hBust')
    bustEl.classList.toggle('show', bust > 0.01 && race.phase === 'racing')
    bustEl.querySelector('i').style.width = Math.round(bust * 100) + '%'
    bustEl.querySelector('span').textContent = this.role === 'robber' ? t('bustYou') : t('bustCop')

    // 目的（次にやること）
    const H = race.hideout
    let goal = ''
    if (this.role === 'robber') {
      if (myE.arrested) goal = t('msgCaught')
      else if (myE.escaped) goal = t('msgEscaped')
      else if (H.open) goal = `${t('toHideout')} ${Math.round(Math.hypot(H.x - me.x, H.z - me.z))}m（${H.area}）`
      else goal = `${t('escapeGoal')}　${t('hideoutIn')} ${Math.max(0, Math.ceil(CHASE.hideoutOpenAt - race.t))}s`
    } else {
      const k = this.known(race, me)
      goal = k ? `${k.live ? t('robberDist') : t('lastSeen')} ${Math.round(Math.hypot(k.x - me.x, k.z - me.z))}m` : t('findRobber')
    }
    $('hNext').textContent = goal
    // 修理工場の中
    if (myE.inShop >= 0 || myE.rep > 0 || myE.repSeen) {
      if (myE.repSeen) this.hint(t('repairSeen'), 0.3)
      else if (myE.repairCd > 0) this.hint(t('repairWait').replace('{n}', Math.ceil(myE.repairCd)), 0.3)
      else if (myE.rep > 0) this.hint(`${t('repairing')} ${'■'.repeat(Math.ceil(myE.rep * 6))}${'□'.repeat(6 - Math.ceil(myE.rep * 6))}`, 0.3)
      else this.hint(t('repairHint'), 0.3)
    }

    // 人の一覧（役と状態）
    this.standT -= dt
    if (this.standT <= 0) {
      this.standT = 0.25
      const ol = $('hStand'); ol.innerHTML = ''
      for (const e of [...race.robbers, ...race.cops]) {
        const li = document.createElement('li')
        if (e.car === me) li.className = 'me'
        const st = e.left ? t('left') : e.arrested ? t('busted') : e.escaped ? t('escaped') : e.car.wreck > 0 ? t('msgWreck') : e.role === 'robber' ? t('onRun') : (e.arrests ? t('busted') + e.arrests : '')
        li.innerHTML = `<span class="ic">${e.role === 'cop' ? ICON_COP : ICON_ROBBER}</span><span class="nm"></span><span class="st">${st}</span>`
        li.querySelector('.nm').textContent = e.car.name
        ol.appendChild(li)
      }
    }

    if (me.isRunner) { this.updateRunner(me, race); this.drawMini(race, me); return }
    // 速度とブースト
    $('hSpeed').textContent = Math.round(speedOf(me) * 3.6)
    const bEl = $('hBoost')
    bEl.style.width = (me.boost * 100) + '%'
    const box = bEl.parentElement
    box.classList.toggle('lock', me.boostLock || me.overheat)
    box.classList.toggle('on', me.boosting)
    box.classList.toggle('perfect', !!(me.boosting && me.perfect))
    const since = me.boostStart != null ? me.t - me.boostStart : 99
    const win = $('hBoostWin')
    win.classList.toggle('show', me.boosting && !me.perfect && since < 0.8)
    win.classList.toggle('hot', me.boosting && !me.perfect && since >= 0.45 && since <= 0.8)
    $('hBoostLbl').textContent = me.overheat ? t('msgOverheat') : me.boostLock ? t('recharge') : 'NITRO'

    // 損傷
    const d = me.dmg
    $('dBody').style.fill = hpColor(d.body)
    $('dEngine').style.fill = hpColor(d.engine)
    $('dCool').style.fill = hpColor(d.cool)
    $('dSusp').style.fill = hpColor(d.susp)
    document.querySelectorAll('.dTire').forEach(el => el.style.fill = hpColor(d.tires))
    if (!this.dmgEls) {
      const list = $('dmgList'); list.innerHTML = ''
      this.dmgEls = {}
      for (const [k, key] of [['body', 'partBody'], ['engine', 'partEngine'], ['tires', 'partTires'], ['susp', 'partSusp'], ['cool', 'partCool']]) {
        const row = document.createElement('div')
        row.innerHTML = `<span>${t(key)}</span><b></b>`
        list.appendChild(row)
        this.dmgEls[k] = row.querySelector('b')
      }
      const heat = document.createElement('span'); heat.className = 'heat'; heat.innerHTML = '<i></i>'
      heat.title = t('heat')
      list.appendChild(heat)
      this.heatEl = heat.querySelector('i')
    }
    for (const k of Object.keys(this.dmgEls)) { this.dmgEls[k].textContent = Math.round(d[k] * 100) + '%'; this.dmgEls[k].style.color = hpColor(d[k]) }
    this.heatEl.style.width = Math.min(100, me.heat * 100) + '%'
    const bb = $('hBodyBar'); bb.style.width = Math.round(d.body * 100) + '%'; bb.style.background = hpColor(d.body)
    if (me.repairing) { if (this.hintT <= 0.2) this.hint(t('msgRepair'), 0.4) }

    this.drawMini(race, me)
  }

  // ワイヤーの人: 速さ・高さ・体力・巻き取り・コンボ
  updateRunner(me, race) {
    this.race = race
    $('hSpeed').textContent = Math.round(Math.hypot(me.vx, me.vy, me.vz) * 3.6)
    const cd = me.zipCd || 0
    const ready = !!me.rope && cd <= 0
    const bEl = $('hBoost')
    bEl.style.width = Math.round((1 - cd / RUN.zipCd) * 100) + '%'
    const box = bEl.parentElement
    box.classList.toggle('lock', !ready)
    box.classList.toggle('on', !!me.zipping)
    box.classList.remove('perfect')
    $('hBoostWin').classList.remove('show', 'hot')
    $('hBoostLbl').textContent = me.zipping ? t('reelGo') : ready ? t('reelReady') : cd > 0 ? t('reelWait') : t('reelNeed')
    if (this.onReel) this.onReel(ready ? 'ready' : cd > 0 ? 'cool' : 'idle')
    const d = me.dmg
    $('dBody').style.fill = hpColor(d.body)
    if (!this.runEls) {
      const list = $('dmgList'); list.innerHTML = ''
      this.runEls = {}
      for (const [k, key] of [['hp', 'partHp'], ['alt', 'partAlt'], ['combo', 'partCombo']]) {
        const row = document.createElement('div')
        row.innerHTML = `<span>${t(key)}</span><b></b>`
        list.appendChild(row)
        this.runEls[k] = row.querySelector('b')
      }
    }
    const E = this.runEls
    E.hp.textContent = Math.round(d.body * 100) + '%'; E.hp.style.color = hpColor(d.body)
    E.alt.textContent = Math.max(0, Math.round(me.y)) + 'm'
    E.combo.textContent = me.combo >= 2 ? 'x' + me.combo : '-'
    E.combo.style.color = me.combo >= RUN.hideCombo - 1 ? '#ffd23a' : ''
    const bb = $('hBodyBar'); bb.style.width = Math.round(d.body * 100) + '%'; bb.style.background = hpColor(d.body)
    // 通行人に見られている（いちばん気づきかけている人）
    const w = this.race && this.race.peds ? this.race.peds.watch : 0
    const eye = $('hEye')
    if (eye) { eye.classList.toggle('show', w > 0.08); eye.querySelector('i').style.width = Math.round(Math.min(1, w) * 100) + '%'; eye.classList.toggle('sneak', !!me.sneaking) }
    if (me.net > 0) this.hint(t('msgMash'), 0.3)
    else if (me.pit > 0) this.hint(t('msgPitHint'), 0.3)
    else if (me.climbing) this.hint(t('msgClimb'), 0.3)
  }

  drawMini(race, me) {
    const g = this.map, W = this.world
    const S = g.canvas.width, R = S / 2, sc = this.mapScale
    g.clearRect(0, 0, S, S)
    g.save()
    g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.clip()
    g.translate(R, R)
    // 地図座標は (-x, -z)。これで進行方向が上、車の右が右になる
    g.rotate(me.yaw)
    g.scale(sc, sc)
    g.translate(me.x, me.z)
    g.save()
    // 道
    g.lineCap = 'round'; g.lineJoin = 'round'
    for (const r of W.roads) {
      g.strokeStyle = r.surf === 'dirt' ? 'rgba(170,130,80,0.85)' : 'rgba(210,214,222,0.85)'
      g.lineWidth = r.w
      g.beginPath()
      r.pts.forEach(([x, z], i) => i ? g.lineTo(-x, -z) : g.moveTo(-x, -z))
      g.stroke()
    }
    // 板（橋・高架）
    g.fillStyle = 'rgba(210,214,222,0.85)'
    for (const sl of W.slabs) if (W.slabActive(sl) && sl.kind !== 'mound') rectRot(g, sl)
    // 建物
    g.fillStyle = 'rgba(0,0,0,0.45)'
    for (const o of W.colliders) if (!o.slab && o.kind !== 'bound' && o.kind !== 'rail') rectRot(g, o)
    // 壊せる物（残っているもの）
    g.fillStyle = '#ff9a3c'
    for (const o of W.objects) if (!W.destroyed.has(o.id) && o.def.breakAt >= 14) rectRot(g, o, 1.5)
    // ニトロ缶
    g.fillStyle = '#3ab6ff'
    for (const pk of W.pickups || []) { g.beginPath(); g.arc(-pk.x, -pk.z, 2.4 / sc, 0, Math.PI * 2); g.fill() }
    // 修理工場（青い四角に白い縁）
    g.fillStyle = 'rgba(59,140,255,0.95)'; g.strokeStyle = '#fff'; g.lineWidth = 2 / sc
    for (const r of W.repair) { g.fillRect(-r.x1, -r.z1, r.x1 - r.x0, r.z1 - r.z0); g.strokeRect(-r.x1, -r.z1, r.x1 - r.x0, r.z1 - r.z0) }
    // ランチャーの予告
    g.strokeStyle = '#ff2a2a'; g.lineWidth = 3 / sc
    for (const s2 of race.strikes || []) if (!s2.done) { g.beginPath(); g.arc(-s2.x, -s2.z, s2.r, 0, Math.PI * 2); g.stroke() }
    // スパイクベルト（黄色い線）
    g.strokeStyle = '#ffd400'; g.lineWidth = 5 / sc
    for (const sp of race.spikes || []) {
      const hx = Math.sin(sp.yaw) * sp.len / 2, hz = Math.cos(sp.yaw) * sp.len / 2
      g.beginPath(); g.moveTo(-(sp.x - hx), -(sp.z - hz)); g.lineTo(-(sp.x + hx), -(sp.z + hz)); g.stroke()
    }
    // 隠れ家（犯人にだけ。開いたら緑）
    const H = race.hideout
    if (H && this.role === 'robber') {
      g.fillStyle = H.open ? '#36e07a' : 'rgba(54,224,122,0.35)'
      g.beginPath(); g.arc(-H.x, -H.z, 9 / sc, 0, Math.PI * 2); g.fill()
    }
    // 車: 犯人には警察が近くだけ見える。警察には犯人が「近い・無線の直後・ヘリ」のときだけ見え、それ以外は最後の目撃の印
    for (const en of race.entries) {
      const c = en.car
      if (c === me) continue
      const d = Math.hypot(c.x - me.x, c.z - me.z)
      if (this.role === 'cop' && en.role === 'robber') {
        const k = this.known(race, me, en)
        if (!k) continue
        g.fillStyle = k.live ? '#ff4d6d' : 'rgba(255,77,109,0.5)'
        g.beginPath(); g.arc(-k.x, -k.z, (k.live ? 6 : 9) / sc, 0, Math.PI * 2); g.fill()
        if (!k.live) { g.strokeStyle = '#ff4d6d'; g.lineWidth = 2 / sc; g.beginPath(); g.arc(-k.x, -k.z, 16 / sc, 0, Math.PI * 2); g.stroke() }
        continue
      }
      if (this.role === 'robber' && en.role === 'cop' && d > 320) continue
      g.fillStyle = en.color || '#fff'
      g.beginPath(); g.arc(-c.x, -c.z, 4.5 / sc, 0, Math.PI * 2); g.fill()
    }
    g.restore()
    g.restore()
    // 自分（中央の三角）
    g.fillStyle = '#ff5a1f'; g.strokeStyle = '#fff'; g.lineWidth = 2
    g.beginPath(); g.moveTo(R, R - 9); g.lineTo(R + 6, R + 7); g.lineTo(R - 6, R + 7); g.closePath(); g.fill(); g.stroke()
  }
}

// 警察の画面に見える犯人の位置: 近い（CHASE.seeDist）・無線の直後・ヘリが照らしている → 本当の位置、それ以外は最後の目撃
HUD.prototype.known = function (race, me, rob = null) {
  const r = rob || race.robbers.find(x => !x.left && !x.arrested && !x.escaped) || race.robbers[0]
  if (!r) return null
  const c = r.car
  if (r.arrested || r.escaped || Math.hypot(c.x - me.x, c.z - me.z) < CHASE.seeDist || race.t < race.pingUntil || race.heat >= CHASE.heli) return { x: c.x, z: c.z, live: true }
  return r.lastSeen ? { x: r.lastSeen.x, z: r.lastSeen.z, live: false } : null
}

function fmtClock(s) {
  const m = Math.floor(s / 60), r = Math.floor(s - m * 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

export const ICON_COP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z" fill="currentColor"/><path d="m12 7 1.5 3 3.3.5-2.4 2.3.6 3.3L12 14.6 9 16.1l.6-3.3-2.4-2.3 3.3-.5z" fill="#14161a"/></svg>'
export const ICON_ROBBER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9c3-1 6-1.5 9-1.5s6 .5 9 1.5v3.5c-3 1-6 1.5-9 1.5s-6-.5-9-1.5z" fill="currentColor"/><circle cx="8.3" cy="10.8" r="1.6" fill="#14161a"/><circle cx="15.7" cy="10.8" r="1.6" fill="#14161a"/><path d="M7 17c1.5 1.2 3.2 1.8 5 1.8s3.5-.6 5-1.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
const ICON_RADIO = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="7" width="12" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 2l3 5M12 12h3M9 16h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill="currentColor" stroke="#fff" stroke-opacity=".75" stroke-width="1.3" stroke-linejoin="round"/></svg>'

function rectRot(g, o, pad = 0) {
  g.save()
  g.translate(-o.cx, -o.cz)
  g.rotate(Math.PI - (o.yaw || 0))
  g.fillRect(-o.hw - pad, -o.hl - pad, (o.hw + pad) * 2, (o.hl + pad) * 2)
  g.restore()
}

export function fmt(s) {
  if (s == null) return '--:--.--'
  const m = Math.floor(s / 60), r = s - m * 60
  return `${m}:${r.toFixed(2).padStart(5, '0')}`
}

// 街の全体図（遊び方の画面）。北が上
export function drawFullMap(cv, W) {
  const g = cv.getContext('2d')
  const B = W.bounds || { x0: -310, x1: 240, z0: -60, z1: 1215 }
  const pad = 30
  const x0 = B.x0 - pad, x1 = B.x1 + pad, z0 = B.z0 - pad, z1 = B.z1 + pad
  const sc = Math.min(cv.width / (x1 - x0), cv.height / (z1 - z0))
  g.clearRect(0, 0, cv.width, cv.height)
  g.save()
  g.translate(cv.width / 2 - ((x0 + x1) / 2) * sc, cv.height / 2 + ((z0 + z1) / 2) * sc)
  g.scale(sc, -sc)
  if (W.water) { g.fillStyle = 'rgba(60,120,190,0.6)'; g.fillRect(x0, W.water.z0, x1 - x0, W.water.z1 - W.water.z0) }
  g.lineCap = 'round'; g.lineJoin = 'round'
  for (const r of W.roads) {
    g.strokeStyle = '#cfd3da'
    g.lineWidth = Math.max(3 / sc, r.w)
    g.beginPath(); r.pts.forEach(([x, z], i) => i ? g.lineTo(x, z) : g.moveTo(x, z)); g.stroke()
  }
  g.fillStyle = 'rgba(0,0,0,0.5)'
  for (const o of W.colliders) if (o.kind === 'building' && o.hw < 200) g.fillRect(o.cx - o.hw, o.cz - o.hl, o.hw * 2, o.hl * 2)
  g.restore()
  g.font = 'bold 12px "Chakra Petch", sans-serif'
  g.textAlign = 'center'
  const P = (x, z) => [cv.width / 2 + (x - (x0 + x1) / 2) * sc, cv.height / 2 - (z - (z0 + z1) / 2) * sc]
  for (const l of W.labels) {
    const [px, py] = P(l.x, l.z)
    g.fillStyle = '#14161a'; g.beginPath(); g.arc(px, py, 9, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#f2c230'; g.fillText(l.t, px, py + 4)
  }
}

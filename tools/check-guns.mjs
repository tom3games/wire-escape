// 拳銃（手配度2から）を実ブラウザで起こして確かめる（chromium と webkit、横持ちスマホ相当）。
// node tools/check-guns.mjs   スクショは shots/chase/
import { chromium, webkit } from 'playwright'
import { serveStatic } from './static.mjs'
import { mkdir } from 'node:fs/promises'
const OUT = new URL('../shots/chase/', import.meta.url).pathname
await mkdir(OUT, { recursive: true })
const srv = await serveStatic(5197)
const res = []
const ok = (c, l, d = '') => res.push(`${c ? 'OK' : 'NG'}  ${l}  ${d}`)
for (const [name, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  const b = await bt.launch(name === 'chromium' ? { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : {})
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: name === 'chromium' ? true : undefined, locale: 'ja-JP' })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message))
  p.on('console', m => { if (m.type() === 'error' && !/404|fonts/.test(m.text())) errs.push(m.text()) })
  await p.goto(`http://localhost:5197/?v=${Date.now()}`)
  await p.waitForFunction(() => window.__btrReady, null, { timeout: 60000 })
  await p.evaluate(() => { window.__btr.profile.cpu = 2; window.__btr.startOffline('robber') })
  await p.waitForTimeout(5200)
  await p.evaluate(() => document.querySelector('[data-k=gas]').dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })))
  // 警察を、犯人から 22m の見通しのよい所に置き続ける（もう1台は遠くへ）
  await p.evaluate(() => {
    const B = window.__btr, r = B.race, m = B.me
    window.__shots = 0; window.__hits = 0
    const orig = r.events.push.bind(r.events)
    r.events.push = (...a) => { for (const e of a) if (e.t === 'shot') { window.__shots++; if (e.hit.includes('me')) window.__hits++ } return orig(...a) }
    const dir = [[22, 0], [-22, 0], [0, 22], [0, -22]].find(([dx, dz]) => r.clearShot(m.x + dx, m.z + dz, m.x, m.z)) || [22, 0]
    window.__park = () => { r.cops.forEach((c, i) => { c.car.x = m.x + dir[0] * (i ? 20 : 1); c.car.z = m.z + dir[1] * (i ? 20 : 1); c.car.vx = c.car.vz = 0; c.car.yaw = Math.atan2(-dir[0], -dir[1]) }); m.vx = m.vz = 0; r.robbers[0].bust = 0 }
    window.__timer = setInterval(window.__park, 30)
    m.dmg.body = 1
  })
  await p.waitForTimeout(2500)
  const before = await p.evaluate(() => window.__shots)
  ok(before === 0, `${name} 手配度1では撃たない`, `発砲 ${before}`)
  await p.evaluate(() => { window.__btr.race.heatBonus = 1 })
  await p.waitForFunction(() => window.__shots > 0, null, { timeout: 8000 }).catch(() => {})
  // 弾道の光が出ている瞬間を撮る
  for (let i = 0; i < 40; i++) { const n = await p.evaluate(() => window.__shots); await p.waitForFunction(k => window.__shots > k, n, { timeout: 3000, polling: 'raf' }).catch(() => {}); await p.screenshot({ path: OUT + `${name}-gun.png` }); break }
  await p.waitForTimeout(5000)
  const st = await p.evaluate(() => ({ shots: window.__shots, hits: window.__hits, body: window.__btr.me.dmg.body, heat: window.__btr.race.heat, wreck: window.__btr.me.wreck }))
  ok(st.heat === 2 && st.shots >= 3, `${name} 手配度2でパトカーが撃つ`, `発砲 ${st.shots} 命中 ${st.hits}`)
  ok(st.hits > 0 && st.body < 1 && st.wreck === 0, `${name} 当たると車体が減る（大破はしない）`, `車体 ${Math.round(st.body * 100)}%`)
  await p.screenshot({ path: OUT + `${name}-gun-after.png` })
  await p.evaluate(() => clearInterval(window.__timer))
  // スパイクベルト: 自分の前 22m に敷いて撮り、上を走らせてパンクを確かめる
  await p.evaluate(() => {
    const B = window.__btr, r = B.race, m = B.me
    r.cops.forEach(c => { c.car.x = m.x + 400; c.car.z = m.z })
    m.dmg.tires = 1; m.flat = false
    const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw)
    r.spikes.push({ id: 99, x: m.x + fx * 22, z: m.z + fz * 22, yaw: m.yaw + Math.PI / 2, len: 9, at: r.t, until: r.t + 30 })
    r.events.push({ t: 'spike', ...r.spikes[r.spikes.length - 1] })
  })
  await p.waitForTimeout(600)
  await p.screenshot({ path: OUT + `${name}-spike.png` })
  await p.evaluate(() => { const B = window.__btr, m = B.me, sp = B.race.spikes.find(s => s.id === 99); B.teleport(sp.x - Math.sin(m.yaw) * 4, sp.z - Math.cos(m.yaw) * 4, m.yaw, 18) })
  await p.waitForTimeout(800)
  const fl = await p.evaluate(() => ({ flat: window.__btr.me.flat, tires: window.__btr.me.dmg.tires }))
  await p.screenshot({ path: OUT + `${name}-spike-flat.png` })
  ok(fl.flat && fl.tires <= 0.15, `${name} スパイクベルトを踏むとパンク`, `タイヤ ${Math.round(fl.tires * 100)}%`)
  ok(errs.length === 0, `${name} エラー 0`, errs.slice(0, 3).join(' | '))
  await b.close()
}
console.log(res.join('\n'))
srv.close()

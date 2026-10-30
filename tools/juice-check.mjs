// 爽快感の演出を実画面で起こして確かめる（パトカー撃破→スロー・テイクダウン文字、ニアミス、ニトロの流れる線）。
// node tools/juice-check.mjs [chromium|webkit]  → shots/juice/
import { chromium, webkit } from 'playwright'
import { serveStatic } from './static.mjs'
import { mkdir } from 'node:fs/promises'
const OUT = new URL('../shots/juice/', import.meta.url).pathname
await mkdir(OUT, { recursive: true })
const srv = await serveStatic(5195)
const engine = process.argv[2] === 'webkit' ? webkit : chromium
const b = await engine.launch(engine === chromium ? { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : {})
const bad = [], good = []
const ok = (c, name, info = '') => (c ? good : bad).push(`${c ? 'OK' : 'NG'}  ${name}  ${info}`)
for (const [w, h] of [[844, 390], [390, 844]]) {
  const tag = `${process.argv[2] || 'chromium'}-${w}x${h}`
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: engine === chromium ? true : undefined, hasTouch: true, locale: 'ja-JP' })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push(m.text()) })
  await p.goto('http://localhost:5195/?v=' + Date.now())
  await p.waitForFunction(() => window.__btrReady, null, { timeout: 30000 })
  await p.evaluate(() => {
    window.__rw = []
    new MutationObserver(() => { const t = document.getElementById('hReward').textContent; if (t) window.__rw.push(t) }).observe(document.getElementById('hReward'), { childList: true })
    window.__btr.profile.cpu = 2; window.__btr.startOffline('robber')
  })
  await p.waitForTimeout(5300)
  // 直線で、止めたパトカーに後ろから全力で当てる（最大4回）
  const res = await p.evaluate(async () => {
    const B = window.__btr, r = B.race, me = B.me, cop = r.cops[0].car
    const sleep = ms => new Promise(f => setTimeout(f, ms))
    let slowSeen = 0, downs = 0
    for (let k = 0; k < 4 && !downs; k++) {
      B.teleport(0, 420, 0, 42)
      cop.x = me.x; cop.z = me.z + 45; cop.y = me.y; cop.yaw = 0; cop.vx = cop.vz = 0; cop.freeze = 3; cop.wreck = 0
      for (let i = 0; i < 40; i++) {
        me.vx = 0; me.vz = Math.max(me.vz, 40)
        await sleep(25)
        if (B.juice.slow > 0 || B.juice.stop > 0) slowSeen++
        if (cop.wreck > 0 && !cop.knock) { downs++; break }
      }
    }
    await sleep(300)
    return { downs, slowSeen, copBody: cop.dmg.body, wreck: cop.wreck }
  })
  await p.waitForTimeout(150)
  await p.screenshot({ path: `${OUT}${tag}-takedown.png` })
  ok(res.downs === 1, tag + ' 体当たりでパトカーが大破する', JSON.stringify(res))
  ok(res.slowSeen > 0, tag + ' 大破の瞬間にスロー/ヒットストップが入る')
  await p.waitForTimeout(2500)
  // 燃えて残っている
  const burning = await p.evaluate(() => { const c = window.__btr.race.cops[0].car; return c.wreck })
  ok(burning > 0, tag + ' 2.5秒後もその場で燃えている', 'wreck ' + burning.toFixed(1))
  await p.screenshot({ path: `${OUT}${tag}-burning.png` })
  // ニアミス: 止めた他の車の横 2.8m を全速で抜ける
  const nm = await p.evaluate(async () => {
    const B = window.__btr, r = B.race, me = B.me
    const sleep = ms => new Promise(f => setTimeout(f, ms))
    const before = window.__rw.length
    // もう1台のパトカーを止めて、その横 2.8m を全速で抜ける
    const o = r.cops[1].car
    for (let k = 0; k < 2; k++) {
      B.teleport(0, 420, 0, 40)
      o.x = me.x + 2.8; o.z = me.z + 30; o.y = me.y; o.yaw = 0; o.vx = o.vz = 0; o.freeze = 3
      // 追い越すまで待つ（headless の webkit はシミュレーションが実時間より遅いことがある）
      for (let i = 0; i < 160 && me.z < o.z + 8; i++) { me.vx = 0; me.vz = Math.max(me.vz, 40); await sleep(25) }
      await sleep(600)
    }
    return { rw: window.__rw.slice(before), hitAt: B.juice.hitAt, t: r.t, dx: me.x - o.x, slow: B.juice.slow, phase: r.phase, wreck: me.wreck }
  })
  ok(nm.rw.some(t => t.includes('NEAR MISS')), tag + ' ニアミスの文字が出る', nm.rw.join(' / ') + ' ' + JSON.stringify({ ...nm, rw: undefined }))
  // ニトロの流れる線
  await p.evaluate(() => { window.__btr.teleport(0, 420, 0, 40); window.__btr.me.boost = 1 })
  await p.keyboard.down('Shift'); await p.keyboard.down('KeyW')
  await p.waitForTimeout(700)
  const sl = await p.evaluate(() => ({ o: Number(getComputedStyle(document.getElementById('hSpeed')).opacity), boost: document.getElementById('hSpeed').classList.contains('boost'), boosting: window.__btr.me.boosting }))
  await p.screenshot({ path: `${OUT}${tag}-nitro.png` })
  await p.keyboard.up('Shift'); await p.keyboard.up('KeyW')
  ok(sl.o > 0.3 && sl.boost, tag + ' ニトロ中に流れる線が出る', JSON.stringify(sl))
  ok(!errs.length, tag + ' エラー 0', errs.slice(0, 3).join(' | '))
  await ctx.close()
}
await b.close(); srv.close()
console.log(good.join('\n')); console.log(bad.length ? bad.join('\n') : 'ALL OK')

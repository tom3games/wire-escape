// 警察と犯人を実画面で撮る。node tools/shot-chase.mjs [w] [h]
// タイトル → 犯人で逃げる（自動運転）→ 警察で追う（自動運転）→ 結果。スクショは shots/chase/
import { chromium } from 'playwright'
import { serveStatic } from './static.mjs'
import { mkdir } from 'node:fs/promises'
const OUT = new URL('../shots/chase/', import.meta.url).pathname
await mkdir(OUT, { recursive: true })
const srv = await serveStatic(5191)
const W = Number(process.argv[2] || 1280), H = Number(process.argv[3] || 720)
const touch = W < 1000
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: W, height: H }, locale: 'ja-JP', deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch })
const page = await ctx.newPage()
const errs = []
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', e => errs.push('pageerror: ' + e.message))
await page.goto('http://localhost:5191/?v=' + Date.now())
await page.waitForFunction(() => window.__btrReady, null, { timeout: 30000 })
await page.waitForTimeout(3000)
const tag = `${W}x${H}`
await page.screenshot({ path: OUT + tag + '-title.png' })
const out = {}
for (const role of ['robber', 'cop']) {
  await page.evaluate(r => { window.__btr.profile.cpu = 3; window.__btr.startOffline(r) }, role)
  await page.waitForTimeout(1800)
  await page.screenshot({ path: OUT + `${tag}-${role}-countdown.png` })
  await page.waitForTimeout(3000)
  await page.evaluate(() => window.__btr.autopilot())
  let shot = 0
  const t0 = Date.now()
  while (Date.now() - t0 < 200000) {
    await page.waitForTimeout(4000)
    const st = await page.evaluate(() => ({ mode: window.__btr.mode, t: window.__btr.race.t, heat: window.__btr.race.heat, phase: window.__btr.race.phase, out: window.__btr.race.outcome }))
    if (shot < 4 && st.t > 6 + shot * 25) { await page.screenshot({ path: OUT + `${tag}-${role}-${shot}.png` }); shot++ }
    if (st.mode === 'results') { out[role] = st.out; break }
  }
  await page.waitForTimeout(2500)
  await page.screenshot({ path: OUT + `${tag}-${role}-results.png` })
}
console.log(JSON.stringify(out))
console.log('errors', errs.length, errs.slice(0, 5).join(' | '))
await browser.close(); srv.close()

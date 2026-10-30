// 実画面を撮る。node tools/shot.mjs [台本名]
import { chromium } from 'playwright'
import { serveStatic } from './static.mjs'
import { mkdir } from 'node:fs/promises'
const OUT = new URL('../shots/', import.meta.url).pathname
await mkdir(OUT, { recursive: true })
const srv = await serveStatic(5190)
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: 'ja-JP' })
const errs = []
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()) })
page.on('pageerror', e => errs.push('pageerror: ' + e.message))
page.on('requestfailed', r => errs.push('reqfail: ' + r.url()))
await page.goto('http://localhost:5190/?v=' + Date.now())
await page.waitForFunction(() => window.__btrReady, null, { timeout: 20000 }).catch(() => errs.push('not ready'))
await page.waitForTimeout(2500)
await page.screenshot({ path: OUT + 'title.png' })
const script = process.argv[2] || 'basic'
if (script === 'basic') {
  await page.click('#btnOffline')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: OUT + 'countdown.png' })
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(6000)
  await page.screenshot({ path: OUT + 'drive.png' })
  await page.keyboard.up('KeyW')
  // 橋の手前へ
  await page.evaluate(() => window.__btr.teleport(0, 600, 0, 50))
  await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: OUT + 'bridge-jump.png' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: OUT + 'bridge-land.png' })
  await page.keyboard.up('ShiftLeft')
  await page.evaluate(() => window.__btr.teleport(0, 392, 0, 38))
  await page.waitForTimeout(900)
  await page.screenshot({ path: OUT + 'wall.png' })
  await page.keyboard.up('KeyW')
}
if (script === 'full') {
  const routes = (process.argv[3] || 'B,C,E,BE').split(',')
  await page.selectOption('#cpuSelect', '3')
  await page.click('#btnOffline')
  await page.evaluate(r => window.__btr.autopilot(r), routes)
  const t0 = Date.now()
  let k = 0
  while (Date.now() - t0 < 110000) {
    await page.waitForTimeout(6000)
    const st = await page.evaluate(() => ({ mode: window.__btr.mode, t: window.__btr.race && window.__btr.race.t, z: window.__btr.me && window.__btr.me.z, body: window.__btr.me && window.__btr.me.dmg.body }))
    console.log(JSON.stringify(st))
    await page.screenshot({ path: OUT + `full-${String(k++).padStart(2, '0')}.png` })
    if (st.mode === 'results') break
  }
  await page.waitForTimeout(3000)
  await page.screenshot({ path: OUT + 'results.png' })
}
if (script === 'tour') {
  await page.evaluate(() => { window.__btr.profile.stage = 'touge' })
  await page.click('#btnOffline')
  await page.waitForTimeout(5000)
  const spots = [['alley', 34, 150, 0], ['closed', 0, 150, 0], ['c-ramp', 52, 320, 0], ['c-deck', 56, 425, 0], ['warehouse', 0, 425, 0], ['pit1', -62, 450, 0], ['bridge', 0, 640, 0], ['bridge2', -40, 610, 0.6], ['bridge3', 30, 700, -0.6], ['bridge4', 0, 760, Math.PI], ['detour', -200, 640, -Math.PI / 2], ['trail', 168, 690, 0], ['hill-a', 140, 930, 0], ['mine', 0, 900, 0], ['cliff', 0, 1020, 0], ['mtn-d', -90, 930, 0.5], ['finish', 0, 1140, 0]]
  for (const [n, x, z, yaw] of spots) {
    await page.evaluate(([x, z, yaw]) => { window.__btr.setPaused(false); window.__btr.teleport(x, z, yaw, 0) }, [x, z, yaw])
    await page.waitForTimeout(700)
    await page.evaluate(() => window.__btr.setPaused(true))
    await page.waitForTimeout(400)
    await page.screenshot({ path: OUT + 'tour-' + n + '.png' })
  }
}
if (script === 'fx') {
  await page.selectOption('#cpuSelect', '0')
  await page.click('#btnOffline')
  await page.waitForTimeout(4800)
  // 壁に3回ぶつけて凹みと部品の脱落を見る
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { const b = window.__btr; b.teleport(-96, 180, -Math.PI / 2, 26) })
    await page.waitForTimeout(900)
  }
  await page.evaluate(() => window.__btr.teleport(-96, 200, Math.PI * 0.75, 0))
  await page.waitForTimeout(800)
  await page.screenshot({ path: OUT + 'fx-damage.png' })
  // 鉄塔を倒す
  await page.evaluate(() => { const b = window.__btr; b.me.dmg.body = 1; b.teleport(59.6, 425, 0, 20) })
  await page.waitForTimeout(700)
  await page.screenshot({ path: OUT + 'fx-tower1.png' })
  await page.waitForTimeout(1600)
  await page.screenshot({ path: OUT + 'fx-tower2.png' })
  // 崖から飛ぶ
  await page.evaluate(() => { const b = window.__btr; b.me.dmg.body = 1; b.teleport(0, 1000, 0, 36) })
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(1100)
  await page.screenshot({ path: OUT + 'fx-cliff.png' })
  await page.waitForTimeout(1300)
  await page.screenshot({ path: OUT + 'fx-cliff-land.png' })
  await page.keyboard.up('KeyW')
  // fps
  const fps = await page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2) }; requestAnimationFrame(f) }))
  console.log('fps', fps)
}
if (script === 'city') {
  await page.evaluate(() => { const b = window.__btr; b.profile.stage = 'city' })
  await page.click('#btnOffline')
  await page.waitForTimeout(1200)
  await page.screenshot({ path: OUT + 'city-start.png' })
  await page.waitForTimeout(4000)
  const sc = await page.evaluate(() => window.__btr.world.shortcuts.map(s => [s.entry, s.out]))
  const spots = [['avenue', 0, 300, 0, 30], ['downtown', 0, 800, 0, 25], ['bridge', 260, 690, Math.PI, 40]]
  sc.forEach(([e, o], i) => spots.push(['cut' + i, e[0] + o[0] * 40, e[1] + o[1] * 40, Math.atan2(-o[0], -o[1]), 0]))
  for (const [n, x, z, yaw, sp] of spots) {
    await page.evaluate(([x, z, yaw, sp]) => { window.__btr.setPaused(false); window.__btr.teleport(x, z, yaw, sp) }, [x, z, yaw, sp])
    await page.waitForTimeout(sp ? 900 : 600)
    await page.evaluate(() => window.__btr.setPaused(true))
    await page.waitForTimeout(400)
    await page.screenshot({ path: OUT + 'city-' + n + '.png' })
  }
}
if (script === 'tree') {
  await page.evaluate(() => { window.__btr.profile.stage = 'touge' })
  await page.click('#btnOffline'); await page.waitForTimeout(5000)
  // 一番近い木に向かって走らせる
  await page.evaluate(() => { const b = window.__btr; const t = b.world.trees.find(t => t.z > 900 && t.z < 1000 && Math.abs(t.x - 140) < 40) || b.world.trees[500]; const yaw = 0; b.teleport(t.x, t.z - 14, yaw, 22) })
  await page.waitForTimeout(700)
  await page.screenshot({ path: OUT + 'tree1.png' })
  await page.waitForTimeout(900)
  await page.screenshot({ path: OUT + 'tree2.png' })
  console.log('broken trees', await page.evaluate(() => [...window.__btr.world.destroyed].filter(id => id.startsWith('tree')).length))
}
const info = await page.evaluate(() => ({ calls: window.__btr.renderer.info.render.calls, tris: window.__btr.renderer.info.render.triangles, mode: window.__btr.mode, broken: [...window.__btr.world.destroyed].length }))
console.log(JSON.stringify(info))
console.log(errs.slice(0, 30).join('\n') || 'no errors')
await browser.close(); srv.close()

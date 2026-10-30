// 公開URLで確かめる: Chrome と iPhone 相当で開いて逃げる→ワイヤーが掛かる、エラー0、og.jpg が 200、OGP の meta
import { chromium, webkit } from 'playwright'
const URL0 = 'https://tom3games.github.io/wire-escape/'
let bad = 0
for (const [eng, opt] of [[chromium, { viewport: { width: 1280, height: 720 } }], [webkit, { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 }]]) {
  const b = await eng.launch(eng === chromium ? { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : {})
  const p = await (await b.newContext({ ...opt, locale: 'ja-JP' })).newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message))
  p.on('console', m => { if (m.type() === 'error' && !/healthz|fonts|404/.test(m.text())) errs.push(m.text()) })
  await p.goto(URL0 + '?t=' + Date.now())
  await p.waitForFunction(() => window.__btrReady, null, { timeout: 60000 })
  const meta = await p.evaluate(() => ({ title: document.title, og: document.querySelector('meta[property="og:image"]').content }))
  if (opt.hasTouch) await p.tap('#btnOffline'); else await p.click('#btnOffline')
  await p.waitForTimeout(5200)
  const r = await p.evaluate(async () => {
    const B = window.__btr, n = B.race.nav.list.find(n => n.i === 4 && n.j === 4), m = B.me
    Object.assign(m, { x: n.x, z: n.z, y: 0, yaw: 0, vx: 0, vz: 6 })
    return { runner: !!m.isRunner }
  })
  let roped = false
  for (let i = 0; i < 5 && !roped; i++) { await p.keyboard.down('KeyE'); await p.waitForTimeout(80); await p.keyboard.up('KeyE'); await p.waitForTimeout(300); roped = await p.evaluate(() => !!window.__btr.me.rope) }
  await p.screenshot({ path: new URL(`../shots/live-${eng.name()}.png`, import.meta.url).pathname })
  const ok = r.runner && roped && !errs.length
  if (!ok) bad++
  console.log(eng.name(), ok ? 'OK' : 'NG', JSON.stringify({ ...meta, ...r, roped, errs }))
  await b.close()
}
const og = await fetch(URL0 + 'og.jpg')
console.log('og.jpg', og.status, og.headers.get('content-type'))
if (og.status !== 200) bad++
process.exit(bad ? 1 : 0)

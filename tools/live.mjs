// 公開URLを chromium と webkit で開いて、オフラインで1レース走れるか確かめる
import { chromium, webkit } from 'playwright'
const URL0 = 'https://tom3games.github.io/break-the-route/?v=' + Date.now()
for (const [name, bt, opt] of [['chromium', chromium, { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }], ['webkit', webkit, {}]]) {
  const b = await bt.launch(opt)
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, locale: 'ja-JP' })
  const errs = []
  p.on('pageerror', e => errs.push(e.message))
  p.on('console', m => { if (m.type() === 'error' && !/healthz|404|fonts/.test(m.text())) errs.push(m.text()) })
  await p.goto(URL0)
  await p.waitForFunction(() => window.__btrReady, null, { timeout: 40000 })
  const online = await p.evaluate(() => ({ disabled: document.getElementById('btnOnline').disabled, note: document.getElementById('onlineNote').textContent }))
  await p.selectOption('#cpuSelect', '3')
  await p.click('#btnOffline')
  await p.evaluate(() => window.__btr.autopilot())
  await p.waitForFunction(() => window.__btr.mode === 'results', null, { timeout: 200000 }).catch(() => errs.push('results not reached'))
  await p.waitForTimeout(2500)
  await p.screenshot({ path: `shots/live-${name}.png` })
  const rows = await p.$$eval('#rBody tr', t => t.length)
  console.log(name, JSON.stringify({ online, rows, errs: errs.slice(0, 3) }))
  await b.close()
}

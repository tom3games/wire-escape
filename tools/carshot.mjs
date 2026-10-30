// 車を近くで撮る（ガレージのプレビューを大きくして撮る）
import { chromium } from 'playwright'
import { serveStatic } from './static.mjs'
const srv = await serveStatic(5194)
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !m.text().includes('404') && errs.push(m.text()))
await p.goto('http://localhost:5194/'); await p.waitForFunction(() => window.__btrReady)
await p.selectOption('#cpuSelect', '0'); await p.waitForTimeout(3000); await p.click('#btnOffline'); await p.waitForTimeout(4500)
await p.evaluate(() => { window.__btr.teleport(-130, 640, -Math.PI / 2, 0) }); await p.waitForTimeout(800)
await p.addStyleTag({ content: '#hud{display:none!important}' })
for (const [name, cam] of [['car-rear', [6, 1.8, 0.5]], ['car-side', [0, 1.2, 5.5]], ['car-front', [-4.5, 1.3, -3]]]) {
  await p.evaluate(c => { const b = window.__btr; b.setPaused(true); b.camera.position.set(b.me.x + c[0], b.me.y + c[1], b.me.z + c[2]); b.camera.lookAt(b.me.x, b.me.y + 0.3, b.me.z); window.__freeze = true }, cam)
  await p.waitForTimeout(500)
  await p.screenshot({ path: `shots/${name}.png` })
}
console.log(errs.join('\n') || 'no errors')
await b.close(); srv.close()

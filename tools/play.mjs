// 実ブラウザで通しで遊ぶ: タイトル → 逃げる → 走る → ワイヤーでスイング → 巻き取り。スクショとエラーを集める
//   node tools/play.mjs [webkit] [WxH]
import { webkit, chromium } from 'playwright'
import { serveStatic } from './static.mjs'
import { mkdir } from 'node:fs/promises'
const OUT = new URL('../shots/play/', import.meta.url).pathname
await mkdir(OUT, { recursive: true })
const srv = await serveStatic(5197)
const useWk = process.argv.includes('webkit')
const size = (process.argv.find(a => /^\d+x\d+$/.test(a)) || '1280x720').split('x').map(Number)
const engine = useWk ? webkit : chromium
const b = await engine.launch(useWk ? {} : { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const ctx = await b.newContext({ viewport: { width: size[0], height: size[1] }, locale: 'ja-JP', colorScheme: 'light' })
const p = await ctx.newPage()
const errs = []
p.on('pageerror', e => errs.push('pageerror ' + e.message))
p.on('console', m => { if (m.type() === 'error' && !/healthz|fonts|404/.test(m.text())) errs.push(m.text()) })
p.on('requestfailed', r => { if (!/healthz|fonts/.test(r.url())) errs.push('fail ' + r.url()) })
const tag = `${engine.name()}-${size.join('x')}`
await p.goto('http://localhost:5197/')
await p.waitForFunction(() => window.__btrReady, null, { timeout: 60000 })
await p.waitForTimeout(2500)
await p.screenshot({ path: OUT + tag + '-0title.png' })
await p.click('#btnOffline')
await p.waitForTimeout(4600) // カウントダウン
await p.screenshot({ path: OUT + tag + '-1start.png' })
await p.keyboard.down('KeyW')
await p.waitForTimeout(1500)
const log = []
let maxY = 0, wires = 0
for (let i = 0; i < 14; i++) {
  await p.keyboard.down('KeyE'); await p.waitForTimeout(80); await p.keyboard.up('KeyE')
  await p.waitForTimeout(600)
  const st = await p.evaluate(() => { const m = window.__btr.me; return { x: m.x, y: m.y, z: m.z, rope: !!m.rope, v: Math.hypot(m.vx, m.vz), combo: m.combo, hp: m.dmg.body, heat: window.__btr.race.heat } })
  maxY = Math.max(maxY, st.y); if (st.rope) wires++
  log.push(st)
  if (i === 3 || i === 8) await p.screenshot({ path: OUT + tag + `-2swing${i}.png` })
}
await p.keyboard.down('KeyE'); await p.waitForTimeout(80); await p.keyboard.up('KeyE')
await p.waitForTimeout(200)
await p.keyboard.down('ShiftLeft'); await p.waitForTimeout(100); await p.keyboard.up('ShiftLeft')
await p.waitForTimeout(400)
await p.screenshot({ path: OUT + tag + '-3zip.png' })
await p.keyboard.up('KeyW')
const fps = await p.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2) }; requestAnimationFrame(f) }))
console.log(tag, 'maxY', maxY.toFixed(1), 'ワイヤー中だった回', wires, 'fps', fps)
console.log(log.map(s => `${s.x.toFixed(0)},${s.z.toFixed(0)} y${s.y.toFixed(1)} v${s.v.toFixed(0)}${s.rope ? ' R' : ''} c${s.combo} hp${Math.round(s.hp * 100)}`).join('\n'))
console.log(errs.length ? 'エラー:\n' + errs.join('\n') : 'エラー 0')
await b.close(); srv.close()

// 地面ワイヤーを実ブラウザで: 空中で道をタップ → 地面ワイヤーが掛かって加速 → 外れて跳ねる。地面にいる時に道をタップしても掛からない
//   node tools/groundwire.mjs [webkit]   スクショは shots/groundwire/
import '../mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { chromium, webkit } from 'playwright'
import { muteContext, MUTE_LAUNCH } from './mute.mjs'
import { serveStatic } from './static.mjs'
import { mkdir } from 'node:fs/promises'
const OUT = new URL('../shots/groundwire/', import.meta.url).pathname
await mkdir(OUT, { recursive: true })
const srv = await serveStatic(5195)
const useWk = process.argv.includes('webkit')
const eng = useWk ? webkit : chromium
const b = await eng.launch(useWk ? {} : { args: [...MUTE_LAUNCH.args, '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
let bad = 0
const ok = (c, name, info = '') => { if (!c) bad++; console.log(c ? 'OK ' : 'NG ', name, info) }
for (const size of [[390, 844], [844, 390]]) {
  const tag = `${eng.name()}-${size.join('x')}`
  const ctx = await b.newContext({ viewport: { width: size[0], height: size[1] }, locale: 'ja-JP', hasTouch: true, isMobile: !useWk })
  await muteContext(ctx)
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message))
  await p.goto('http://localhost:5195/')
  await p.waitForFunction(() => window.__btrLoaded, null, { timeout: 60000 })
  await p.tap('#btnOffline')
  await p.waitForTimeout(5200)
  // 道の上空へ置いて、前方の道の点が画面のどこに見えるかを出す
  const place = (y, vz) => p.evaluate(([y, vz]) => {
    const B = window.__btr, m = B.me, n = B.race.nav.list.find(n => n.i === 4 && n.j === 4)
    Object.assign(m, { x: n.x, z: n.z, y, yaw: 0, vx: 0, vy: 0, vz, grounded: y < 0.5, rope: null, climbing: null })
    B.snapCam()
  }, [y, vz])
  const screenOf = () => p.evaluate(() => {
    const B = window.__btr, m = B.me, c = B.camera
    const v = { x: m.x + 0.5, y: B.world.groundAt(m.x, m.z + 22, 0).h, z: m.z + 22 }
    const P = new c.position.constructor(v.x, v.y, v.z).project(c), r = B.renderer.domElement.getBoundingClientRect()
    return { x: r.left + (P.x + 1) / 2 * r.width, y: r.top + (1 - P.y) / 2 * r.height }
  })
  // 地面にいる時: 道をタップしても地面ワイヤーにならない
  await place(0, 0); await p.waitForTimeout(400)
  let s = await screenOf()
  await p.touchscreen.tap(s.x, s.y); await p.waitForTimeout(250)
  const g0 = await p.evaluate(() => ({ ground: !!(window.__btr.me.rope && window.__btr.me.rope.ground) }))
  ok(!g0.ground, `${tag} 地面にいる時は道をタップしても地面に掛からない`, JSON.stringify(s))
  // 空中: 道をタップ → 地面ワイヤー
  await place(16, 8); await p.waitForTimeout(60)
  s = await screenOf()
  await p.touchscreen.tap(s.x, s.y)
  let got = false, v0 = null, vMax = 0, released = false
  for (let i = 0; i < 60; i++) {
    const st = await p.evaluate(() => { const m = window.__btr.me; return { g: !!(m.rope && m.rope.ground), v: Math.hypot(m.vx, m.vy, m.vz), y: m.y } })
    if (st.g) { if (!got) { v0 = st.v; await p.screenshot({ path: OUT + tag + '-attach.png' }) } got = true; vMax = Math.max(vMax, st.v); if (st.v > v0 + 6 && !released) await p.screenshot({ path: OUT + tag + '-groundwire.png' }) }
    else if (got) { released = true; break }
    await p.waitForTimeout(30)
  }
  ok(got && vMax > v0 + 4 && released, `${tag} 空中で道をタップすると地面ワイヤーで加速して外れる`, `v ${v0 && v0.toFixed(1)}→${vMax.toFixed(1)} tap=${Math.round(s.x)},${Math.round(s.y)}`)
  await p.waitForTimeout(150)
  await p.screenshot({ path: OUT + tag + '-after.png' })
  ok(await p.evaluate(() => window.__muteOk ? window.__muteOk() : true), `${tag} 無音`)
  ok(!errs.length, `${tag} エラー0`, errs.slice(0, 2).join(' | '))
  await ctx.close()
}
await b.close(); srv.close()
console.log(bad ? `NG ${bad}件` : '全部OK')
process.exit(bad ? 1 : 0)

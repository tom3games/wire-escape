// OGP 画像（1200x630）を実際のゲーム画面から作る。node tools/og.mjs
// 大通りの上をワイヤーでスイングする人と、下を走って追う警官を止めて撮り、左に文字をのせる
import { chromium } from 'playwright'
import { serveStatic } from './static.mjs'
const srv = await serveStatic(5193)
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, locale: 'ja-JP' })
await p.goto('http://localhost:5193/')
await p.waitForFunction(() => window.__btrReady)
await p.evaluate(() => { window.__btr.profile.cpu = 4; window.__btr.startOffline('robber') })
await p.waitForTimeout(5200)
// 大通り（交差点 4,4 から北）で、走ってワイヤーを掛けさせる
await p.evaluate(() => {
  const B = window.__btr, n = B.race.nav.list.find(n => n.i === 4 && n.j === 4), m = B.me
  Object.assign(m, { x: n.x + 2, z: n.z, y: 0, yaw: 0, vx: 0, vy: 0, vz: 10, rope: null })
  B.race.cops.forEach((e, i) => { Object.assign(e.car, { x: n.x + (i % 2 ? 4 : -4), z: n.z - 20 - i * 9, yaw: 0, vx: 0, vz: 30 }) })
})
await p.keyboard.down('KeyW')
await p.waitForTimeout(500)
let shotOk = false
for (let i = 0; i < 30 && !shotOk; i++) {
  await p.keyboard.down('KeyE'); await p.waitForTimeout(60); await p.keyboard.up('KeyE')
  for (let k = 0; k < 10; k++) {
    await p.waitForTimeout(70)
    const s = await p.evaluate(() => { const m = window.__btr.me; return { rope: !!m.rope, y: m.y, vy: m.vy } })
    if (s.rope && s.y > 9 && s.y < 20) { shotOk = true; break }
  }
}
await p.evaluate(() => {
  const B = window.__btr, m = B.me
  B.setPaused(true)
  // 警察を人の下・後ろの道に並べる（追っている絵）
  const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw)
  B.race.cops.forEach((e, i) => { const gy = B.world.groundAt(m.x, m.z, 1).h; Object.assign(e.car, { x: m.x - fx * (9 + i * 3.5) + (i % 2 ? 2.2 : -2.2) * fz, y: gy, z: m.z - fz * (9 + i * 3.5) - (i % 2 ? 2.2 : -2.2) * fx, yaw: m.yaw, vx: fx * 10, vz: fz * 10, grounded: true, rope: null }) })
  window.__freeze = true
  // 人の前・斜め下から振り返って撮る（人は画面の右寄り、後ろの道に追ってくるパトカー）
  const sx = fz, sz = -fx // 人の右（+x が左の座標なので右は (cos,-sin)）
  B.camera.position.set(m.x + fx * 6.5 - sx * 1.5, m.y - 0.8, m.z + fz * 6.5 - sz * 1.5)
  B.camera.lookAt(m.x - fx * 6 - sx * 3.2, m.y - 1.6, m.z - fz * 6 - sz * 3.2)
  B.camera.fov = 70; B.camera.updateProjectionMatrix()
})
await p.waitForTimeout(800)
await p.addStyleTag({ content: `#hud,#touch{display:none!important} .og{position:fixed;left:52px;top:70px;z-index:50;font-family:'Dela Gothic One',sans-serif;color:#fff;line-height:.92;text-shadow:0 6px 0 rgba(0,0,0,.4)} .og b{display:block;font-size:104px;color:#ff5a1f;font-weight:400} .og i{display:block;font-style:normal;font-size:104px} .og s{display:inline-block;text-decoration:none;font-size:30px;margin-top:18px;font-family:'M PLUS 1p',sans-serif;font-weight:800;background:#f2c230;color:#14161a;padding:8px 16px} .og u{display:block;width:max-content;text-decoration:none;font-size:24px;margin:12px 0 0;font-family:'M PLUS 1p',sans-serif;font-weight:800;background:#14161a;color:#fff;padding:8px 14px} .og-h{position:fixed;left:52px;top:42px;width:220px;height:14px;background:repeating-linear-gradient(-45deg,#f2c230 0 12px,#14161a 12px 24px);z-index:50}` })
await p.evaluate(() => { const d = document.createElement('div'); d.className = 'og'; d.innerHTML = '<b>WIRE</b><i>ESCAPE</i><s>ワイヤーで、街ごと振り切れ。</s><u>地上で捕まれば終わり</u>'; document.body.appendChild(d); const h = document.createElement('div'); h.className = 'og-h'; document.body.appendChild(h) })
await p.waitForTimeout(500)
await p.screenshot({ path: new URL('../public/og.jpg', import.meta.url).pathname, type: 'jpeg', quality: 86 })
console.log('ワイヤー中に撮れた', shotOk)
await b.close(); srv.close()

// 場面を作って止めて撮る: 落とし穴（予告・開いた・落ちた）・飛んでくるネット・捕まった網・ダウン・踏みつけ前・結果（逃げ切り・逮捕）
import { chromium } from 'playwright'
import { serveStatic } from './static.mjs'
import { mkdir } from 'node:fs/promises'
const OUT = new URL('../shots/scenes/', import.meta.url).pathname
await mkdir(OUT, { recursive: true })
const srv = await serveStatic(5199)
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, locale: 'ja-JP' })).newPage()
const errs = []
p.on('pageerror', e => errs.push(e.message))
p.on('console', m => { if (m.type() === 'error' && !/healthz|fonts|404/.test(m.text())) errs.push(m.text()) })
await p.goto('http://localhost:5199/')
await p.waitForFunction(() => window.__btrReady)
await p.click('#btnOffline')
await p.waitForTimeout(5500)
const place = () => p.evaluate(() => {
  const B = window.__btr, n = B.race.nav.list.find(n => n.i === 4 && n.j === 4), m = B.me
  Object.assign(m, { x: n.x, z: n.z, y: 0, yaw: 0, vx: 0, vy: 0, vz: 0, rope: null, net: 0, pit: 0, wreck: 0, stun: 0, freeze: 0, grounded: true, sneaking: false })
  B.race.pits = []; B.race.nets = []; B.race.nextPit = B.race.t + 60; B.race.nextNet = B.race.t + 60
  // 警察を遠ざける（場面に集中）
  for (const e of B.race.cops) { e.car.x = n.x + 200; e.car.z = n.z - 200 }
  return { x: n.x, z: n.z }
})
const shot = async (name, fn, wait = 500) => { await p.evaluate(fn); await p.waitForTimeout(wait); await p.screenshot({ path: OUT + name + '.png' }) }
let o = await place()
await p.waitForTimeout(400)
// 落とし穴: 前に開いた穴、その先に予告
await shot('pits', () => { const B = window.__btr, m = B.me, r = B.race; r.pits = [{ id: 1, x: m.x, y: 0, z: m.z + 9, r: 3.2, open: true, at: r.t - 1, until: r.t + 6 }, { id: 2, x: m.x + 4, y: 0, z: m.z + 22, r: 3.2, open: false, at: r.t + 0.6, until: r.t + 8 }]; B.setPaused(true) }, 400)
await p.evaluate(() => window.__btr.setPaused(false))
// 落ちた
await shot('pit-fall', () => { const B = window.__btr, m = B.me, r = B.race; r.pits = [{ id: 3, x: m.x, y: 0, z: m.z, r: 3.2, open: true, at: r.t - 1, until: r.t + 6 }]; m.pit = 2; m.pitAt = { x: m.x, y: 0, z: m.z } }, 700)
await place()
// 飛んでくるネット
await shot('net-fly', () => { const B = window.__btr, m = B.me, r = B.race; r.nets = [{ id: 9, by: 'bot0', x: m.x + 3, y: 1.5, z: m.z + 10, vx: 0, vy: 0, vz: -1, at: r.t - 0.4, done: false }]; B.setPaused(true) }, 400)
await p.evaluate(() => { window.__btr.race.nets = []; window.__btr.setPaused(false) })
await shot('netted', () => { const m = window.__btr.me; m.net = 2.5 }, 600)
await place()
await shot('down', () => { const m = window.__btr.me; m.wreck = 2.5 }, 900)
await place()
// HUD の速さが出るか（走らせて撮る）
await p.keyboard.down('KeyW'); await p.waitForTimeout(1200)
const spd = await p.evaluate(() => { const el = document.getElementById('hSpeed'); return { text: el.textContent, op: getComputedStyle(el).opacity } })
await p.screenshot({ path: OUT + 'run.png' }); await p.keyboard.up('KeyW')
// 通行人: 近くに3人（歩く・気づきかけ・叫んでいる）
await place()
await p.waitForTimeout(600)
await shot('peds', () => {
  const B = window.__btr, m = B.me, P = B.race.peds
  if (!P) return
  const L = P.list.filter(q => q.state !== 'off').slice(0, 3)
  const set = [[4, 10, 'walk', 0], [-3, 12, 'walk', 0.7], [6, 16, 'scream', 0]]
  L.forEach((q, i) => { const [dx, dz, st, sus] = set[i]; Object.assign(q, { x: m.x + dx, z: m.z + dz, y: 0, state: st, sus, t: 0, yaw: Math.PI }) })
  B.setPaused(true)
}, 400)
await p.evaluate(() => window.__btr.setPaused(false))
const pedInfo = await p.evaluate(() => { const P = window.__btr.race.peds; return P ? { alive: P.alive, calls: P.calls } : null })
console.log('peds', JSON.stringify(pedInfo))
// しゃがみ歩き
await place()
await p.keyboard.press('KeyX')
await p.keyboard.down('KeyW'); await p.waitForTimeout(700)
await p.screenshot({ path: OUT + 'sneak.png' })
const sn = await p.evaluate(() => ({ sneaking: window.__btr.me.sneaking, v: Math.hypot(window.__btr.me.vx, window.__btr.me.vz) }))
await p.keyboard.up('KeyW'); await p.keyboard.press('KeyX')
console.log('sneak', JSON.stringify(sn))
// 結果: 逃げ切り
await p.evaluate(() => { const r = window.__btr.race; r.robbers[0].escaped = true; r.finish('robber', 'time', 'me') })
await p.waitForTimeout(3600)
await p.screenshot({ path: OUT + 'result-escape.png' })
await p.click('#btnAgain')
await p.waitForTimeout(5500)
await p.evaluate(() => { const r = window.__btr.race; r.arrest(r.robbers[0], 'bust', r.cops[0].id) })
await p.waitForTimeout(3600)
await p.screenshot({ path: OUT + 'result-bust.png' })
console.log('speed', JSON.stringify(spd))
console.log(errs.length ? 'エラー: ' + errs.join(' | ') : 'エラー 0')
await b.close(); srv.close()

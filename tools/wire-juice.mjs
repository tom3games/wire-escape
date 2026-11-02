// 迫力の演出（空中しっぽ取り v5 から移植）を実画面で起こして確かめる。音は鳴らさない（mute.mjs）
// 速さの線・視野・傾き・風の環境音・速く離した風切り・山場（振り切った/踏みつけ/ネットを抜けた）のヒットストップと光
//   node tools/wire-juice.mjs [webkit]   → shots/juice/wire-*.png
import { chromium, webkit } from 'playwright'
import { muteContext, MUTE_LAUNCH } from './mute.mjs'
import { serveStatic } from './static.mjs'
import { mkdir } from 'node:fs/promises'
const OUT = new URL('../shots/juice/', import.meta.url).pathname
await mkdir(OUT, { recursive: true })
const srv = await serveStatic(5196)
const useWk = process.argv.includes('webkit')
const engine = useWk ? webkit : chromium
const b = await engine.launch(useWk ? {} : { args: [...MUTE_LAUNCH.args, '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const good = [], bad = []
const ok = (c, name, info = '') => (c ? good : bad).push(`${c ? 'OK' : 'NG'}  ${name}  ${info}`)
for (const [w, h] of [[390, 844], [844, 390]]) {
  const tag = `${engine.name()}-${w}x${h}`
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: useWk ? undefined : true, locale: 'ja-JP' })
  await muteContext(ctx)
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/healthz|fonts|404/.test(m.text())) errs.push(m.text()) })
  p.on('requestfailed', r => { if (!/healthz|fonts/.test(r.url())) errs.push('fail ' + r.url()) })
  await p.goto('http://localhost:5196/?v=' + Date.now())
  await p.waitForFunction(() => window.__btrReady, null, { timeout: 60000 })
  await p.tap('#btnOffline')
  await p.waitForTimeout(5300)
  // 1) 実際にワイヤーで振る（キーボードの E = 前の上へ自動）。速さの線・視野・傾きの最大を数える
  const sw = await p.evaluate(async () => {
    const B = window.__btr, me = B.me, sleep = ms => new Promise(f => setTimeout(f, ms))
    const n = B.race.nav.list.find(n => n.i === 4 && n.j === 4)
    Object.assign(me, { x: n.x, z: n.z, y: 0, yaw: 0, vx: 0, vz: 8 })
    const kd = c => window.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c })), ku = c => window.dispatchEvent(new KeyboardEvent('keyup', { code: c, key: c }))
    kd('KeyW')
    let maxK = 0, maxBank = 0, maxFov = 0, minFov = 999, maxV = 0, ropes = 0
    for (let i = 0; i < 40; i++) {
      if (!me.rope && i % 3 === 0) { kd('KeyE'); await sleep(60); ku('KeyE') }
      await sleep(120)
      const v = Math.hypot(me.vx, me.vy, me.vz)
      maxV = Math.max(maxV, v); maxK = Math.max(maxK, window.__speedK || 0); maxBank = Math.max(maxBank, Math.abs(B.camBank)); if (me.rope) ropes++
      maxFov = Math.max(maxFov, B.camera.fov); minFov = Math.min(minFov, B.camera.fov)
    }
    ku('KeyW')
    return { maxV: +maxV.toFixed(1), maxK: +maxK.toFixed(2), maxBank: +maxBank.toFixed(3), fov: [+minFov.toFixed(1), +maxFov.toFixed(1)], ropes, wind: window.__sfxCalls['loop:wind'] || 0 }
  })
  ok(sw.ropes > 5, tag + ' ワイヤーで振れている', JSON.stringify(sw))
  ok(sw.maxBank > 0.02 && sw.maxBank <= 0.1001, tag + ' 振り子で少し傾く（最大0.1rad）', 'bank ' + sw.maxBank)
  ok(sw.wind > 0, tag + ' 風の環境音（録音のループ）が回っている', 'loop:wind ' + sw.wind)
  // 2) 速く飛んでいる場面: 空中で 36m/s にして流れる線と視野を見る（撮る）
  const fast = await p.evaluate(async () => {
    const B = window.__btr, me = B.me, sleep = ms => new Promise(f => setTimeout(f, ms))
    const f0 = B.camera.fov
    for (let i = 0; i < 14; i++) { me.y = Math.max(me.y, 40); const h = Math.atan2(me.vx, me.vz) || me.yaw; me.vx = Math.sin(me.yaw) * 36; me.vz = Math.cos(me.yaw) * 36; me.vy = 0; await sleep(50) }
    await new Promise(r => requestAnimationFrame(r))
    const c = document.getElementById('speedfx'), g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let px = 0; for (let i = 3; i < g.length; i += 16) if (g[i] > 10) px++
    return { k: window.__speedK, fov: B.camera.fov, f0, px }
  })
  await p.screenshot({ path: `${OUT}wire-${tag}-fast.png` })
  ok(fast.k > 0.6, tag + ' 速いと流れる線が出る（20m/s から）', JSON.stringify(fast))
  ok(fast.px > 50, tag + ' 線が canvas に描かれている', 'px ' + fast.px)
  // 3) 速く離す: 風切り（whoosh）と視野の一瞬の動き
  const rel = await p.evaluate(async () => {
    const B = window.__btr, me = B.me, sleep = ms => new Promise(f => setTimeout(f, ms))
    const w0 = window.__sfxCalls.whoosh || 0
    me.events.push({ t: 'unwire', auto: false })   // 手で離したのと同じ出来事（速さ 36m/s のまま）
    me.vx = Math.sin(me.yaw) * 36; me.vz = Math.cos(me.yaw) * 36
    let kick = 0; for (let i = 0; i < 10; i++) { kick = Math.max(kick, B.juice.fovKick); await sleep(16) }
    return { whoosh: (window.__sfxCalls.whoosh || 0) - w0, kick: +kick.toFixed(2) }
  })
  ok(rel.whoosh >= 1 && rel.kick > 2, tag + ' 速く離すと風切り音と視野の一瞬の動き', JSON.stringify(rel))
  // 4) 山場の瞬間: ヒットストップ・光・揺れ
  for (const [name, inject, minStop] of [
    ['lost', 'B.race.events.push({ t: "lost", id: B.myId, combo: 6 })', 0.08],
    ['stomp', 'const cop = B.race.cops[0].car; me.events.push({ t: "stomp", other: cop.id, cop: true, x: me.x, y: me.y, z: me.z })', 0.07],
    ['netFree', 'me.events.push({ t: "netFree" })', 0.03]]) {
    const r = await p.evaluate(async ({ inject }) => {
      const B = window.__btr, me = B.me
      me.y = Math.max(me.y, 30); me.vx = me.vz = 0
      B.juice.stop = 0; B.juice.slow = 0; B.juice.flash = 0; B.fx.shake = 0
      const t0 = B.race.t
      eval(inject)
      let stop = 0, flash = 0, shake = 0, kick = 0, frames = 0
      await new Promise(res => { const st = performance.now(); const f = () => { frames++; stop = Math.max(stop, B.juice.stop); flash = Math.max(flash, +document.getElementById('hitflash').style.opacity || 0); shake = Math.max(shake, B.fx.shake); kick = Math.max(kick, Math.abs(B.juice.fovKick)); if (performance.now() - st < 400) requestAnimationFrame(f); else res() }; requestAnimationFrame(f) })
      return { stop: +stop.toFixed(3), flash, shake: +shake.toFixed(2), kick: +kick.toFixed(1) }
    }, { inject })
    if (name === 'lost') { await p.evaluate(() => { const B = window.__btr; B.juice.flash = 1; B.juice.stop = 0.5 }); await p.waitForTimeout(30); await p.screenshot({ path: `${OUT}wire-${tag}-peak.png` }) }
    ok(r.stop >= minStop && r.stop <= 0.12 && r.flash > 0.2 && r.shake > 0.2, `${tag} 山場「${name}」で一瞬止まる・光る・揺れる`, JSON.stringify(r))
  }
  const mute = await p.evaluate(() => window.__muteOk ? window.__muteOk() : null)
  ok(mute === true, tag + ' テスト中は無音（__muteOk）', String(mute))
  ok(!errs.length, tag + ' エラー 0', errs.slice(0, 3).join(' | '))
  await ctx.close()
}
await b.close(); srv.close()
console.log([...good, ...bad].join('\n'))
console.log(`${good.length} OK / ${bad.length} NG`)
process.exit(bad.length ? 1 : 0)

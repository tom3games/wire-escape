// iPhone 相当（webkit・タッチ）で 6 サイズ: タイトルが一画面、タッチのボタンで 走る→ワイヤー→巻き取り、
// ボタンと表示がはみ出さず重ならない、エラー0。拡大止めも確かめる
import { webkit } from 'playwright'
import { serveStatic } from './static.mjs'
import { mkdir } from 'node:fs/promises'
const OUT = new URL('../shots/mobile/', import.meta.url).pathname
await mkdir(OUT, { recursive: true })
const srv = await serveStatic(5198)
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const bad = [], good = []
const ok = (c, l, d = '') => (c ? good : bad).push(`${c ? 'OK' : 'NG'}  ${l}  ${d}`)
const sizes = [[360, 640], [390, 844], [844, 390], [667, 375], [768, 1024], [1440, 900]]
for (const [w, h] of sizes) {
  const b = await webkit.launch()
  const touchDev = w < 1000
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: touchDev, userAgent: touchDev ? UA : undefined, locale: 'ja-JP' })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message))
  p.on('console', m => { if (m.type() === 'error' && !/healthz|fonts|404/.test(m.text())) errs.push(m.text()) })
  const tag = `webkit-${w}x${h}`
  await p.goto('http://localhost:5198/')
  await p.waitForFunction(() => window.__btrReady, null, { timeout: 60000 }).catch(() => errs.push('not ready'))
  await p.waitForTimeout(1500)
  const fit = await p.evaluate(() => {
    const ids = ['btnOffline', 'btnHowto', 'nameInput', 'cpuSelect', 'btnLang', 'btnMute']
    const cut = ids.filter(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.bottom > innerHeight + 1 || r.right > innerWidth + 1 || r.height < 10 })
    return { cut, scroll: document.documentElement.scrollHeight > innerHeight + 1 }
  })
  ok(!fit.cut.length && !fit.scroll, tag + ' タイトルが一画面', JSON.stringify(fit))
  await p.screenshot({ path: OUT + tag + '-title.png' })
  // 遊び方も一画面か（中身はパネルの中でスクロールしてよい）
  if (touchDev) await p.tap('#btnHowto'); else await p.click('#btnHowto')
  await p.waitForTimeout(400)
  const hw = await p.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)
  ok(hw, tag + ' 遊び方がページの上下スクロールなし')
  await p.screenshot({ path: OUT + tag + '-howto.png' })
  await p.evaluate(() => document.querySelector('#howto [data-back]').click())
  await p.waitForTimeout(300)
  if (touchDev) await p.tap('#btnOffline'); else await p.click('#btnOffline')
  await p.waitForTimeout(5000)
  if (touchDev) {
    const press = (sel, type) => p.evaluate(([sel, type]) => {
      const el = document.querySelector(sel); const r = el.getBoundingClientRect()
      el.dispatchEvent(new PointerEvent(type, { pointerId: sel.length, pointerType: 'touch', bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }))
    }, [sel, type])
    const vis = await p.evaluate(() => !document.getElementById('touch').classList.contains('hidden'))
    ok(vis, tag + ' タッチ操作が出る')
    const p0 = await p.evaluate(() => ({ x: window.__btr.me.x, z: window.__btr.me.z }))
    await p.waitForTimeout(1500) // 走るはスイッチ式で最初から入っている
    const moved = await p.evaluate(p0 => Math.hypot(window.__btr.me.x - p0.x, window.__btr.me.z - p0.z), p0)
    ok(moved > 8, tag + ' 走るスイッチで進む', moved.toFixed(1) + 'm')
    // ワイヤーは前に建物が無いと掛からない（スタート地点は毎回ちがう）。大通りの交差点から北向きで試す
    await p.evaluate(() => { const n = window.__btr.race.nav.list.find(n => n.i === 4 && n.j === 4); const m = window.__btr.me; m.x = n.x; m.z = n.z; m.y = 0; m.yaw = 0; m.vx = 0; m.vz = 6; m.rope = null; m.net = 0; m.pit = 0; m.stun = 0 })
    await p.waitForTimeout(300)
    const miss = []
    let roped = false
    for (let i = 0; i < 5 && !roped; i++) {
      await press('[data-k=wire]', 'pointerdown'); await p.waitForTimeout(60); await press('[data-k=wire]', 'pointerup')
      await p.waitForTimeout(250)
      roped = await p.evaluate(() => !!window.__btr.me.rope)
      if (!roped) miss.push(await p.evaluate(() => { const m = window.__btr.me; return `${m.x.toFixed(0)},${m.z.toFixed(0)} y${m.y.toFixed(1)} net${m.net.toFixed(1)} stun${m.stun.toFixed(1)} wreck${m.wreck.toFixed(1)} frz${m.freeze.toFixed(1)}` }))
    }
    ok(roped, tag + ' ワイヤーボタンで掛かる', miss.join(' / '))
    await p.screenshot({ path: OUT + tag + '-swing.png' })
    await press('[data-k=boost]', 'pointerdown'); await p.waitForTimeout(60); await press('[data-k=boost]', 'pointerup')
    await p.waitForTimeout(150)
    const zipped = await p.evaluate(() => window.__btr.me.zipping || window.__btr.me.zipCd > 0)
    ok(zipped, tag + ' 巻き取りボタンが効く')
    const y0 = await p.evaluate(() => window.__btr.me.yaw)
    await press('[data-k=left]', 'pointerdown'); await p.waitForTimeout(500); await press('[data-k=left]', 'pointerup')
    const y1 = await p.evaluate(() => window.__btr.me.yaw)
    ok(Math.abs(y1 - y0) > 0.3, tag + ' 左ボタンで向きが変わる', (y1 - y0).toFixed(2))
    await press('[data-k=jump]', 'pointerdown'); await p.waitForTimeout(60); await press('[data-k=jump]', 'pointerup')
    const lay = await p.evaluate(() => {
      const rs = ['[data-k=left]', '[data-k=right]', '[data-k=gas]', '[data-k=brake]', '[data-k=boost]', '[data-k=jump]', '[data-k=wire]', '[data-k=pause]', '[data-k=cam]', '[data-k=respawn]', '#miniMap', '.hud-br', '.hud-tl', '.hud-top', '.hud-bl'].map(s => [s, document.querySelector(s).getBoundingClientRect()])
      const out = rs.filter(([, r]) => r.width && (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1)).map(([s]) => s)
      const ov = []
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const a = rs[i][1], c = rs[j][1]; if (a.width && c.width && a.left < c.right - 2 && c.left < a.right - 2 && a.top < c.bottom - 2 && c.top < a.bottom - 2) ov.push(rs[i][0] + '/' + rs[j][0]) }
      const small = rs.filter(([s, r]) => s.startsWith('[data-k') && r.width && (r.width < 40 || r.height < 36)).map(([s, r]) => s + ':' + Math.round(r.width) + 'x' + Math.round(r.height))
      return { out, ov, small }
    })
    ok(!lay.out.length && !lay.ov.length && !lay.small.length, tag + ' ボタンと表示がはみ出さず重ならず小さすぎない', JSON.stringify(lay))
    // 拡大止め
    const vp = await p.evaluate(() => document.querySelector('meta[name=viewport]').content)
    ok(/user-scalable=no/.test(vp), tag + ' 拡大止め')
  }
  const scroll = await p.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1)
  ok(scroll, tag + ' プレイ中も上下左右スクロールなし')
  await p.screenshot({ path: OUT + tag + '-race.png' })
  ok(!errs.length, tag + ' エラー0', errs.join(' | '))
  await b.close()
}
srv.close()
console.log(good.join('\n')); console.log(bad.join('\n'))
console.log(bad.length ? `NG ${bad.length}` : `全部OK ${good.length}`)

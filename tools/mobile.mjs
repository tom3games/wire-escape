// iPhone 相当（webkit・タッチ）で、横持ちと縦持ちを実際に操作する。
// 読み込みの量、タイトル→レース、アクセルを押して進むか、ハンドルで曲がるか、はみ出し、エラーを見る。
import { webkit, chromium } from 'playwright'
import { serveStatic } from './static.mjs'
import { mkdir } from 'node:fs/promises'
const OUT = new URL('../shots/mobile/', import.meta.url).pathname
await mkdir(OUT, { recursive: true })
const srv = await serveStatic(5195)
const URL0 = process.argv.find(a => a.startsWith('http')) || 'http://localhost:5195/'
const bad = [], good = []
const ok = (c, l, d = '') => (c ? good : bad).push(`${c ? 'OK' : 'NG'}  ${l}  ${d}`)
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
for (const engine of process.argv.includes('--all') ? [webkit, chromium] : [webkit]) for (const [w, h] of [[844, 390], [844, 340], [667, 320], [568, 320], [932, 360], [390, 844], [375, 667]]) {
  const b = await engine.launch(engine === chromium ? { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : {})
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: engine === chromium ? true : undefined, hasTouch: true, userAgent: UA, locale: 'ja-JP' })
  const p = await ctx.newPage()
  const errs = []; let bytes = 0
  p.on('pageerror', e => errs.push(e.message))
  p.on('console', m => { if (m.type() === 'error' && !/404|healthz|fonts|ERR_CONNECTION/.test(m.text())) errs.push(m.text()) })
  p.on('response', async r => { try { const l = Number(r.headers()['content-length'] || 0) || (await r.body()).length; bytes += l } catch {} })
  const tag = `${engine.name()}-${w}x${h}`
  const t0 = Date.now()
  await p.goto(URL0)
  await p.waitForFunction(() => window.__btrReady, null, { timeout: 60000 }).catch(() => errs.push('not ready'))
  const readyMs = Date.now() - t0
  await p.waitForTimeout(1500)
  const fit = await p.evaluate(() => {
    const ids = ['btnOffline', 'btnOnline', 'btnGarage', 'btnHowto', 'nameInput', 'cpuSelect']
    const cut = ids.filter(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.bottom > innerHeight + 1 || r.right > innerWidth + 1 || r.height < 10 })
    const c = document.querySelector('.title-card')
    return { cut, inner: c.scrollHeight > c.clientHeight + 2, scroll: document.documentElement.scrollHeight > innerHeight + 1 }
  })
  ok(!fit.cut.length && !fit.inner && !fit.scroll, tag + ' タイトルが一画面に収まり、ボタンが全部見える', JSON.stringify(fit))
  await p.screenshot({ path: OUT + tag + '-title.png' })
  await p.tap('#btnOffline')
  await p.waitForTimeout(5200)
  const vis = await p.evaluate(() => !document.getElementById('touch').classList.contains('hidden'))
  ok(vis, tag + ' タッチ操作が出る')
  // アクセルを押し続け、2秒後にハンドルを右へ
  const press = (sel, type, x, y) => p.evaluate(([sel, type, x, y]) => {
    const el = document.querySelector(sel); const r = el.getBoundingClientRect()
    el.dispatchEvent(new PointerEvent(type, { pointerId: sel.length + (type === 'pointermove' ? 0 : 0), pointerType: 'touch', bubbles: true, clientX: x ?? r.left + r.width / 2, clientY: y ?? r.top + r.height / 2 }))
  }, [sel, type, x, y])
  const p0 = await p.evaluate(() => ({ x: window.__btr.me.x, z: window.__btr.me.z }))
  await press('[data-k=gas]', 'pointerdown')
  await p.waitForTimeout(2500)
  const moved = await p.evaluate(p0 => Math.hypot(window.__btr.me.x - p0.x, window.__btr.me.z - p0.z), p0)
  ok(moved > 25, tag + ' アクセルで進む', moved.toFixed(1) + 'm')
  // 開けた直線で試す（スタート直後は CPU やジャンプ台に当たって向きが変わる）
  await p.evaluate(() => window.__btr.teleport(0, 420, 0, 20))
  await p.waitForTimeout(150)
  const yaw0 = await p.evaluate(() => window.__btr.me.yaw)
  await press('[data-k=right]', 'pointerdown')
  await p.waitForTimeout(700)
  const yaw1 = await p.evaluate(() => window.__btr.me.yaw)
  ok(yaw1 < yaw0 - 0.2, tag + ' 右ボタンで右へ曲がる', `${yaw0.toFixed(2)} -> ${yaw1.toFixed(2)}`)
  await p.screenshot({ path: OUT + tag + '-race.png' })
  await press('[data-k=right]', 'pointerup')
  await press('[data-k=gas]', 'pointerup')
  // カメラボタン: 押すたびに 近い→引き→ボンネット→近い と切り替わり、画面の視点も動く
  const cams = []
  for (let i = 0; i < 3; i++) {
    const before = await p.evaluate(() => ({ m: window.__btr.camMode, x: window.__btr.camera.position.x, y: window.__btr.camera.position.y, z: window.__btr.camera.position.z }))
    await press('[data-k=cam]', 'pointerdown'); await press('[data-k=cam]', 'pointerup')
    await p.waitForTimeout(500)
    const after = await p.evaluate(() => { const c = window.__btr.camera.position, m = window.__btr.me; return { m: window.__btr.camMode, x: c.x, y: c.y, z: c.z, d: Math.hypot(c.x - m.x, c.z - m.z) } })
    cams.push(`${before.m}->${after.m}(${after.d.toFixed(1)}m)`)
    if (after.m !== (before.m + 1) % 3) { cams.push('NG'); break }
  }
  ok(!cams.includes('NG') && cams.length === 3, tag + ' カメラボタンで視点が3通り切り替わる', cams.join(' '))
  // 操作部品が画面からはみ出していないか・重なっていないか
  const lay = await p.evaluate(() => {
    const rs = ['[data-k=left]', '[data-k=right]', '[data-k=gas]', '[data-k=brake]', '[data-k=boost]', '[data-k=drift]', '[data-k=pause]', '[data-k=cam]', '[data-k=respawn]', '#miniMap', '.hud-br', '.hud-tl', '.hud-top'].map(s => [s, document.querySelector(s).getBoundingClientRect()])
    const out = rs.filter(([, r]) => r.width && (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1)).map(([s]) => s)
    const ov = []
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const a = rs[i][1], c = rs[j][1]; if (a.width && c.width && a.left < c.right - 2 && c.left < a.right - 2 && a.top < c.bottom - 2 && c.top < a.bottom - 2) ov.push(rs[i][0] + '/' + rs[j][0]) }
    return { out, ov }
  })
  ok(!lay.out.length && !lay.ov.length, tag + ' 操作と表示がはみ出さず重ならない', JSON.stringify(lay))
  const mapOn = await p.evaluate(() => { const r = document.getElementById('miniMap').getBoundingClientRect(); return r.width > 40 && getComputedStyle(document.getElementById('miniMap')).display !== 'none' })
  ok(mapOn, tag + ' 小地図が出ている')
  const fps = await p.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(n / 2) }; requestAnimationFrame(f) }))
  good.push(`    ${tag} 読み込み ${(bytes / 1e6).toFixed(1)}MB / 起動 ${readyMs}ms / fps ${fps}（この Mac のエミュレーション）`)
  ok(!errs.length, tag + ' エラー 0', errs.slice(0, 3).join(' | '))
  await b.close()
}
console.log(good.join('\n')); console.log(bad.length ? bad.join('\n') : 'ALL OK')
srv.close()

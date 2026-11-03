// iPhone 相当（webkit・タッチ）で 6 サイズ: タイトルが一画面、タッチのボタンで 走る→ワイヤー（巻き取りは無し）、
// ボタンと表示がはみ出さず重ならない、エラー0。拡大止めも確かめる
import { webkit } from 'playwright'
import { muteContext, MUTE_LAUNCH } from './mute.mjs'
import { serveStatic } from './static.mjs'
import { mkdir } from 'node:fs/promises'
const OUT = new URL('../shots/mobile/', import.meta.url).pathname
await mkdir(OUT, { recursive: true })
const srv = await serveStatic(5198)
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const bad = [], good = []
const ok = (c, l, d = '') => (c ? good : bad).push(`${c ? 'OK' : 'NG'}  ${l}  ${d}`)
const stickInfo = {}
const sizes = [[360, 640], [390, 844], [844, 390], [667, 375], [768, 1024], [1440, 900]]
for (const [w, h] of sizes) {
  const b = await webkit.launch()
  const touchDev = w < 1000
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: touchDev, userAgent: touchDev ? UA : undefined, locale: 'ja-JP' })
  await muteContext(ctx)
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
    // 左手のスティック: 触って上へ倒すと走る
    // スティックは左下に固定（2026-11-03 本人「左スティックは固定で」）。中心から dx,dy の所を触る
    const stick = (type, dx, dy, id = 77) => p.evaluate(([type, dx, dy, id]) => {
      const b = document.getElementById('stickBase').getBoundingClientRect()
      const x = b.left + b.width / 2 + dx, y = b.top + b.height / 2 + dy
      const el = document.elementFromPoint(Math.max(1, Math.min(innerWidth - 1, x)), Math.max(1, Math.min(innerHeight - 1, y))) || document.body
      el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', bubbles: true, buttons: type === 'pointerup' ? 0 : 1, pressure: type === 'pointerup' ? 0 : 0.5, clientX: x, clientY: y }))
    }, [type, dx, dy, id])
    const st = () => p.evaluate(() => { const b = document.getElementById('stickBase').getBoundingClientRect(), S = window.__btr.touch.stick; return { cx: Math.round(b.left + b.width / 2), cy: Math.round(b.top + b.height / 2), d: Math.round(b.width), id: S.id, mag: +S.mag.toFixed(2) } })
    {
      const s0 = await st()
      // 円の外の遠い所（左の中ほど）を触っても出てこない・動かない
      await stick('pointerdown', 110, -170, 91); await p.waitForTimeout(50)
      const s1 = await st()
      await stick('pointerup', 110, -170, 91)
      ok(s1.id == null && s1.mag === 0 && s1.cx === s0.cx && s1.cy === s0.cy, tag + ' スティックは固定（遠い所を触っても出ない・動かない）', JSON.stringify({ s0, s1 }))
      // 円の少し外（半径×1.3）を触ると反応する
      await stick('pointerdown', s0.d / 2 * 1.3, 0, 92); await p.waitForTimeout(30)
      const s2 = await st(); await stick('pointerup', s0.d / 2 * 1.3, 0, 92)
      ok(s2.id === 92 && s2.mag > 0.9 && s2.cx === s0.cx, tag + ' 円の少し外から触っても反応（中心は動かない）', JSON.stringify(s2))
      // 外から指をすべらせて入ったら、入った時点から倒した扱い
      await stick('pointerdown', s0.d * 1.6, -s0.d * 1.2, 93); await stick('pointermove', s0.d * 0.45, -s0.d * 0.35, 93); await p.waitForTimeout(30)
      const s3 = await st(); await stick('pointerup', s0.d * 0.45, -s0.d * 0.35, 93)
      ok(s3.id === 93 && s3.mag > 0.8, tag + ' 外からすべらせて入ると倒した扱い', JSON.stringify(s3))
      stickInfo[tag] = { center: [s0.cx, s0.cy], diameter: s0.d, fromLeft: s0.cx - s0.d / 2, fromBottom: (await p.evaluate(() => innerHeight)) - (s0.cy + s0.d / 2) }
    }
    const p0 = await p.evaluate(() => ({ x: window.__btr.me.x, z: window.__btr.me.z }))
    await stick('pointerdown', 0, 0); await stick('pointermove', 0, -60)
    await p.waitForTimeout(1500)
    const moved = await p.evaluate(p0 => Math.hypot(window.__btr.me.x - p0.x, window.__btr.me.z - p0.z), p0)
    ok(moved > 8, tag + ' スティックを倒すと走る', moved.toFixed(1) + 'm')
    // 向きの確かめは空いた通りで（車・タックル・ネットでよろけていると向きが変わらない）
    await p.evaluate(() => { const B = window.__btr, n = B.race.nav.list.find(n => n.i === 4 && n.j === 4), m = B.me; Object.assign(m, { x: n.x, z: n.z, y: 0, stun: 0, net: 0, pit: 0, wreck: 0, rope: null, climbing: null }); B.race.nets = []; B.race.pits = [] })
    const yawA = await p.evaluate(() => window.__btr.me.yaw)
    await stick('pointermove', 60, 0); await p.waitForTimeout(500)
    const yawB = await p.evaluate(() => window.__btr.me.yaw)
    ok(yawB < yawA - 0.3, tag + ' スティックを右へ倒すと右へ向く', (yawB - yawA).toFixed(2))
    await stick('pointerup', 60, 0)
    // ワイヤーは前に建物が無いと掛からない（スタート地点は毎回ちがう）。大通りの交差点から北向きで試す
    await p.evaluate(() => { const n = window.__btr.race.nav.list.find(n => n.i === 4 && n.j === 4); const m = window.__btr.me; m.x = n.x; m.z = n.z; m.y = 0; m.yaw = 0; m.vx = 0; m.vz = 6; m.rope = null; m.net = 0; m.pit = 0; m.stun = 0 })
    await p.waitForTimeout(300)
    const miss = []
    let roped = false
    // 画面の左上（左の建物）をタッチしてワイヤー
    const tapView = (fx, fy) => p.evaluate(([fx, fy]) => { const c = document.querySelector('#view canvas'); for (const type of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(type, { pointerId: 88, pointerType: 'touch', bubbles: true, clientX: innerWidth * fx, clientY: innerHeight * fy })) }, [fx, fy])
    // なぞるとカメラが回り、ワイヤーは出ない
    const hd0 = await p.evaluate(() => window.__btr.camHd)
    await p.evaluate(() => { const c = document.querySelector('#view canvas'); const y = innerHeight * 0.4; c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 89, pointerType: 'touch', bubbles: true, clientX: innerWidth * 0.6, clientY: y })); for (let i = 1; i <= 8; i++) c.dispatchEvent(new PointerEvent('pointermove', { pointerId: 89, pointerType: 'touch', bubbles: true, clientX: innerWidth * 0.6 + i * 15, clientY: y })); c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 89, pointerType: 'touch', bubbles: true, clientX: innerWidth * 0.6 + 120, clientY: y })) })
    await p.waitForTimeout(300)
    const sw = await p.evaluate(hd0 => ({ turned: window.__btr.camHd - hd0, rope: !!window.__btr.me.rope }), hd0)
    ok(sw.turned < -0.4 && !sw.rope, tag + ' 右へなぞるとカメラが右へ回り、ワイヤーは出ない', JSON.stringify(sw))
    await p.evaluate(hd0 => { const B = window.__btr; B.me.yaw = 0 }, hd0)
    await p.evaluate(() => window.__btr.snapCam())
    await p.waitForTimeout(200)
    for (let i = 0; i < 3 && !roped; i++) { await tapView(0.12, 0.25); await p.waitForTimeout(250); roped = await p.evaluate(() => !!window.__btr.me.rope) }
    const leftSide = roped && await p.evaluate(() => { const m = window.__btr.me; return (m.rope.x - m.x) * Math.cos(m.yaw) - (m.rope.z - m.z) * Math.sin(m.yaw) > 0 })
    ok(roped && leftSide, tag + ' 建物をタッチするとその建物（左）にワイヤーが掛かる')
    if (roped) { await tapView(0.5, 0.3); await p.waitForTimeout(200) }
    roped = false
    for (let i = 0; i < 5 && !roped; i++) {
      await press('[data-k=wire]', 'pointerdown'); await p.waitForTimeout(60); await press('[data-k=wire]', 'pointerup')
      await p.waitForTimeout(250)
      roped = await p.evaluate(() => !!window.__btr.me.rope)
      if (!roped) miss.push(await p.evaluate(() => { const m = window.__btr.me; return `${m.x.toFixed(0)},${m.z.toFixed(0)} y${m.y.toFixed(1)} net${m.net.toFixed(1)} stun${m.stun.toFixed(1)} wreck${m.wreck.toFixed(1)} frz${m.freeze.toFixed(1)}` }))
    }
    ok(roped, tag + ' ワイヤーボタンで掛かる', miss.join(' / '))
    await p.screenshot({ path: OUT + tag + '-swing.png' })
    // 巻き取りは無くした（2026-11-02 本人「巻き取りボタンいらん」）: ボタンが見えず、スティックをワイヤーの方へ倒しても引き寄せない
    const noReel = await p.evaluate(() => { const b = document.querySelector('[data-k=boost]'); return !b || !b.offsetParent })
    await stick('pointerdown', 0, 0); await stick('pointermove', 0, -60); await p.waitForTimeout(300)
    const zipped = await p.evaluate(() => window.__btr.me.zipping); await stick('pointerup', 0, 0)
    ok(noReel && !zipped, tag + ' 巻き取りボタンが無く、スティックで巻き取らない')
    const snd = await p.evaluate(() => ({ calls: Object.keys(window.__sfxCalls || {}).length, mute: window.__muteOk ? window.__muteOk() : null }))
    ok(snd.calls > 0 && snd.mute === true, tag + ' 録音の音が呼ばれ、テスト中は無音', JSON.stringify(snd))
    await press('[data-k=jump]', 'pointerdown'); await p.waitForTimeout(60); await press('[data-k=jump]', 'pointerup')
    const lay = await p.evaluate(() => {
      const rs = ['#stickBase', '[data-k=jump]', '[data-k=wire]', '[data-k=sneak]', '[data-k=pause]', '[data-k=cam]', '[data-k=respawn]', '#miniMap', '.hud-br', '.hud-tl', '.hud-top', '.hud-bl'].map(s => [s, document.querySelector(s).getBoundingClientRect()])
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
console.log(JSON.stringify(stickInfo))
console.log(bad.length ? `NG ${bad.length}` : `全部OK ${good.length}`)

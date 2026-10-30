// 修理工場とヘリのランチャーを実ブラウザで起こして確かめる（chromium と webkit、横持ちスマホ相当）。
// node tools/check-repair-heli.mjs   スクショは shots/chase/
import { chromium, webkit } from 'playwright'
import { serveStatic } from './static.mjs'
import { mkdir } from 'node:fs/promises'
const OUT = new URL('../shots/chase/', import.meta.url).pathname
await mkdir(OUT, { recursive: true })
const srv = await serveStatic(5196)
const res = []
const ok = (c, l, d = '') => res.push(`${c ? 'OK' : 'NG'}  ${l}  ${d}`)
for (const [name, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  const b = await bt.launch(name === 'chromium' ? { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : {})
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: name === 'chromium' ? true : undefined, locale: 'ja-JP' })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message))
  p.on('console', m => { if (m.type() === 'error' && !/404|fonts/.test(m.text())) errs.push(m.text()) })
  await p.goto(`http://localhost:5196/?v=${Date.now()}`)
  await p.waitForFunction(() => window.__btrReady, null, { timeout: 60000 })
  await p.evaluate(() => { window.__btr.profile.cpu = 1; window.__btr.startOffline('robber') })
  await p.waitForTimeout(5200)
  // スマホはアクセルが入った状態から始まるので、1回押して切る（止まって待つため）
  await p.evaluate(() => document.querySelector('[data-k=gas]').dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })))
  ok(await p.evaluate(() => !document.querySelector('[data-k=gas]').classList.contains('on')), `${name} アクセルのスイッチを切れる`)
  // 警察 CPU は遠くへ
  const park = () => p.evaluate(() => { const B = window.__btr, r = B.race, s = r.shops[0]; for (const c of r.cops) { c.car.x = s.x; c.car.z = s.z + 400 }; B.teleport(s.x, s.z, 0, 0) })
  await p.evaluate(() => { const m = window.__btr.me; m.dmg.body = 0.3; m.dmg.engine = 0.4 })
  await park()
  for (let i = 0; i < 3; i++) { await p.waitForTimeout(700); await park() }
  await p.screenshot({ path: OUT + `${name}-repairing.png` })
  await p.waitForTimeout(1600)
  const body = await p.evaluate(() => window.__btr.me.dmg.body)
  ok(body === 1, `${name} 修理工場で止まって約3秒で全回復`, `車体 30% → ${Math.round(body * 100)}%`)
  // ヘリ: 手配度を3に
  await p.evaluate(() => { window.__btr.race.heatBonus = 3 }) // 修理で手配度が1下がっているので、3足して星3にする
  const warn = await p.waitForFunction(() => (window.__btr.race.strikes || []).find(s => !s.done), null, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => null)
  ok(!!warn, `${name} 手配度3でヘリが出て、着弾の予告（赤い円）を出す`)
  if (warn) {
    // 当たる: 円の真ん中で止まる
    await p.evaluate(w => { window.__btr.teleport(w.x, w.z, 0, 0); window.__btr.me.dmg.body = 1 }, warn)
    await p.waitForTimeout(250)
    await p.screenshot({ path: OUT + `${name}-strike-warning.png` })
    await p.waitForFunction(id => !(window.__btr.race.strikes || []).some(s => s.id === id && !s.done), warn.id, { timeout: 5000 }).catch(() => {})
    await p.waitForTimeout(300)
    await p.screenshot({ path: OUT + `${name}-strike-hit.png` })
    const hit = await p.evaluate(() => ({ body: window.__btr.me.dmg.body, wreck: window.__btr.me.wreck }))
    ok(hit.body < 0.85 && hit.body >= 0.08 && hit.wreck === 0, `${name} 円の中にいると被弾して大きく傷むが大破しない`, `車体 ${Math.round(hit.body * 100)}%`)
    // 避ける: 次の予告から 25m 離れる
    const w2 = await p.waitForFunction(id => (window.__btr.race.strikes || []).find(s => !s.done && s.id > id), warn.id, { timeout: 12000 }).then(h => h.jsonValue()).catch(() => null)
    if (w2) {
      await p.evaluate(w => { window.__w2 = w; window.__btr.teleport(w.x + 25, w.z, 0, 0); window.__btr.me.dmg.body = 1 }, w2)
      const bl = await p.waitForFunction(id => { window.__btr.teleport(window.__w2.x + 25, window.__w2.z, 0, 0); return (window.__btr.race.blasts || []).find(x => x.id === id) }, w2.id, { timeout: 5000, polling: 100 }).then(h => h.jsonValue()).catch(() => null)
      ok(bl && !bl.hit.includes('me'), `${name} 円から離れれば、その1発は当たらない`, bl ? `着弾 #${bl.id} 当たった車 [${bl.hit.join(',')}]` : '着弾なし')
    } else ok(false, `${name} 2発目が来ない`)
  }
  ok(errs.length === 0, `${name} エラー 0`, errs.slice(0, 3).join(' | '))
  await b.close()
}
console.log(res.join('\n'))
srv.close()

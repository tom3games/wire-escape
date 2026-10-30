// スマホ7サイズ×2ブラウザで、全画面が上下スクロールなしで一画面に収まるか（枠の中のスクロールも数える）。
// node tools/fit.mjs [画面名...]   スクショは shots/fit/
import { chromium, webkit } from 'playwright'
import { startServer } from '../server.mjs'
import { mkdir } from 'node:fs/promises'
const OUT = new URL('../shots/fit/', import.meta.url).pathname
await mkdir(OUT, { recursive: true })
const srv = await startServer({ port: 8193, quiet: true })
const only = process.argv.slice(2).filter(a => !a.startsWith('-'))
const SIZES = [[844, 390], [844, 340], [667, 320], [568, 320], [932, 360], [390, 844], [375, 667]]
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const bad = [], good = []
for (const [ename, engine] of [['webkit', webkit], ['chromium', chromium]]) {
  const b = await engine.launch(ename === 'chromium' ? { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : {})
  for (const [w, h] of SIZES) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: ename === 'chromium' ? true : undefined, hasTouch: true, userAgent: UA, locale: 'ja-JP' })
    const p = await ctx.newPage()
    const errs = []
    p.on('pageerror', e => errs.push(e.message))
    await p.goto(`http://localhost:${srv.port}/`)
    await p.waitForFunction(() => window.__btrReady && !document.getElementById('btnOnline').disabled, null, { timeout: 60000 })
    await p.waitForTimeout(800)
    const tag = `${ename}-${w}x${h}`
    const check = async name => {
      if (only.length && !only.includes(name)) return
      const r = await p.evaluate(() => {
        const vis = [...document.querySelectorAll('.screen:not(.hidden) .panel, .screen:not(.hidden) .title-card')]
        const inner = vis.filter(el => el.scrollHeight > el.clientHeight + 2).length
        const out = vis.filter(el => { const r = el.getBoundingClientRect(); return r.bottom > innerHeight + 1 || r.right > innerWidth + 1 || r.top < -1 }).length
        const btns = [...document.querySelectorAll('.screen:not(.hidden) button, .screen:not(.hidden) input, .screen:not(.hidden) select')].filter(x => x.offsetParent)
        const offscreen = btns.filter(x => { const r = x.getBoundingClientRect(); return r.bottom > innerHeight + 1 || r.right > innerWidth + 1 }).map(x => x.id || x.className || x.tagName)
        return { inner, out, offscreen: offscreen.slice(0, 4), scroll: document.documentElement.scrollHeight > innerHeight + 1 }
      })
      const okk = !r.inner && !r.out && !r.offscreen.length && !r.scroll
      ;(okk ? good : bad).push(`${okk ? 'OK' : 'NG'}  ${tag} ${name} ${okk ? '' : JSON.stringify(r)}`)
      await p.screenshot({ path: `${OUT}${tag}-${name}.png` })
    }
    const tap = sel => p.evaluate(s => document.querySelector(s).click(), sel)
    await check('title')
    await tap('#btnGarage'); await p.waitForTimeout(500); await check('garage'); await tap('#garage [data-back]')
    await tap('#btnHowto'); await p.waitForTimeout(300); await check('howto'); await tap('#howto [data-back]')
    await tap('#btnOnline'); await p.waitForTimeout(400); await check('lobby-entry')
    await tap('#btnCreate'); await p.waitForFunction(() => /^[A-Z2-9]{4}$/.test(document.getElementById('roomCode').textContent)); await p.waitForTimeout(400)
    // 最大8人の部屋で測る（名前は長め）
    await p.evaluate(() => { const ul = document.getElementById('plist'), li = ul.firstElementChild; for (let i = 1; i < 8; i++) { const c = li.cloneNode(true); c.querySelector('.nm').textContent = 'ながいなまえのプレイヤー' + i; c.lastElementChild.innerHTML = ''; ul.appendChild(c) } })
    await check('lobby-room')
    await tap('#btnLeave'); await tap('#btnLobbyBack')
    await tap('#btnOffline'); await p.waitForTimeout(5000)
    await tap('[data-k=pause]').catch(() => {}); await p.evaluate(() => { if (document.getElementById('pause').classList.contains('hidden')) document.querySelector('[data-k=pause]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) }); await p.waitForTimeout(300); await check('pause')
    await tap('#btnResume'); await p.waitForTimeout(200)
    await p.evaluate(() => { const r = window.__btr.race; r.arrest(r.robbers[0], 'bust', r.cops[0].id) })
    await p.waitForFunction(() => window.__btr.mode === 'results', null, { timeout: 8000 }); await p.waitForTimeout(1500)
    // 最大8人の結果で測る
    await p.evaluate(() => { const b = document.getElementById('rBody'); while (b.children.length < 8) b.appendChild(b.children[1].cloneNode(true)) })
    await check('results')
    if (errs.length) bad.push(`NG  ${tag} errors ${errs.slice(0, 2).join(' | ')}`)
    await ctx.close()
  }
  await b.close()
}
console.log(bad.length ? bad.join('\n') : 'ALL FIT')
console.log(`${good.length} OK / ${bad.length} NG`)
await srv.close()

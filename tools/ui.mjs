// 各画面を複数サイズで撮り、はみ出しとエラーを数える。node tools/ui.mjs [webkit]
import { chromium, webkit } from 'playwright'
import { startServer } from '../server.mjs'
import { mkdir } from 'node:fs/promises'
const OUT = new URL('../shots/ui/', import.meta.url).pathname
await mkdir(OUT, { recursive: true })
const srv = await startServer({ port: 8192, quiet: true })
const useWebkit = process.argv.includes('webkit')
const browser = await (useWebkit ? webkit : chromium).launch(useWebkit ? {} : { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const sizes = [[1920, 1080], [1366, 768], [1280, 720], [960, 540], [844, 390], [390, 844]]
const bad = []
for (const [w, h] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ja-JP' })
  const page = await ctx.newPage()
  const errs = []
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_CONNECTION_CLOSED')) errs.push(m.text()) })
  page.on('pageerror', e => errs.push(e.message))
  await page.goto(`http://localhost:${srv.port}/`)
  await page.waitForFunction(() => window.__btrReady && !document.getElementById('btnOnline').disabled, null, { timeout: 30000 })
  await page.waitForTimeout(1200)
  const check = async name => {
    const r = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('.screen:not(.hidden) .panel, .screen:not(.hidden) .title-card')]
      const over = vis.filter(p => p.scrollHeight > p.clientHeight + 2 || p.getBoundingClientRect().bottom > innerHeight + 1 || p.getBoundingClientRect().right > innerWidth + 1).length
      // はみ出している文字（ボタンの中など）
      const clipped = [...document.querySelectorAll('.screen:not(.hidden) button, #hud:not(.hidden) *')].filter(b => b.offsetParent && !b.classList.contains('boost') && b.scrollWidth > b.clientWidth + 2 && getComputedStyle(b).overflow !== 'visible').length
      const which = [...document.querySelectorAll('.screen:not(.hidden) button, #hud:not(.hidden) *')].filter(b => b.offsetParent && !b.classList.contains('boost') && b.scrollWidth > b.clientWidth + 2 && getComputedStyle(b).overflow !== 'visible').map(b => b.id || b.className).join(',')
      return { over, clipped, which, scroll: document.documentElement.scrollHeight > innerHeight + 1 }
    })
    if (r.over || r.scroll || r.clipped) bad.push(`${w}x${h} ${name} ${JSON.stringify(r)}`)
    await page.screenshot({ path: `${OUT}${name}-${w}x${h}.png` })
  }
  await check('title')
  await page.click('#btnGarage'); await page.waitForTimeout(500); await check('garage')
  await page.click('#garage [data-back]')
  await page.click('#btnHowto'); await page.waitForTimeout(300); await check('howto')
  await page.click('#howto [data-back]')
  await page.click('#btnOnline'); await page.waitForTimeout(300); await check('lobby-entry')
  await page.click('#btnCreate'); await page.waitForFunction(() => /^[A-Z2-9]{4}$/.test(document.getElementById('roomCode').textContent)); await page.waitForTimeout(300); await check('lobby-room')
  await page.click('#btnLeave'); await page.click('#btnLobbyBack')
  await page.click('#btnOffline'); await page.waitForTimeout(5500); await check('race')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300); await check('pause')
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  // 結果: 逮捕で終わらせて結果画面を見る
  await page.evaluate(() => { const r = window.__btr.race; r.arrest(r.robbers[0], 'bust', r.cops[0].id) })
  await page.waitForFunction(() => window.__btr.mode === 'results', null, { timeout: 8000 }); await page.waitForTimeout(1600); await check('results')
  if (errs.length) bad.push(`${w}x${h} errors: ${errs.slice(0, 3).join(' | ')}`)
  await ctx.close()
}
console.log(bad.length ? bad.join('\n') : 'UI OK')
await browser.close(); await srv.close()

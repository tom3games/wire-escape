// fps を測る。スマホ相当（タッチ・画素比3）の縦と横で、街ステージを自動運転させて数秒数える。
// node tools/fps.mjs [ラベル]   （Mac の GPU を使い、CPU は CPU=4 倍遅くする。headless の既定はソフトウェア描画で遅い）
import { chromium } from 'playwright'
import { serveStatic } from './static.mjs'
const srv = await serveStatic(5197)
const label = process.argv[2] || ''
const out = []
for (const [w, h] of [[390, 844], [844, 390]]) {
  const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ja-JP' })
  const p = await ctx.newPage()
  // スマホの CPU に寄せる（Mac の CPU を 4 分の 1 に絞る）。描画の差より処理の差が出やすい
  const cdp = await ctx.newCDPSession(p)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU || 4) })
  const errs = []
  p.on('pageerror', e => errs.push(e.message))
  await p.goto(`http://localhost:5197/?v=${Date.now()}`)
  await p.waitForFunction(() => window.__btrReady, null, { timeout: 60000 })
  // COPS=警察の数、HEAT=1 で開始直後に手配度5（応援が全部来た状態）
  await p.evaluate(({ cops, heat }) => { window.__btr.profile.stage = 'city'; window.__btr.profile.cpu = cops; window.__btr.startOffline(); if (heat) setTimeout(() => { window.__btr.race.heatBonus = 4 }, 4000) }, { cops: Number(process.env.COPS || 4), heat: !!process.env.HEAT })
  await p.waitForTimeout(5500)
  await p.evaluate(() => window.__btr.autopilot && window.__btr.autopilot())
  await p.waitForTimeout(1500)
  const r = await p.evaluate(() => new Promise(res => {
    let n = 0, worst = 0, last = performance.now(); const t0 = last
    const f = now => { n++; worst = Math.max(worst, now - last); last = now; if (now - t0 < 8000) requestAnimationFrame(f); else res({ fps: Math.round(n / ((now - t0) / 1000) * 10) / 10, worstMs: Math.round(worst) }) }
    requestAnimationFrame(f)
  }))
  out.push(`${label} ${w}x${h} fps ${r.fps} 最長フレーム ${r.worstMs}ms errors ${errs.length}`)
  await b.close()
}
console.log(out.join('\n'))
srv.close()

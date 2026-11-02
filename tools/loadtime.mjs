// 読み込みの速さを測る（Fast 3G 相当: 下り 1.6Mbps・上り 0.75Mbps・遅延 150ms、キャッシュ無し）
//   node tools/loadtime.mjs [URL]   既定は公開URL。ローカルは http://localhost:5199/ で public を配る（"local"）
// 出すもの: 開いてから最初の描画（__btrReady）・読み込み完了（__btrLoaded、無ければ通信が1.5秒止まった時点）までの秒数、大きいファイル上位
import { chromium } from 'playwright'
import { muteContext, MUTE_LAUNCH } from './mute.mjs'
import { serveStatic } from './static.mjs'
let url = process.argv[2] || 'https://tom3games.github.io/wire-escape/'
let srv = null
if (url === 'local') { srv = await serveStatic(5199); url = 'http://localhost:5199/' }
const b = await chromium.launch({ args: [...MUTE_LAUNCH.args, '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' }); await muteContext(ctx)
const p = await ctx.newPage()
const cdp = await ctx.newCDPSession(p)
await cdp.send('Network.enable')
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
if (!process.env.NOTHROTTLE) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 0.75e6 / 8 })
const req = new Map(); let pending = 0, lastNet = Date.now()
cdp.on('Network.requestWillBeSent', e => { req.set(e.requestId, { url: e.request.url, t0: e.timestamp }); pending++; lastNet = Date.now() })
cdp.on('Network.loadingFinished', e => { const r = req.get(e.requestId); if (r) { r.size = e.encodedDataLength; r.dt = e.timestamp - r.t0; r.end = (Date.now() - t0) / 1000 } pending--; lastNet = Date.now() })
cdp.on('Network.loadingFailed', e => { const r = req.get(e.requestId); if (r) r.fail = e.errorText; pending--; lastNet = Date.now() })
const errs = []
let t0 = Date.now()
p.on('pageerror', e => errs.push(e.message))
t0 = Date.now()
await p.goto(url + (url.includes('?') ? '&' : '?') + 't=' + t0, { waitUntil: 'commit' })
// ロード画面が出た時刻・最初の描画・読み込み完了を並行に待つ（順に待つと前の待ちの時間が混ざる）
const since = () => (Date.now() - t0) / 1000
const wLoader = p.waitForFunction(() => { const l = document.getElementById('loader'); return l && getComputedStyle(l).display !== 'none' }, null, { timeout: 60000, polling: 50 }).then(since).catch(() => null)
const tReady = await p.waitForFunction(() => window.__btrReady, null, { timeout: 180000, polling: 50 }).then(since)
const hasLoaded = await p.evaluate(() => '__btrLoaded' in window)
const tLoaded = hasLoaded ? await p.waitForFunction(() => window.__btrLoaded, null, { timeout: 180000, polling: 50 }).then(since) : null
const firstLoader = await wLoader
// 通信が 1.5 秒止まるまで待つ
while (!(pending <= 0 && Date.now() - lastNet > 1500)) { await p.waitForTimeout(200); if (Date.now() - t0 > 240000) break }
const tIdle = (Date.now() - t0 - 1500) / 1000
const list = [...req.values()].filter(r => r.size != null)
const total = list.reduce((a, r) => a + r.size, 0)
console.log(JSON.stringify({ url, loaderShownAt: firstLoader, readySec: tReady, loadedSec: tLoaded ?? null, netIdleSec: +tIdle.toFixed(1), requests: list.length, totalMB: +(total / 1e6).toFixed(2), errs }))
const pre = list.filter(r => r.end <= tReady)
console.log('最初の描画までに', pre.length, '本', (pre.reduce((a, r) => a + r.size, 0) / 1e6).toFixed(2) + 'MB', '/ 種類別', JSON.stringify(Object.entries(pre.reduce((o, r) => { const k = (r.url.match(/\/(js|shared|vendor|assets\/[^/]+|snd)\//) || [, 'other'])[1]; o[k] = (o[k] || 0) + r.size; return o }, {})).map(([k, v]) => k + ':' + (v / 1e3).toFixed(0) + 'KB')))
if (process.env.ALL) for (const r of list.sort((a, b) => a.end - b.end)) console.log(r.end.toFixed(1).padStart(5), (r.size / 1e3).toFixed(0).padStart(5) + 'KB', r.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*/, ''))
for (const r of list.sort((a, b) => b.size - a.size).slice(0, 12)) console.log((r.size / 1e3).toFixed(0).padStart(6) + 'KB', r.dt.toFixed(1).padStart(5) + 's', r.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*/, ''))
await b.close(); if (srv) srv.close()

// スクショを並べた一覧画像を作る。node tools/sheet.mjs out.png a.png b.png ...
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
const [out, ...files] = process.argv.slice(2)
const imgs = await Promise.all(files.map(async f => `<figure><img src="data:image/png;base64,${(await readFile(f)).toString('base64')}"><figcaption>${f.split('/').pop()}</figcaption></figure>`))
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 400 } })
await p.setContent(`<style>body{margin:0;background:#111;color:#fff;font:14px sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:6px}img{width:100%;display:block}figure{margin:0}figcaption{padding:2px 4px}</style>${imgs.join('')}`)
await p.screenshot({ path: out, fullPage: true })
await b.close()

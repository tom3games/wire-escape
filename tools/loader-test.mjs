// ロード画面の確認: 最初に出る → 本物の読み込み数で進む → 全部読み終えてから消える／スクリプトが読めないと失敗の表示が出る
//   node tools/loader-test.mjs [webkit]   スクショは shots/loader/
import '../mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { chromium, webkit } from 'playwright'
import { muteContext, MUTE_LAUNCH } from './mute.mjs'
import { serveStatic } from './static.mjs'
import { mkdir } from 'node:fs/promises'
const OUT = new URL('../shots/loader/', import.meta.url).pathname
await mkdir(OUT, { recursive: true })
const srv = await serveStatic(5196)
const useWk = process.argv.includes('webkit')
const eng = useWk ? webkit : chromium
const b = await eng.launch(useWk ? {} : { args: [...MUTE_LAUNCH.args, '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
let bad = 0
const ok = (c, name, info = '') => { if (!c) bad++; console.log(c ? 'OK ' : 'NG ', name, info) }
// 先読み（modulepreload）は importmap より後。前だと Chrome が "three" を解決できず起動しない（2026-11-03 公開版で踏んだ。ローカルでは間に合って通ってしまう）
{
  const html = (await import('node:fs')).readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
  const im = html.indexOf('type="importmap"'), mp = html.indexOf('rel="modulepreload"')
  ok(im > 0 && (mp < 0 || mp > im), 'modulepreload が importmap の後', `importmap@${im} modulepreload@${mp}`)
}

async function open(size, { slow = false, block = null } = {}) {
  const ctx = await b.newContext({ viewport: { width: size[0], height: size[1] }, locale: 'ja-JP', hasTouch: size[0] < 900 })
  await muteContext(ctx)
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message))
  if (block) await p.route(u => u.pathname.endsWith(block), r => r.abort())
  // 遅い回線のかわりに、素材とスクリプトを少しずつ遅らせて返す（ロード画面を撮るため）
  if (slow) await p.route(u => /\.(js|webp|glb)$/.test(u.pathname), async r => { await new Promise(f => setTimeout(f, 40 + Math.random() * 120)); r.continue() })
  return { ctx, p, errs }
}

for (const size of [[390, 844], [844, 390]]) {
  const tag = `${eng.name()}-${size.join('x')}`
  const { ctx, p, errs } = await open(size, { slow: true })
  const t0 = Date.now()
  await p.goto('http://localhost:5196/', { waitUntil: 'commit' })
  await p.waitForSelector('#loader', { state: 'visible', timeout: 5000 })
  const shownAt = Date.now() - t0
  ok(!(await p.evaluate(() => window.__btrReady)), `${tag} ロード画面が最初の描画より先に出る`, shownAt + 'ms')
  // 途中（30〜80%）を撮る
  await p.waitForFunction(() => window.__ld.pct > 0.3 && window.__ld.pct < 0.8, null, { timeout: 30000, polling: 30 }).catch(() => {})
  await p.screenshot({ path: OUT + tag + '-loading.png' })
  await p.waitForFunction(() => window.__btrLoaded, null, { timeout: 60000 })
  const st = await p.evaluate(() => ({ js: window.__ld.js, jsTotal: window.__ld.jsTotal, items: window.__ld.items, total: window.__ld.itemsTotal, pct: window.__ld.pct, ready: !!window.__btrReady }))
  ok(st.ready && st.total >= 20 && st.items >= st.total && st.pct === 1, `${tag} 素材を全部読み終えてから完了`, JSON.stringify(st))
  ok(st.js === st.jsTotal, `${tag} 起動スクリプトの数が jsTotal と同じ`, `${st.js}/${st.jsTotal}`)
  await p.waitForTimeout(700)
  const hist = await p.evaluate(() => window.__ld.hist)
  ok(hist.every((v, i) => i === 0 || v >= hist[i - 1]) && new Set(hist).size >= 8 && hist[hist.length - 1] === 100, `${tag} 進み具合が細かく増えていく`, hist.join(','))
  const hidden = await p.evaluate(() => { const l = document.getElementById('loader'); return l.hidden || getComputedStyle(l).display === 'none' })
  ok(hidden, `${tag} 完了後にロード画面が消える`)
  // 車のモデルはロード画面の後に読む
  const car = await p.waitForFunction(() => performance.getEntriesByType('resource').some(e => /car(_lite)?\.glb/.test(e.name)), null, { timeout: 20000 }).then(() => true).catch(() => false)
  ok(car, `${tag} 車のモデルを後から読む`)
  await p.screenshot({ path: OUT + tag + '-title.png' })
  // 逃げるを押して遊び中を撮る（音は鳴らさない）
  if (size[0] < 900) await p.tap('#btnOffline'); else await p.click('#btnOffline')
  await p.waitForTimeout(5200)
  await p.screenshot({ path: OUT + tag + '-play.png' })
  // 風のループは WAV。このブラウザで読めるか（鳴らさずに decode だけ）
  const wav = await p.evaluate(async () => { const ab = await (await fetch('snd/wind_loop.wav')).arrayBuffer(); const C = window.AudioContext || window.webkitAudioContext; const c = new C(); const buf = await new Promise((ok, ng) => c.decodeAudioData(ab, ok, ng)); return +buf.duration.toFixed(1) }).catch(e => 'err ' + e.message)
  ok(wav > 13 && wav < 15, `${tag} 風の WAV が読める`, wav + '秒')
  const mute = await p.evaluate(() => ({ ok: window.__muteOk ? window.__muteOk() : null }))
  ok(mute.ok !== false, `${tag} 無音`, JSON.stringify(mute))
  ok(!errs.length, `${tag} エラー0`, errs.slice(0, 2).join(' | '))
  await ctx.close()
}

// スクリプトが1本読めない → 失敗の表示（もう一度ボタン付き）
{
  const { ctx, p } = await open([390, 844], { block: 'js/hud.js' })
  await p.goto('http://localhost:5196/')
  const failed = await p.waitForSelector('#loader.fail', { timeout: 15000 }).then(() => true).catch(() => false)
  const txt = await p.evaluate(() => ({ msg: document.getElementById('ldMsg').textContent, detail: document.getElementById('bootfail').textContent, retry: getComputedStyle(document.getElementById('ldRetry')).display }))
  ok(failed && /途切れ/.test(txt.msg) && /hud\.js|起動できません/.test(txt.detail) && txt.retry !== 'none', '読み込みエラーで起動失敗の表示', JSON.stringify(txt).slice(0, 160))
  await p.screenshot({ path: OUT + `${eng.name()}-fail.png` })
  await ctx.close()
}
await b.close(); srv.close()
console.log(bad ? `NG ${bad}件` : '全部OK')
process.exit(bad ? 1 : 0)

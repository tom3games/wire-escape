// オンラインの警察と犯人を実ブラウザ2つ（＋任意で webkit）でつないで最後まで通す。
// 1回目は制限時間を70秒に縮めて自然に決着させ、2回目（再戦）は犯人を止めて警察に逮捕させる（両方の結末を見る）。
// node tools/e2e-online.mjs [--webkit]   （サーバーは自分で起動する）
import { chromium, webkit } from 'playwright'
import { startServer } from '../server.mjs'
import { mkdir } from 'node:fs/promises'
const OUT = new URL('../shots/', import.meta.url).pathname
await mkdir(OUT, { recursive: true })
process.env.BTR_CHASE_LIMIT = '70' // 2回目の逮捕は警察役が220〜420m先から来て、途中で読み込み直しもするので余裕を持たせる（40秒では webkit で3回に1回届かなかった）
const srv = await startServer({ port: 8191, quiet: true })
const URL0 = `http://localhost:${srv.port}/`
const problems = [], notes = []
const ok = (c, label, d = '') => (c ? notes : problems).push(`${c ? 'OK  ' : 'NG  '}${label}${d ? '  ' + d : ''}`)
const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
const bA = await chromium.launch({ args }), bB = await (process.argv.includes('--webkit') ? webkit : chromium).launch(process.argv.includes('--webkit') ? {} : { args })
const mk = async (b, name) => {
  const ctx = await b.newContext({ viewport: { width: 960, height: 540 }, locale: 'ja-JP' })
  const p = await ctx.newPage()
  p.errs = []
  p.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_CONNECTION_CLOSED')) p.errs.push(m.text()) })
  p.on('pageerror', e => p.errs.push('pageerror: ' + e.message))
  p.on('requestfailed', r => { if (!r.url().includes('fonts.g')) p.errs.push('reqfail: ' + r.url()) })
  p.name = name
  return p
}
const A = await mk(bA, 'A'), B = await mk(bB, 'B')
const ready = p => p.waitForFunction(() => window.__btrReady && !document.getElementById('btnOnline').disabled, null, { timeout: 30000 })
await A.goto(URL0); await ready(A)
await A.fill('#nameInput', 'ホスト')
await A.click('#btnOnline')
await A.click('#btnCreate')
await A.waitForFunction(() => /^[A-Z2-9]{4}$/.test(document.getElementById('roomCode').textContent))
const code = await A.textContent('#roomCode')
const link = await A.inputValue('#inviteLink')
ok(/^[A-Z2-9]{4}$/.test(code), '部屋コードが出る', code)
ok(link.includes('?room=' + code), '招待リンクにコードが入る', link)
// B は招待リンクから入る（名前を先に保存しておくと自動で参加する）
await B.goto(URL0); await ready(B)
await B.fill('#nameInput', 'ゲスト'); await B.dispatchEvent('#nameInput', 'change')
await B.goto(link); await ready(B)
await B.waitForFunction(() => document.querySelectorAll('#plist li').length === 2, null, { timeout: 15000 }).catch(() => {})
const listA = await A.$$eval('#plist li', ls => ls.map(l => l.textContent))
ok(listA.length === 2, 'ホストの一覧に2人', listA.join(' / '))
await B.click('#carPickLobby button:nth-child(2)') // B は BRUISER
await A.waitForTimeout(500)
const carsA = await A.$$eval('#plist li .car', ls => ls.map(l => l.textContent))
ok(carsA.includes('BRUISER'), '相手の車の選択が見える', carsA.join(','))
ok(await B.isVisible('.guest-only') && !(await B.isVisible('#btnStartOnline')), 'ゲストにはスタートボタンが出ない')
await A.selectOption('#cpuOnline', '1')
await A.click('#btnStartOnline')
await Promise.all([A, B].map(p => p.waitForFunction(() => window.__btr.mode === 'race' && window.__btr.race, null, { timeout: 10000 })))
const nA = await A.evaluate(() => window.__btr.race.entries.length), nB = await B.evaluate(() => window.__btr.race.entries.length)
ok(nA === 3 && nB === 3, '両方の画面に3台（人2＋CPU1）', `${nA}/${nB}`)
const rolesA = await A.evaluate(() => window.__btr.race.entries.map(e => e.id + ':' + e.role + (e.bot ? ':bot' : '')).join(','))
const rolesB = await B.evaluate(() => window.__btr.race.entries.map(e => e.id + ':' + e.role + (e.bot ? ':bot' : '')).join(','))
ok(rolesA === rolesB && (rolesA.match(/robber/g) || []).length === 1 && !/robber:bot/.test(rolesA), '役が両方の画面で同じ（人の犯人1人・CPU は警察）', rolesA)
const spawnSame = await Promise.all([A, B].map(p => p.evaluate(() => window.__btr.race.entries.map(e => Math.round(e.spawn.x) + ',' + Math.round(e.spawn.z)).join(' '))))
ok(spawnSame[0] === spawnSame[1], 'スタート位置と隠れ家が両方で同じ', spawnSame[0])
await A.screenshot({ path: OUT + 'online-A-countdown.png' })
await A.waitForTimeout(4500)
// 両者 CPU と同じ考え方で運転（犯人は逃げる、警察は追う）
await A.evaluate(() => window.__btr.autopilot())
await B.evaluate(() => window.__btr.autopilot())
// 同期の確認: A の車の位置を、B 側で見た A の車の位置と比べる
const samples = []
for (let i = 0; i < 12; i++) {
  await A.waitForTimeout(700)
  const [a, b] = await Promise.all([
    A.evaluate(() => ({ id: window.__btr.myId, x: window.__btr.me.x, z: window.__btr.me.z, t: performance.now() })),
    B.evaluate(() => window.__btr.race && window.__btr.race.entries.map(e => ({ id: e.id, x: e.car.x, z: e.car.z })))
  ])
  const seen = b && b.find(e => e.id === a.id)
  if (seen) samples.push(Math.hypot(seen.x - a.x, seen.z - a.z))
}
const maxGap = Math.max(...samples), avg = samples.reduce((s, v) => s + v, 0) / samples.length
// 100ms 遅らせて補間するので、時速150kmなら 4〜8m 遅れて見えるのが正常
ok(samples.length >= 10 && avg < 14, 'B の画面の A の車が A の実位置についてくる', `平均差 ${avg.toFixed(1)}m 最大 ${maxGap.toFixed(1)}m（${samples.length}回）`)
await B.screenshot({ path: OUT + 'online-B-race.png' })
// 破壊の同期: 誰かが壊した物が両方で壊れている（何か壊れるまで待つ）
await A.waitForFunction(() => window.__btr.world.destroyed.size >= 1, null, { timeout: 30000 }).catch(() => {})
await A.waitForTimeout(1500)
const [dA, dB] = await Promise.all([A, B].map(p => p.evaluate(() => [...window.__btr.world.destroyed])))
const missing = dA.filter(id => !dB.includes(id))
ok(dA.length >= 1 && missing.length <= 1, '壊れた物が両方の画面で一致', `A ${dA.length}個 / B ${dB.length}個 / B に無い ${missing.length}`)
// 最後まで（制限時間70秒）
await Promise.all([A, B].map(p => p.waitForFunction(() => window.__btr.mode === 'results', null, { timeout: 120000 }).catch(() => {})))
await A.waitForTimeout(2500)
await A.screenshot({ path: OUT + 'online-A-results.png' })
await B.screenshot({ path: OUT + 'online-B-results.png' })
const rA = await A.$$eval('#rBody tr', t => t.map(r => r.textContent))
const rB = await B.$$eval('#rBody tr', t => t.map(r => r.textContent))
ok(rA.length === 3 && JSON.stringify(rA) === JSON.stringify(rB), '結果が両方で同じ', rA.map(s => s.slice(0, 30)).join(' | '))
const out1 = await A.textContent('#rTitle') + ' ' + await A.textContent('#rReason')
ok(/勝ち/.test(out1), '1回目の結末が出る', out1)
ok(await B.isDisabled('#btnAgain') && !(await A.isDisabled('#btnAgain')), '再戦はホストだけ押せる')
// 再戦
await A.click('#btnAgain')
await Promise.all([A, B].map(p => p.waitForFunction(() => window.__btr.mode === 'race' && window.__btr.race.phase !== 'done', null, { timeout: 10000 }).catch(() => {})))
const again = await Promise.all([A, B].map(p => p.evaluate(() => window.__btr.mode)))
ok(again.every(m => m === 'race'), '再戦で両方が追跡に戻る', again.join(','))
const trafficSame = await Promise.all([A, B].map(p => p.evaluate(() => { const r = window.__btr.race; r.traffic.update(30, 1 / 60); return r.traffic.cars.slice(0, 3).map(c => [Math.round(c.x), Math.round(c.z)]).join(' ') })))
ok(trafficSame[0] === trafficSame[1], '一般車が両方の画面で同じ位置', trafficSame[0])
const brokenAfter = await B.evaluate(() => window.__btr.world.destroyed.size)
ok(brokenAfter === 0, '再戦で壊れた物が元に戻る', String(brokenAfter))
// 2回目: 犯人は止まったまま、警察は追う → 逮捕で終わる
await A.waitForTimeout(4500)
const robberPage = (await A.evaluate(() => window.__btr.me.role)) === 'robber' ? A : B
const copPage = robberPage === A ? B : A
await copPage.evaluate(() => window.__btr.autopilot())
// 切断と再接続: 警察役を読み込み直すと同じ席で続きから走れる
await copPage.waitForTimeout(6000)
const before = await copPage.evaluate(() => ({ id: window.__btr.myId, x: window.__btr.me.x, z: window.__btr.me.z }))
await copPage.reload(); await copPage.waitForFunction(() => window.__btr && window.__btr.mode === 'race' && window.__btr.me, null, { timeout: 20000 }).catch(() => {})
const after = await copPage.evaluate(() => window.__btr.me ? ({ id: window.__btr.myId, x: window.__btr.me.x, z: window.__btr.me.z }) : null)
ok(after && after.id === before.id && Math.hypot(after.x - before.x, after.z - before.z) < 80, '読み込み直しても同じ席で続きから走れる', JSON.stringify({ before, after }))
await copPage.evaluate(() => window.__btr.autopilot())
await Promise.all([A, B].map(p => p.waitForFunction(() => window.__btr.mode === 'results', null, { timeout: 120000 }).catch(() => {})))
await A.waitForTimeout(2000)
const out2 = await copPage.textContent('#rTitle') + ' ' + await copPage.textContent('#rReason')
ok(/警察の勝ち/.test(out2), '2回目は止まった犯人を逮捕して警察の勝ち', out2)
// 結果の車体は決着した瞬間の値（大破で逮捕なら低い。体当たりでスピンしただけでは大破扱いにしない）
const robRow = await copPage.$$eval('#rBody tr', trs => (trs.find(t => t.querySelector('.role-robber')) || {}).textContent || '')
const robBody = Number((robRow.match(/(\d+)%/) || [])[1])
ok(!/大破/.test(out2) || robBody < 10, '大破で逮捕なら結果の犯人の車体は低い', `${out2} / ${robRow}`)
await copPage.screenshot({ path: OUT + 'online-cop-bust.png' })
await A.click('#btnAgain').catch(() => {})
await Promise.all([A, B].map(p => p.waitForFunction(() => window.__btr.mode === 'race', null, { timeout: 10000 }).catch(() => {})))
// 途中退出: B が部屋を出ると A では退出扱い
await A.waitForTimeout(5000)
const bId = await B.evaluate(() => window.__btr.myId)
await B.evaluate(() => window.__btr.online.leave())
await A.waitForTimeout(1500)
const left = await A.evaluate(id => window.__btr.race.entry(id).left || (window.__btr.mode === 'results' && /犯人が退出/.test(document.getElementById('rReason').textContent)), bId)
ok(left === true, '途中退出した人はホスト側で「途中退出」になる（犯人が抜けたら警察の勝ちで終わる）', String(left))
for (const p of [A, B]) ok(p.errs.length === 0, p.name + ' のコンソールエラー 0', p.errs.slice(0, 3).join(' | '))
console.log(notes.join('\n'))
console.log(problems.length ? problems.join('\n') : 'ALL OK')
await bA.close(); await bB.close(); await srv.close()
process.exit(problems.length ? 1 : 0)

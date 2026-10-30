// 本物のサーバーに WebSocket でつなぎ、部屋・同期・不正対策を確かめる
import test from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { startServer } from '../server.mjs'
import { createWorld } from '../public/shared/track.js'
import { createNav } from '../public/shared/citynav.js'
import { passesThroughWall } from '../lib/game.mjs'

const W = createWorld('city')
const NAV = createNav(W)

function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`)
  const c = { ws, msgs: [], id: null, state: null, snaps: [] }
  ws.on('message', d => {
    const m = JSON.parse(d)
    c.msgs.push(m)
    if (m.t === 'welcome') c.id = m.id
    if (m.t === 'state') c.state = m
    if (m.t === 'snap') c.snaps.push(m)
  })
  c.send = m => ws.send(JSON.stringify(m))
  c.ready = new Promise(r => ws.on('open', () => { c.send({ t: 'hello' }); r() }))
  c.wait = async (fn, ms = 4000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) { const v = fn(c); if (v) return v; await new Promise(r => setTimeout(r, 20)) }
    throw new Error('timeout')
  }
  return c
}

async function room(srv, n = 2, cpu = 0) {
  const cs = []
  for (let i = 0; i < n; i++) { const c = client(srv.port); await c.ready; await c.wait(c => c.id); cs.push(c) }
  cs[0].send({ t: 'create', name: 'host' })
  const code = (await cs[0].wait(c => c.state && c.state.code && c.state)).code
  for (let i = 1; i < n; i++) { cs[i].send({ t: 'join', code, name: 'p' + i }); await cs[i].wait(c => c.state && c.state.code === code) }
  cs[0].send({ t: 'start', opts: { cpu } })
  for (const c of cs) await c.wait(c => c.state && c.state.phase === 'playing')
  return { cs, code }
}

const stateMsg = (x, z, extra = {}) => ({ t: 'input', data: { k: 'state', s: { x, y: 0.55, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, roll: 0, ...extra }, rt: 0 } })
const sleep = ms => new Promise(r => setTimeout(r, ms))

// レースが始まるまで待つ（カウントダウン 4 秒）
async function untilRacing(c) { await c.wait(c => c.snaps.length && c.snaps[c.snaps.length - 1].phase === 'racing', 7000) }
const myCar = c => c.snaps[c.snaps.length - 1].cars.find(k => k.id === c.id)

const spawnOf = c => c.state.game.entries.find(e => e.id === c.id).spawn
const roleOf = c => c.state.game.entries.find(e => e.id === c.id).role

test('部屋を作って入り、スタートで全員に役とスナップショットが届く（犯人1人・残りは警察・空きは CPU の警察）', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const { cs } = await room(srv, 2, 2)
    await cs[1].wait(c => c.snaps.length > 3)
    const s = cs[1].snaps.at(-1)
    assert.equal(s.cars.length, 4, '人2 + CPU2')
    const es = cs[0].state.game.entries
    assert.equal(es.filter(e => e.bot).length, 2)
    assert.equal(es.filter(e => e.role === 'robber').length, 1, '犯人は1人')
    assert.ok(es.filter(e => e.bot).every(e => e.role === 'cop'), 'CPU は警察')
    assert.ok(es.find(e => e.role === 'robber' && !e.bot), '犯人は人')
    assert.ok(s.ch && s.ch.heat >= 1 && s.ch.hideout, '追跡の状態も届く')
    assert.ok(es.every(e => e.spawn && Number.isFinite(e.spawn.x)), 'スタート位置が届く')
  } finally { await srv.close() }
})

test('瞬間移動は受け付けず、元の位置に戻させる', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const { cs } = await room(srv, 1, 0)
    const [a] = cs
    await untilRacing(a)
    const g = spawnOf(a)
    a.send(stateMsg(g.x, g.z + 2))
    await sleep(100)
    a.send(stateMsg(g.x, g.z + 600)) // 600m 先へ飛ぶ
    await a.wait(c => c.msgs.some(m => m.t === 'correct'))
    await sleep(150)
    const car = myCar(a)
    assert.ok(Math.hypot(car.x - g.x, car.z - g.z) < 10, `位置は戻されている z=${car.z}`)
  } finally { await srv.close() }
})

test('建物の中を通り抜ける移動は壁抜けとして見つかる', () => {
  const b = W.colliders.find(o => o.kind === 'building' && o.hw > 15 && o.hw < 80 && o.hl > 15)
  assert.ok(passesThroughWall(W, b.cx - b.hw - 3, 0.55, b.cz, b.cx + b.hw + 3, 0.55, b.cz), '建物の中を横切る')
  assert.ok(!passesThroughWall(W, b.cx - b.hw - 3, 0.55, b.cz - b.hl - 6, b.cx + b.hw + 3, 0.55, b.cz - b.hl - 6), '建物の前の道は通れる')
})

test('カウントダウン中に動くと戻される', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const { cs } = await room(srv, 1, 0)
    const [a] = cs
    await a.wait(c => c.snaps.length && c.snaps.at(-1).phase === 'countdown')
    const g = spawnOf(a)
    a.send(stateMsg(g.x + 30, g.z))
    await a.wait(c => c.msgs.some(m => m.t === 'correct'))
  } finally { await srv.close() }
})

test('遠くの物を壊したという申告は却下され、他の人には配られない', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const { cs } = await room(srv, 2, 0)
    const [a, b] = cs
    await untilRacing(a)
    const g = spawnOf(a)
    const far = W.objects.find(o => Math.hypot(o.cx - g.x, o.cz - g.z) > 300)
    a.send({ t: 'input', data: { k: 'break', id: far.id, sp: 60, dx: 0, dz: 60 } })
    await a.wait(c => c.msgs.some(m => m.t === 'unbreak' && m.id === far.id))
    await sleep(200)
    assert.ok(!b.snaps.some(s => s.br.some(x => x.id === far.id)))
  } finally { await srv.close() }
})

test('近くで十分な速さの破壊は全員に配られ、部屋の状態にも残る', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const { cs } = await room(srv, 2, 0)
    const [a, b] = cs
    await untilRacing(a)
    const g = spawnOf(a)
    // スタートの交差点の信号・街灯・木のうち一番近いもの
    // 道ばたの壊せる物のうち、スタートから建物を通らずに行ける一番近いもの
    const near = W.objects.filter(o => o.def.breakAt <= 15 && !passesThroughWall(W, g.x, 0.55, g.z, o.cx, 0.55, o.cz))
      .sort((p, q) => Math.hypot(p.cx - g.x, p.cz - g.z) - Math.hypot(q.cx - g.x, q.cz - g.z))[0]
    const D = Math.hypot(near.cx - g.x, near.cz - g.z)
    assert.ok(D < 120, `近くに壊せる物がある ${D}m`)
    a.send(stateMsg(g.x, g.z, { vx: 0, vz: 0 })); await sleep(300)
    const n = Math.ceil(D / 15)
    for (let i = 1; i < n; i++) { a.send(stateMsg(g.x + (near.cx - g.x) * i / n, g.z + (near.cz - g.z) * i / n, { vz: 25 })); await sleep(300) }
    a.send({ t: 'input', data: { k: 'break', id: near.id, sp: 25, dx: 0, dz: 25 } })
    await b.wait(c => c.snaps.some(s => s.br.some(x => x.id === near.id)))
    await b.wait(c => c.state.game.destroyed.some(([id]) => id === near.id), 3000)
  } finally { await srv.close() }
})

test('警察が犯人のそばで止まると、サーバーが逮捕して警察の勝ちになる', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const { cs } = await room(srv, 2, 0)
    await untilRacing(cs[0])
    const rob = cs.find(c => roleOf(c) === 'robber'), cop = cs.find(c => roleOf(c) === 'cop')
    const rs = spawnOf(rob), cp = spawnOf(cop)
    rob.send(stateMsg(rs.x, rs.z))
    // 警察は道なりに（交差点をたどって）犯人の横まで走る
    const path = NAV.path(NAV.nearest(cp.x, cp.z), NAV.nearest(rs.x, rs.z)).map(n => [n.x, n.z])
    let x = cp.x, z = cp.z
    for (const [tx, tz] of [...path, [rs.x + 5, rs.z]]) {
      while (Math.hypot(tx - x, tz - z) > 0.01) {
        const d = Math.hypot(tx - x, tz - z), k = Math.min(1, 18 / d)
        x += (tx - x) * k; z += (tz - z) * k
        cop.send(stateMsg(x, z, { vx: 0, vz: 0 }))
        rob.send(stateMsg(rs.x, rs.z))
        await sleep(240)
      }
    }
    for (let i = 0; i < 16; i++) { cop.send(stateMsg(rs.x + 5, rs.z)); rob.send(stateMsg(rs.x, rs.z)); await sleep(240) }
    await cop.wait(c => c.msgs.some(m => m.t === 'state' && m.phase === 'result'), 8000)
    const res = cop.msgs.filter(m => m.t === 'state' && m.phase === 'result').at(-1).result
    assert.equal(res.outcome.winner, 'cop')
    assert.equal(res.list.find(r => r.id === rob.id).arrested, true)
    assert.equal(res.list.find(r => r.id === cop.id).won, true)
  } finally { await srv.close() }
})

test('オンライン: 体当たりでスピンしただけ（ノックダウン）は大破扱いにせず、本当の大破で逮捕。結果の車体は大破した瞬間の値', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const { cs } = await room(srv, 2, 0)
    await untilRacing(cs[0])
    const rob = cs.find(c => roleOf(c) === 'robber'), cop = cs.find(c => roleOf(c) === 'cop')
    const rs = spawnOf(rob), cp = spawnOf(cop)
    rob.send(stateMsg(rs.x, rs.z))
    // 警察は道なりに犯人の 30m 手前まで（逮捕ゲージは 10m 以内なのでたまらない）
    const path = NAV.path(NAV.nearest(cp.x, cp.z), NAV.nearest(rs.x, rs.z)).map(n => [n.x, n.z])
    let x = cp.x, z = cp.z
    const goal = path.length > 1 ? path[path.length - 2] : [rs.x + 30, rs.z]
    for (const [tx, tz] of [...path.slice(0, -1), goal]) {
      while (Math.hypot(tx - x, tz - z) > 0.01) {
        const d = Math.hypot(tx - x, tz - z), k = Math.min(1, 18 / d)
        x += (tx - x) * k; z += (tz - z) * k
        cop.send(stateMsg(x, z)); rob.send(stateMsg(rs.x, rs.z))
        await sleep(240)
      }
    }
    // 30m まで寄せる
    const dd = Math.hypot(rs.x - x, rs.z - z)
    if (dd > 30) for (let i = 1; i <= 8; i++) { const k = (dd - 30) / dd * i / 8; cop.send(stateMsg(x + (rs.x - x) * k, z + (rs.z - z) * k)); rob.send(stateMsg(rs.x, rs.z)); await sleep(240) }
    const full = [1, 1, 1, 1, 1]
    // ノックダウン（w=1, k=1）: 逮捕されない
    for (let i = 0; i < 4; i++) { rob.send(stateMsg(rs.x, rs.z, { w: 1, k: 1, d: full })); await sleep(200) }
    rob.send(stateMsg(rs.x, rs.z, { d: full })); await sleep(400)
    assert.ok(!cop.msgs.some(m => m.t === 'state' && m.phase === 'result'), 'ノックダウンで逮捕された')
    // 本当の大破（車体 0）
    rob.send(stateMsg(rs.x, rs.z, { w: 1, d: [0, 0.5, 0.5, 0.5, 0.5] }))
    await sleep(300)
    rob.send(stateMsg(rs.x, rs.z, { d: [1, 1, 1, 1, 1] })) // 復帰で直った値が届いても
    await cop.wait(c => c.msgs.some(m => m.t === 'state' && m.phase === 'result'), 8000)
    const res = cop.msgs.filter(m => m.t === 'state' && m.phase === 'result').at(-1).result
    assert.equal(res.outcome.reason, 'wreck')
    assert.equal(res.list.find(r => r.id === rob.id).body, 0)
  } finally { await srv.close() }
})

test('不正な形のメッセージでサーバーが落ちない', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const { cs } = await room(srv, 1, 0)
    const [a] = cs
    for (const bad of ['{', '{"t":1}', JSON.stringify({ t: 'input', data: null }), JSON.stringify({ t: 'input', data: { k: 'state', s: { x: 'a' } } }),
      JSON.stringify({ t: 'input', data: { k: 'break', id: '__proto__' } }), JSON.stringify({ t: 'car', car: { carId: 'tank', levels: { engine: 99 } } }), JSON.stringify({ t: 'start', opts: { cpu: 1e9, rng: 'x' } })]) a.ws.send(bad)
    await sleep(300)
    a.send({ t: 'ping', at: 1 })
    await a.wait(c => c.msgs.some(m => m.t === 'pong'))
  } finally { await srv.close() }
})

test('途中退出した人は退出として残り、犯人が全員抜けると警察の勝ちで終わる', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const { cs } = await room(srv, 2, 0)
    await untilRacing(cs[0])
    const rob = cs.find(c => roleOf(c) === 'robber'), cop = cs.find(c => roleOf(c) === 'cop')
    rob.send({ t: 'leave' })
    await cop.wait(c => c.snaps.at(-1).cars.find(k => k.id === rob.id)?.l === 1 || c.msgs.some(m => m.t === 'state' && m.phase === 'result'))
    await cop.wait(c => c.msgs.some(m => m.t === 'state' && m.phase === 'result'), 4000)
    const res = cop.msgs.filter(m => m.t === 'state' && m.phase === 'result').at(-1).result
    assert.equal(res.outcome.winner, 'cop')
    assert.equal(res.outcome.reason, 'left')
  } finally { await srv.close() }
})

test('オンライン: サーバーが修理（止まって3秒で全回復）とヘリの着弾（予告の円にいた犯人に当たる）を決めて配る', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  try {
    const { cs, code } = await room(srv, 1, 0)
    const [a] = cs
    await untilRacing(a)
    const race = srv.rooms.rooms.get(code).game.race
    const g = spawnOf(a)
    // 一番近い修理工場まで、道なりに許される速さで走る
    const shop = race.shops.slice().sort((p, q) => Math.hypot(p.x - g.x, p.z - g.z) - Math.hypot(q.x - g.x, q.z - g.z))[0]
    const path = [...NAV.path(NAV.nearest(g.x, g.z), NAV.nearest(shop.x, shop.z)).map(n => [n.x, n.z]), [shop.x, shop.z]]
    let x = g.x, z = g.z
    for (const [tx, tz] of path) {
      while (Math.hypot(tx - x, tz - z) > 0.01) {
        const d = Math.hypot(tx - x, tz - z), k = Math.min(1, 18 / d)
        x += (tx - x) * k; z += (tz - z) * k
        a.send(stateMsg(x, z)); await sleep(240)
      }
    }
    for (let i = 0; i < 16; i++) { a.send(stateMsg(shop.x, shop.z)); await sleep(240) }
    const rep = await a.wait(c => { const r = c.snaps.at(-1).ch.reps[c.id]; return r && r[2] >= 1 && r }, 6000)
    assert.ok(rep[2] >= 1, '修理が1回終わった')
    // ヘリ: 手配度を上げる。予告の円の真ん中で止まって待つ
    race.heatBonus = 4
    const warn = await a.wait(c => (c.snaps.at(-1).ch.strikes || []).find(s => s.target === c.id), 15000)
    for (let i = 0; i < 12; i++) { a.send(stateMsg(warn.x, warn.z)); await sleep(200) }
    const bl = await a.wait(c => (c.snaps.at(-1).ch.blasts || []).find(b => b.id === warn.id), 4000)
    assert.deepEqual(bl.hit, [a.id], '予告の円にいた犯人に当たる')
  } finally { await srv.close() }
})

// 人の動きを描画なしで試す: 走る / 壁を登る / ワイヤーでスイング / 巻き取り / 運河
import { createWorld } from '../public/shared/track.js'
import { createRunner, stepRunner, findAnchor, RUN } from '../public/shared/runner.js'
import { createNav } from '../public/shared/citynav.js'
const world = createWorld('city'), nav = createNav(world)
const dt = 1 / 60
let fails = 0
const ok = (name, cond, info = '') => { console.log((cond ? 'OK  ' : 'NG  ') + name + (info ? '  ' + info : '')); if (!cond) fails++ }
const run = (r, sec, inpFn) => { const evs = []; for (let i = 0; i < sec * 60; i++) { stepRunner(r, inpFn(i * dt, r), dt, world); evs.push(...r.events); r.events.length = 0 } return evs }
// 大通りの交差点から北へ
const n = nav.list.find(n => n.i === 4 && n.j === 4)
const sp = { x: n.x, z: n.z, yaw: 0, y: 0 }
let r = createRunner({ id: 'me', spawn: sp })
run(r, 2, () => ({ throttle: 1 }))
ok('走る（2秒で約10m/s）', Math.abs(Math.hypot(r.vx, r.vz) - RUN.walk) < 0.5 && r.grounded, `v=${Math.hypot(r.vx, r.vz).toFixed(1)} z+${(r.z - sp.z).toFixed(1)}`)
// 跳ぶ
let evs = run(r, 0.05, () => ({ throttle: 1, jump: true })); let maxY = 0
evs = evs.concat(run(r, 1.5, (t, rr) => { maxY = Math.max(maxY, rr.y); return { throttle: 1 } }))
ok('ジャンプで約1.7m上がって着地', maxY > 1.4 && maxY < 2.2 && r.grounded, `maxY=${maxY.toFixed(2)}`)
// ワイヤー: 掛けてスイング
r = createRunner({ id: 'me', spawn: sp })
run(r, 1.5, () => ({ throttle: 1 }))
const a = findAnchor(world, r)
ok('前の建物にワイヤーの点が見つかる', !!a, a ? `len=${a.len.toFixed(1)} y=${a.y.toFixed(1)}` : '')
let wires = 0, top = 0, dist0 = r.z, maxV = 0
evs = run(r, 6, (t, rr) => { top = Math.max(top, rr.y); maxV = Math.max(maxV, Math.hypot(rr.vx, rr.vz)); return { throttle: 1, wire: Math.floor(t * 4) % 3 === 0 && !rr.rope } })
wires = evs.filter(e => e.t === 'wire').length
ok('6秒間ワイヤーを掛け続けて進める', wires >= 3 && Math.hypot(r.x - sp.x, r.z - sp.z) > 90, `掛けた=${wires} 進んだ=${Math.hypot(r.x - sp.x, r.z - sp.z).toFixed(0)}m 最高${top.toFixed(1)}m 最速${maxV.toFixed(1)}m/s 外れた(自動)=${evs.filter(e => e.t === 'unwire' && e.auto).length} miss=${evs.filter(e => e.t === 'wireMiss').length}`)
// 巻き取り
r = createRunner({ id: 'me', spawn: sp })
run(r, 1, () => ({ throttle: 1 }))
run(r, 0.1, () => ({ throttle: 1, wire: true }))
const y0 = r.y
evs = run(r, 2.5, (t, rr) => ({ throttle: 1, boost: true })) // 巻き取りは押している間ずっと
let peak = r.y
ok('巻き取りで上へ飛ぶ', evs.some(e => e.t === 'zip') && evs.some(e => e.zip), `events=${[...new Set(evs.map(e => e.t))].join(',')}`)
// 壁を登る: 建物の壁へ向かって走る
const b = world.colliders.find(o => o.kind === 'building' && o.y1 > 20 && o.y1 < 45 && Math.abs(o.cx) < 300 && o.cz > 200)
const wx = b.cx, wz = b.cz - b.hl - 6
r = createRunner({ id: 'me', spawn: { x: wx, z: wz, yaw: 0, y: 0 } })
let climbed = false
evs = run(r, 8, (t, rr) => { if (rr.onRoof) climbed = true; return { throttle: 1 } })
ok('壁を駆け上がって屋上に乗る', climbed && Math.abs(r.y - b.y1) < 0.3, `高さ${b.y1.toFixed(1)}m 今y=${r.y.toFixed(1)} events=${[...new Set(evs.map(e => e.t))].join(',')}`)
// 屋上から飛び降りて着地（落下で壊れない）
// 運河: 南北の運河へ走り込む
const cz = world.nav.canal.z0 - 30
r = createRunner({ id: 'me', spawn: { x: nav.list.find(n => n.i === 1 && n.j === 3).x + 40, z: cz, yaw: 0, y: 0 } })
evs = run(r, 8, () => ({ throttle: 1, jump: true }))
ok('運河に落ちたら手前に戻る', evs.some(e => e.t === 'splash') && r.y > -0.5, `y=${r.y.toFixed(2)} z=${r.z.toFixed(0)} 運河${world.nav.canal.z0.toFixed(0)}`)
console.log(fails ? `NG ${fails}件` : '全部OK')
process.exit(fails ? 1 : 0)

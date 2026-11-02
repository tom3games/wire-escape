// 人の動きを描画なしで試す: 走る / 壁を登る / ワイヤーでスイング / 巻き取り / 運河
import { createWorld } from '../public/shared/track.js?v=6'
import { createRunner, stepRunner, findAnchor, RUN } from '../public/shared/runner.js?v=6'
import { createNav } from '../public/shared/citynav.js?v=6'
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
// 巻き取りのボタンは無い（2026-11-02）。boost を押しても引き寄せない。振り子の下では自動で少しずつ縮む
const len0 = r.rope ? r.rope.len : 0
let maxPull = 0, minLen = 1e9
evs = run(r, 1.2, (t, rr) => { if (rr.rope) { minLen = Math.min(minLen, rr.rope.len); const d = Math.hypot(rr.rope.x - rr.x, rr.rope.z - rr.z) || 1; maxPull = Math.max(maxPull, (rr.vx * (rr.rope.x - rr.x) + rr.vz * (rr.rope.z - rr.z)) / d) } return { throttle: 1, boost: true } })
ok('巻き取りボタンは効かない（zip が出ない）', !evs.some(e => e.t === 'zip' || e.zip), `events=${[...new Set(evs.map(e => e.t))].join(',')}`)
ok('自動の巻き取りで少しずつ縮む（1.2秒で 0.5〜15m）', len0 > 0 && len0 - minLen > 0.5 && len0 - minLen < 15, `len ${len0.toFixed(1)}→${minLen.toFixed(1)}`)
// 遠すぎる所を押したら × （wireMiss far）か、その向きで届く所に掛かる。届く距離より遠くには掛からない
r = createRunner({ id: 'me', spawn: sp })
run(r, 0.5, () => ({ throttle: 1 }))
evs = run(r, 0.1, () => ({ throttle: 1, wire: true, wireAt: { x: r.x + 300, y: 60, z: r.z + 300 } }))
const wv = evs.find(e => e.t === 'wire'), wm = evs.find(e => e.t === 'wireMiss')
ok('遠すぎる所: 届く範囲で掛かるか × になる', (wv && Math.hypot(wv.x - r.x, wv.z - r.z) <= RUN.wireRange + 2) || (wm && wm.far), JSON.stringify(wv || wm))
// 壁を登る: 建物の壁へ向かって走る
const b = world.colliders.find(o => o.kind === 'building' && o.y1 > 20 && o.y1 < 45 && Math.abs(o.cx) < 300 && o.cz > 200)
const wx = b.cx, wz = b.cz - b.hl - 6
r = createRunner({ id: 'me', spawn: { x: wx, z: wz, yaw: 0, y: 0 } })
let climbed = false
evs = run(r, 8, (t, rr) => { if (rr.onRoof) climbed = true; return { throttle: 1 } })
ok('壁を駆け上がって屋上に乗る', climbed && Math.abs(r.y - b.y1) < 0.3, `高さ${b.y1.toFixed(1)}m 今y=${r.y.toFixed(1)} events=${[...new Set(evs.map(e => e.t))].join(',')}`)
// 壁に張り付いて這う: 登り始めてから、止まる（落ちない）・右・左・下へ動ける・跳ぶと離れる
r = createRunner({ id: 'me', spawn: { x: wx, z: wz, yaw: 0, y: 0 } })
run(r, 1.2, () => ({ throttle: 1 }))
const c0 = !!r.climbing, y0c = r.y
run(r, 1, () => ({}))
const hang = !!r.climbing && Math.abs(r.y - y0c) < 0.5
const xa = r.x, za = r.z
run(r, 0.8, () => ({ wallX: 1 }))
const right = Math.hypot(r.x - xa, r.z - za)
const xb = r.x, zb = r.z
run(r, 0.8, () => ({ wallX: -1 }))
const left = Math.hypot(r.x - xb, r.z - zb)
const yd0 = r.y
run(r, 0.5, () => ({ wallY: -1 }))
const down = yd0 - r.y
const yu0 = r.y
run(r, 0.4, () => ({ wallY: 1 }))
const up = r.y - yu0
const stillOn = !!r.climbing
run(r, 0.1, () => ({ jump: true }))
ok('壁に張り付いて止まれる・左右上下に這える・跳ぶと離れる', c0 && hang && right > 2 && left > 2 && down > 1.5 && up > 1.5 && stillOn && !r.climbing, JSON.stringify({ c0, hang, right: +right.toFixed(1), left: +left.toFixed(1), down: +down.toFixed(1), up: +up.toFixed(1), off: !r.climbing }))
// 屋上から飛び降りて着地（落下で壊れない）
// 運河: 南北の運河へ走り込む
const cz = world.nav.canal.z0 - 30
r = createRunner({ id: 'me', spawn: { x: nav.list.find(n => n.i === 1 && n.j === 3).x + 40, z: cz, yaw: 0, y: 0 } })
evs = run(r, 8, () => ({ throttle: 1, jump: true }))
ok('運河に落ちたら手前に戻る', evs.some(e => e.t === 'splash') && r.y > -0.5, `y=${r.y.toFixed(2)} z=${r.z.toFixed(0)} 運河${world.nav.canal.z0.toFixed(0)}`)
console.log(fails ? `NG ${fails}件` : '全部OK')
process.exit(fails ? 1 : 0)

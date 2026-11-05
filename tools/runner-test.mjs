// 人の動きを描画なしで試す: 走る / 壁を登る / ワイヤーでスイング / 巻き取り / 運河
import { createWorld } from '../public/shared/track.js?v=11'
import { createRunner, stepRunner, findAnchor, aimTap, RUN } from '../public/shared/runner.js?v=11'
import { createNav } from '../public/shared/citynav.js?v=11'
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
// 地面ワイヤー（2026-11-03 本人「空中に浮いてる間は地面にもワイヤーつけて加速」）
const gp = (rr, ahead = 25) => ({ x: rr.x, y: world.groundAt(rr.x, rr.z + ahead, 0).h, z: rr.z + ahead, ground: true })
r = createRunner({ id: 'me', spawn: sp })
run(r, 1, () => ({ throttle: 1 }))
evs = run(r, 0.1, (t, rr) => ({ throttle: 1, wire: t === 0, wireAt: gp(rr) }))
ok('地面ワイヤー: 地面にいる時は掛からない（跳びもしない）', !r.rope && evs.some(e => e.t === 'wireMiss' && e.ground) && !evs.some(e => e.t === 'jump'), JSON.stringify(evs.map(e => e.t)))
const airborne = (y = 18, vz = 10) => { const rr = createRunner({ id: 'me', spawn: sp }); Object.assign(rr, { y, vz, grounded: false }); return rr }
r = airborne()
const pt = gp(r, 30)
let maxStep = 0, relY = null, rise = 0, t25 = null, vRope = 0, landUp = 0, landed = false
evs = []
for (let i = 0; i < 4 * 60; i++) {
  const x0 = r.x, y0 = r.y, z0 = r.z
  stepRunner(r, { wire: i === 0, wireAt: i === 0 ? pt : null }, dt, world)
  if (i === 0) ok('地面ワイヤー: 空中なら掛かる', !!(r.rope && r.rope.ground), JSON.stringify(r.events.map(e => e.t)))
  const v = Math.hypot(r.vx, r.vy, r.vz)
  if (r.rope) { maxStep = Math.max(maxStep, Math.hypot(r.x - x0, r.y - y0, r.z - z0)); vRope = Math.max(vRope, v); if (t25 == null && v >= 25) t25 = (i + 1) * dt }
  for (const e of r.events) { evs.push(e); if (e.t === 'unwire' && e.ground && relY == null) relY = r.y }
  if (relY != null) { rise = Math.max(rise, r.y - relY); if (r.grounded) landed = true; if (landed) landUp = Math.max(landUp, r.vy) }
  r.events.length = 0
}
// 2026-11-03 本人「地面にワイヤー刺してもあんまり加速できない」「着いてからバウンドしてしまう」
ok('地面ワイヤー: 0.3秒で 25m/s・掛けている間に 30m/s 以上（最高速は超えない）', t25 != null && t25 <= 0.3 && vRope >= 30 && vRope <= RUN.maxSpeed + 1e-6, `25m/s まで${t25 && t25.toFixed(2)}秒 最高${vRope.toFixed(1)}m/s`)
ok('地面ワイヤー: 床の近くで外れたら跳ねない（上がる高さ 0.05m 以内）・着地後に上へ動かない', relY != null && rise <= 0.05 && landed && landUp <= 0, `上がった${rise.toFixed(3)}m 着地後の最大vy=${landUp.toFixed(2)}`)
ok('地面ワイヤー: 掛けている間の1ステップは最高速×dt 以下（瞬間移動しない）', maxStep <= RUN.maxSpeed * dt + 1e-6, `${maxStep.toFixed(3)}m / ${(RUN.maxSpeed * dt).toFixed(3)}m`)
r = airborne()
evs = run(r, 1.5, (t, rr) => ({ wire: Math.floor(t * 6) % 2 === 0 }))
ok('地面ワイヤー: ワイヤーボタン（狙いなし）では空中でも地面に掛からない', !evs.some(e => e.ground), `wire=${evs.filter(e => e.t === 'wire').length}`)
r = airborne(); r.role = 'cop'
evs = run(r, 0.1, (t, rr) => ({ wire: t === 0, wireAt: gp(rr) }))
ok('地面ワイヤー: 警官は使わない', !r.rope && evs.some(e => e.t === 'wireMiss'), '')
// 画面のタップ: 空中で真下（道）を押すと地面、地面にいる時は地面にならない、建物の壁を押すと建物
{
  const o = { x: sp.x, y: 20, z: sp.z }, dn = [0, -0.6, 0.8]
  const ga = aimTap(world, o.x, o.y, o.z, ...dn, true), gg = aimTap(world, o.x, o.y, o.z, ...dn, false)
  const wb = world.colliders.find(c => c.kind === 'building' && c.y1 > 25 && Math.abs(c.cx - sp.x) < 200 && c.cz > sp.z + 40)
  const tx = wb.cx - o.x, tz = wb.cz - wb.hl - o.z, ty = 12 - o.y, L = Math.hypot(tx, ty, tz)
  const wa = aimTap(world, o.x, o.y, o.z, tx / L, ty / L, tz / L, true)
  ok('タップ: 空中の道は地面ワイヤー・地面にいれば地面にしない・壁は建物', ga && ga.ground && !(gg && gg.ground) && wa && !wa.ground, JSON.stringify({ ga, gg, wa }).slice(0, 200))
}
console.log(fails ? `NG ${fails}件` : '全部OK')
process.exit(fails ? 1 : 0)

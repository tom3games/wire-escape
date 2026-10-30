// 走って追う警官の CPU（2026-10-30 本人「車早すぎ。相手も人間が走ってきて」）。
// 近い（70m）ときは犯人へまっすぐ走る。建物にぶつかれば壁を駆け上がり、屋上を越えてくる（runner.js の壁登り）。
// 遠いときは道なりに（chase.planCop の経路）。手配度3からはワイヤーも使う。
export function copRunnerBot(ch, e, dt) {
  const c = e.car, dr = e.driver
  if (ch.t < 3) return {} // 犯人に3秒の先行
  const rob = ch.nearestRobber(c)
  if (!rob) return {}
  if (c.net > 0 || c.pit > 0) return {}
  dr.replan = (dr.replan ?? 0) - dt
  if (dr.replan <= 0 || !dr.plan) { dr.replan = 0.6; ch.planCop(e); dr.known = ch.knownRobber(e, rob) }
  const k = dr.known || { x: rob.car.x, z: rob.car.z, live: false }
  const r = rob.car
  const d = Math.hypot(k.x - c.x, k.z - c.z)
  let tx, tz
  if (k.live && d < 70) { tx = k.x + (r.vx || 0) * 0.25; tz = k.z + (r.vz || 0) * 0.25 }
  else {
    const pts = dr.plan.pts
    while (dr.idx < pts.length - 1 && Math.hypot(pts[dr.idx].x - c.x, pts[dr.idx].z - c.z) < 8) dr.idx++
    const p = pts[Math.min(pts.length - 1, dr.idx + 1)]
    tx = p.x; tz = p.z
  }
  // 見張り役は隠れ家の前で待つ
  if (ch.guardId() === e.id && Math.hypot(c.x - ch.hideout.x, c.z - ch.hideout.z) < 10) return {}
  let diff = Math.atan2(tx - c.x, tz - c.z) - c.yaw
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  const inp = { throttle: Math.abs(diff) > 2 && c.grounded ? 0.5 : 1, steer: Math.max(-1, Math.min(1, -diff * 2.5)) }
  // 犯人が少し上（低い屋根・柵の上）で近いなら跳ぶ
  e.botT = (e.botT || 0) + dt
  if (c.grounded && d < 6 && r.y - c.y > 1 && e.botT > 0.6) { inp.jump = true; e.botT = 0 }
  // 手配度3から: 離れていて犯人が高い所・空中にいれば、ワイヤーで追う
  if (ch.heat >= 3 && k.live && d > 30 && (r.y - c.y > 6 || !r.grounded)) {
    if (!c.rope && !c.climbing && (c.grounded || c.vy < 1) && e.botT > 0.35 && !e.botPrev) { inp.wire = true; e.botT = 0 }
  }
  e.botPrev = !!inp.wire
  return inp
}

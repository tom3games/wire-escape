// CPU のワイヤーの人（タイトル画面のデモと、逮捕・逃げ切りの釣り合いを測るのに使う）。
// 逃げる道は車の CPU 犯人と同じ考え方（chase.planRobber: 警察から遠い交差点へ）。警察が近いとワイヤーで飛ぶ

export function runnerBot(ch, e, dt) {
  const r = e.car, dr = e.driver
  // ネットと落とし穴: 連打で抜ける（穴はワイヤーで出る）
  if (r.net > 0 || r.pit > 0) {
    // 人が押せる速さ（1秒に約7回）で連打する
    e.botMashT = (e.botMashT || 0) + dt
    const press = e.botMashT > 0.14
    if (press) e.botMashT = 0
    return r.pit > 0 ? { wire: press } : { jump: press }
  }
  dr.replan = (dr.replan ?? 0) - dt
  if (dr.replan <= 0 || !dr.plan) { dr.replan = 1.0; ch.planRobber(e) }
  const pts = dr.plan.pts
  // 近づいた点は飛ばす
  while (dr.idx < pts.length - 1 && Math.hypot(pts[dr.idx].x - r.x, pts[dr.idx].z - r.z) < 14) dr.idx++
  const p = pts[Math.min(pts.length - 1, dr.idx + 1)]
  const want = Math.atan2(p.x - r.x, p.z - r.z)
  let diff = want - r.yaw
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  const inp = { throttle: Math.abs(diff) > 2.2 && r.grounded ? 0.4 : 1, steer: Math.max(-1, Math.min(1, -diff * 2.2)) }
  // 警察が近いほど飛ぶ。地上で囲まれそうなら必ず飛ぶ
  const near = ch.nearestCopDist(r)
  const swing = near < 140 || e.bust > 0.05 || !r.grounded
  e.botT = (e.botT || 0) + dt
  if (swing && !r.rope && !r.climbing && (r.grounded || r.vy < 1) && e.botT > 0.25 && !e.botPrev) { inp.wire = true; e.botT = 0 }
  // 掛けたワイヤーで、警察がすぐ下にいたら巻き取りで逃げる
  if (r.rope && near < 30 && r.zipCd <= 0 && !e.botPrev) inp.boost = true
  e.botPrev = !!(inp.wire || inp.boost)
  // 曲がり角の手前では向きを先に変える
  if (Math.abs(diff) > 1.2 && r.grounded) inp.throttle = 0.6
  return inp
}

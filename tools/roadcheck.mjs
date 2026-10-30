// 道の中心線の上に、建物・壁などの固い箱がかかっていないかを調べる
import { createWorld } from '../public/shared/track.js'
for (const stage of ['city', 'touge']) {
  const w = createWorld(stage)
  const bad = new Map()
  for (const r of w.roads) for (let i = 0; i < r.pts.length - 1; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1]
    const L = Math.hypot(bx - ax, bz - az)
    for (let d = 0; d <= L; d += 2) {
      const x = ax + (bx - ax) * d / L, z = az + (bz - az) * d / L
      for (const o of w.nearby(x, z)) {
        if (o.slab || o.id || o.kind === 'rail' || o.kind === 'bound') continue
        const c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0), dx = x - o.cx, dz = z - o.cz
        const u = dx * c - dz * s, v = dx * s + dz * c
        // 道の半分の幅まで見る（車が通る範囲）
        if (Math.abs(u) < o.hw + r.w / 2 - 1 && Math.abs(v) < o.hl + r.w / 2 - 1 && Math.abs(u) < o.hw + 0.5 && Math.abs(v) < o.hl + 0.5) {
          const k = `${o.kind}@${o.cx.toFixed(0)},${o.cz.toFixed(0)}`
          if (!bad.has(k)) bad.set(k, `${k} on road w${r.w} at ${x.toFixed(0)},${z.toFixed(0)}`)
        }
      }
    }
  }
  console.log(stage, bad.size ? [...bad.values()].slice(0, 30).join('\n  ') : 'OK')
}

// 街の道のつながり（交差点を点、通りを辺にした網）。警察と犯人の CPU が道なりに目的地へ向かうのに使う。
// 運河は橋のある通りでしか渡れない（跳ね橋は飛ぶ近道なので、網には入れない）。
const key = (i, j) => i * 100 + j

export function createNav(world) {
  const N = world.nav
  if (!N) return null
  const { XS, ZS, canal, bridges } = N
  const nodes = new Map()
  for (let i = 0; i < XS.length; i++) for (let j = 0; j < ZS.length; j++) nodes.set(key(i, j), { id: key(i, j), i, j, x: XS[i], z: ZS[j], adj: [] })
  const link = (a, b) => { nodes.get(a).adj.push(b); nodes.get(b).adj.push(a) }
  for (let i = 0; i < XS.length; i++) for (let j = 0; j < ZS.length; j++) {
    if (i + 1 < XS.length) link(key(i, j), key(i + 1, j))
    if (j + 1 < ZS.length) {
      const crossesCanal = ZS[j] < canal.z0 && ZS[j + 1] > canal.z1
      if (!crossesCanal || bridges.includes(XS[i])) link(key(i, j), key(i, j + 1))
    }
  }
  const list = [...nodes.values()]
  const sameSide = (z1, z2) => (z1 < canal.z0) === (z2 < canal.z0)

  // 車のいる場所から入る交差点。前にある点を優先する（来た道を戻らない）
  function entry(x, z, yaw = null) {
    let best = null, bc = 1e18
    for (const n of list) {
      const d = Math.hypot(n.x - x, n.z - z)
      if (d > 260) continue
      if (!sameSide(n.z, z) && !bridges.some(bx => Math.abs(bx - x) < 20)) continue
      let c = d
      if (yaw != null && d > 8) {
        const dot = ((n.x - x) * Math.sin(yaw) + (n.z - z) * Math.cos(yaw)) / d
        if (dot < -0.2) c += 500 // 後ろの交差点へは戻らない（Uターンしない）
      }
      if (c < bc) { bc = c; best = n }
    }
    return best || nearest(x, z)
  }
  function nearest(x, z) {
    let best = null, bd = 1e18
    for (const n of list) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n } }
    return best
  }
  // A*。penalty(node) で点ごとの追加の重さ（警察のそばを避ける、など）
  function path(from, to, penalty = null) {
    if (!from || !to) return []
    const open = new Map([[from.id, 0]]), g = new Map([[from.id, 0]]), prev = new Map()
    const h = n => Math.hypot(n.x - to.x, n.z - to.z)
    let guard = 0
    while (open.size && guard++ < 2000) {
      let cur = null, cf = 1e18
      for (const [id, f] of open) if (f < cf) { cf = f; cur = id }
      if (cur === to.id) break
      open.delete(cur)
      const cn = nodes.get(cur)
      const pv = prev.has(cur) ? nodes.get(prev.get(cur)) : null
      for (const nb of cn.adj) {
        const nn = nodes.get(nb)
        // 曲がる回数が少ない道を選ぶ（同じ長さなら、まっすぐ走れるほうが速い）
        const turn = pv && ((pv.x === cn.x) !== (cn.x === nn.x)) ? 60 : 0
        const ng = g.get(cur) + Math.hypot(nn.x - cn.x, nn.z - cn.z) + turn + (penalty ? penalty(nn) : 0)
        if (ng < (g.get(nb) ?? 1e18)) { g.set(nb, ng); prev.set(nb, cur); open.set(nb, ng + h(nn)) }
      }
    }
    if (!prev.has(to.id) && from.id !== to.id) return [from]
    const out = [to]
    let k = to.id
    while (k !== from.id) { k = prev.get(k); out.unshift(nodes.get(k)) }
    return out
  }
  return { nodes, list, entry, nearest, path, bounds: { x0: XS[0], x1: XS[XS.length - 1], z0: ZS[0], z1: ZS[ZS.length - 1] } }
}

// 場所の呼び名（無線で使う）
export function areaName(world, x, z) {
  const N = world.nav
  if (!N) return ''
  if (z > N.canal.z0 - 70 && z < N.canal.z1 + 70) return '運河沿い'
  if (Math.abs(x) < N.downtownX && z >= N.downtownZ) return 'ダウンタウン'
  const ns = z > N.mid ? '北' : '南'
  const ew = x > N.downtownX * 0.6 ? '東' : x < -N.downtownX * 0.6 ? '西' : ''
  return ns + ew + '地区'
}
export function headingName(vx, vz) {
  if (Math.hypot(vx, vz) < 3) return ''
  return Math.abs(vx) > Math.abs(vz) ? (vx > 0 ? '東' : '西') : (vz > 0 ? '北' : '南')
}

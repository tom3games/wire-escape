// プレイヤーの保存データ（所持金・車ごとの改造・塗装）。このブラウザの localStorage にだけ置く
import { CARS, UPGRADES, clampLevel } from '../shared/config.js'

const KEY = 'we-profile-v1'

function fresh() {
  const cars = {}
  for (const id of Object.keys(CARS)) cars[id] = { levels: {}, paint: CARS[id].color }
  return { name: '', credits: 600, car: 'runner', cars, cpu: 4, races: 0, best: null, stage: 'city', role: 'robber', wins: 0 }
}

export function loadProfile() {
  let p = null
  try { p = JSON.parse(localStorage.getItem(KEY) || 'null') } catch {}
  const f = fresh()
  if (!p || typeof p !== 'object') return f
  p = { ...f, ...p, cars: { ...f.cars, ...(p.cars || {}) } }
  if (!CARS[p.car]) p.car = 'runner'
  p.stage = 'city' // 警察と犯人は街だけ
  if (p.role !== 'cop' && p.role !== 'robber') p.role = 'robber'
  for (const id of Object.keys(CARS)) {
    const c = p.cars[id] || (p.cars[id] = { levels: {}, paint: CARS[id].color })
    for (const k of Object.keys(UPGRADES)) c.levels[k] = clampLevel(c.levels?.[k])
  }
  p.credits = Math.max(0, Math.floor(Number(p.credits) || 0))
  p.cpu = Math.max(1, Math.min(6, Math.round(Number(p.cpu) || 3)))
  return p
}

export function saveProfile(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch {}
}

export function buyUpgrade(p, key) {
  const c = p.cars[p.car]
  const lv = c.levels[key] || 0
  const u = UPGRADES[key]
  if (!u || lv >= 3) return false
  const cost = u.cost[lv]
  if (p.credits < cost) return false
  p.credits -= cost
  c.levels[key] = lv + 1
  saveProfile(p)
  return true
}

// 上げた改造を1段下げる（半額を返す）。トレードオフを試し直せるように
export function sellUpgrade(p, key) {
  const c = p.cars[p.car]
  const lv = c.levels[key] || 0
  if (lv <= 0) return false
  p.credits += Math.floor(UPGRADES[key].cost[lv - 1] / 2)
  c.levels[key] = lv - 1
  saveProfile(p)
  return true
}

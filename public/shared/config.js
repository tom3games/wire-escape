// ゲーム全体の調整値。ブラウザとサーバーの両方が読む（three.js に依存しない）。
// 車の挙動・耐久・ブースト・改造・報酬はここだけ触れば変えられる。

export const GAME = {
  title: 'WIRE ESCAPE',          // 表示名はここだけ
  titleJa: 'ワイヤーエスケープ',
  maxPlayers: 8,
  minPlayers: 1,
  countdownSec: 4,
  finishGraceSec: 45,            // 1位がゴールしてから締め切るまで
  respawnFreezeSec: 1.2,         // 手動リスポーンの停止時間
  wreckRespawnSec: 1.3,          // 大破してから戻るまで
  knockSec: 1.1,                 // 体当たりで倒されてから戻るまで
  wreckRepairTo: 0.55,           // 大破から戻ったときの各部位の下限
  fallY: -32,                    // これより下は落下扱い
  step: 1 / 60,                  // 物理の固定ステップ
  netHz: 30,                     // 自車の状態を送る頻度
  snapHz: 20                     // サーバーが全車を配る頻度
}

export const PHYS = {
  driftMaxTan: 0.62,             // ドリフト中の横滑り角の上限（tan 32度）。2026-10-26 「滑りすぎ」で追加
  driftGrip: 0.42,               // ドリフトボタン中の横グリップ（倍率）。前 0.16
  brakeDriftGrip: 0.55,          // 曲がりながらブレーキ中の横グリップ。前 0.3
  driftYaw: 1.9,                 // ドリフト中の曲がりやすさ。前 1.45
  straighten: 4,                 // ハンドルを戻したとき向きを進む向きへ寄せる速さ。前 2.2
  gravity: 22,          // 実際より重め。ジャンプが間延びしない
  rideHeight: 0.55,     // 車体原点から接地面まで
  suspTravel: 0.38,
  stepUp: 1.1,          // これ以下の段差は乗り上げる
  carRadius: 1.15,      // 当たり判定の円（前後2つ）
  carHalfLen: 1.2,
  aeroDrag: 0.00045,
  rolling: 0.9,
  airRate: 2.6,         // 空中の姿勢変化の速さ（rad/s）
  safeLand: 14,         // これより遅い着地は無傷（m/s, 面の法線方向）
  maxPlausibleSpeed: 95 // サーバーの瞬間移動チェック（m/s）
}

// 路面ごとのグリップと抵抗
export const SURFACE = {
  road:  { grip: 1.0,  roll: 1.0, name: 'road' },
  dirt:  { grip: 0.82, roll: 1.6, name: 'dirt' },
  grass: { grip: 0.7,  roll: 2.4, name: 'grass' },
  wood:  { grip: 0.9,  roll: 1.2, name: 'wood' }
}

// 車種。値は係数（1 = 基準車）
export const CARS = {
  runner: {
    name: 'RUNNER', nameJa: 'ランナー', desc: '癖のない基準車', descEn: 'Balanced all-rounder',
    mass: 1.0, maxSpeed: 46, accel: 19, grip: 9.0, steer: 2.3, durability: 1.0, boost: 1.0, air: 1.0, color: 0xe8432e
  },
  bruiser: {
    name: 'BRUISER', nameJa: 'ブルーザー', desc: '重くて硬い。壁を割りやすい', descEn: 'Heavy and tough. Smashes walls',
    mass: 1.35, maxSpeed: 44, accel: 16.5, grip: 8.4, steer: 2.05, durability: 1.55, boost: 1.05, air: 0.8, color: 0x2f7fe0
  },
  dart: {
    name: 'DART', nameJa: 'ダート', desc: '軽くて速い。壊れやすい', descEn: 'Light and quick. Fragile',
    mass: 0.8, maxSpeed: 48, accel: 21, grip: 9.4, steer: 2.5, durability: 0.7, boost: 1.0, air: 1.3, color: 0xf2c230
  }
}

// 改造。レベル0〜3。上げると何かが下がる
export const UPGRADES = {
  engine:     { name: 'エンジン',     nameEn: 'Engine',     cost: [300, 600, 1000], up: '最高速と加速', down: 'グリップと発熱',
                apply: (s, l) => { s.maxSpeed *= 1 + 0.04 * l; s.accel *= 1 + 0.05 * l; s.grip *= 1 - 0.03 * l; s.heat *= 1 + 0.12 * l } },
  turbo:      { name: 'ターボ',       nameEn: 'Turbo',      cost: [250, 500, 900],  up: 'ブースト量と推力', down: '冷却',
                apply: (s, l) => { s.boostCap *= 1 + 0.15 * l; s.boostForce *= 1 + 0.08 * l; s.heat *= 1 + 0.1 * l } },
  tires:      { name: 'タイヤ',       nameEn: 'Tires',      cost: [200, 450, 800],  up: 'グリップ', down: '最高速',
                apply: (s, l) => { s.grip *= 1 + 0.08 * l; s.maxSpeed *= 1 - 0.015 * l } },
  suspension: { name: 'サスペンション', nameEn: 'Suspension', cost: [250, 500, 850],  up: '着地の強さと空中制御', down: '重量',
                apply: (s, l) => { s.landing *= 1 + 0.18 * l; s.air *= 1 + 0.1 * l; s.mass *= 1 + 0.03 * l } },
  armor:      { name: '装甲',         nameEn: 'Armor',      cost: [300, 600, 1000], up: '耐久', down: '重量（加速が落ちる）',
                apply: (s, l) => { s.durability *= 1 + 0.22 * l; s.mass *= 1 + 0.08 * l } },
  weight:     { name: '軽量化',       nameEn: 'Lightweight', cost: [250, 500, 850], up: '加速', down: '耐久',
                apply: (s, l) => { s.mass *= 1 - 0.06 * l; s.durability *= 1 - 0.1 * l } }
}

export const PAINTS = [0xe8432e, 0x2f7fe0, 0xf2c230, 0x2fbf71, 0xf07acb, 0xeeeeee, 0x2b2b30, 0xff8a1f]

// 壊せる物の種類。breakAt は「衝突の法線速度 × 車の重さ係数」の閾値（m/s）
// absorb は壊したときに失う速度の割合、hard は壊せなかったときの硬さ（ダメージ倍率）
export const DESTRUCT = {
  cone:      { breakAt: 1,  absorb: 0.01, hard: 0.1, debris: 3,  color: 0xff7a1a, w: 0.6, l: 0.6, h: 0.8 },
  barricade: { breakAt: 3,  absorb: 0.04, hard: 0.3, debris: 6,  color: 0xf4f4f4, w: 3.0, l: 0.5, h: 1.1 },
  fence:     { breakAt: 5,  absorb: 0.06, hard: 0.4, debris: 8,  color: 0x9b6a3c, w: 4.0, l: 0.3, h: 1.4 },
  tempfence: { breakAt: 6,  absorb: 0.07, hard: 0.4, debris: 6,  color: 0x8aa0b0, w: 4.0, l: 0.3, h: 2.0 },
  sign:      { breakAt: 5,  absorb: 0.05, hard: 0.4, debris: 5,  color: 0x2e8bd8, w: 2.4, l: 0.4, h: 2.6 },
  lamp:      { breakAt: 9,  absorb: 0.08, hard: 0.7, debris: 4,  color: 0x6d7480, w: 0.5, l: 0.5, h: 6.5 },
  lumber:    { breakAt: 19, absorb: 0.25, hard: 1.1, debris: 12, color: 0xc4904f, w: 3.2, l: 2.2, h: 1.6 },
  guardrail: { breakAt: 13, absorb: 0.12, hard: 0.9, debris: 4,  color: 0xc9ced6, w: 4.2, l: 0.4, h: 0.9 },
  wall:      { breakAt: 31, absorb: 0.42, hard: 1.6, debris: 22, color: 0xa65a3f, w: 16,  l: 1.2, h: 6.0 },
  tree:      { breakAt: 8,  absorb: 0.14, hard: 0.8, debris: 8,  color: 0x3f7a3a, w: 0.9, l: 0.9, h: 14 },
  parked:    { breakAt: 15, absorb: 0.22, hard: 0.9, debris: 6,  color: 0x6d7480, w: 1.9, l: 4.3, h: 1.4 },
  signal:    { breakAt: 9,  absorb: 0.08, hard: 0.7, debris: 4,  color: 0x2b2e33, w: 0.5, l: 0.5, h: 5.2 },
  tower:     { breakAt: 14, absorb: 0.18, hard: 0.9, debris: 8,  color: 0xe0a020, w: 1.6, l: 1.6, h: 48 }
}

// ダメージの係数
export const DAMAGE = {
  wallBase: 0.0011,     // 壁衝突: (法線速度-9)^1.3 * これ * 硬さ（2026-10-26 本人「耐久値上げて」で 0.0032 から約3分の1に）
  wallFree: 9,          // これ以下の速さで当てても傷まない（7 から上げた）
  landBase: 0.0045,
  boostMul: 1.2,        // ブースト中の衝突は重い（1.35 から下げた）
  carHit: 0.25          // 車同士（0.35 から下げた。ぶつけ合いが主役なので壊れにくく）
}

// 警察と犯人（2026-10-26 本人「レースではなく警察と犯人に。警察は捕まえたら勝ち」）
export const CHASE = {
  timeLimit: 180,        // この秒数を逃げ切れば犯人の勝ち
  hideoutOpenAt: 90,     // この秒数から隠れ家が開く（着けば犯人の勝ち）
  hideoutRadius: 14,
  hideoutClearCop: 40,   // 隠れ家に入るとき、警察がこれより近いと入れない（見られている）
  bustDist: 10,          // 犯人のまわりこの距離に警察がいて
  bustSpeed: 11,         // 犯人がこれより遅いと逮捕ゲージがたまる（m/s、時速40km）
  boxSpeed: 20,          // 2台以上に囲まれているときは、これより遅いとたまる（時速72km）
  touchSpeed: 25,        // 警察がぴったりくっついている（5.5m 以内）ときは、これより遅いとたまる（時速90km）
  bustFill: 2.0,         // 満タンまでの秒数
  bustDrain: 0.4,        // 離れたときに減る速さ（毎秒）
  copDurability: 0.75,   // 警察車の耐久（車の耐久に掛ける）
  copRamTaken: 20,       // 犯人に突っ込まれたときだけ警察車が受ける損傷の倍率（全力の体当たり2〜3回で大破）
  copWreckSec: 6.5,      // 警察車が大破してから復帰するまで（その場で燃えて残る）
  copCatch: 0.35,        // 離された CPU 警察の追い上げ（最大の速さの上乗せ）。警察車が壊れて減る分、0.2→0.35
  robberRb: 0.95,        // CPU 犯人の速さ
  copBackMin: 160, copBackMax: 300, // 復帰する場所（犯人からの距離）
  wreckBustDist: 45,     // 犯人が大破したとき、この距離に警察がいれば逮捕
  heatEvery: 35,         // 手配度はこの秒数ごとに1上がる（最大5）
  seeDist: 130,          // 警察の画面に犯人が見える距離（これより遠いと無線の目撃情報だけ）
  pingEvery: [0, 12, 10, 7, 5, 3.5], // 手配度ごとの無線（地図に犯人を出す）の間隔
  pingShow: 2.2,         // 地図に出しておく秒数
  heli: 3,               // この手配度からヘリが照らす
  copSpawnMin: 220, copSpawnMax: 420,
  // 修理工場（GTA の塗装屋の考え方）: 中で止まって数秒で全回復。犯人は警察に見られていると直せない。
  // 犯人が直すと手配度が1下がり、警察は見失う（無線の目撃情報が消える）。使ったあとはしばらく使えない
  repairSec: 3,          // 止まっている秒数（速さ 3m/s 未満）
  repairCooldown: 40,    // 使ったあと同じ車が使えない秒数
  repairSeen: 40,        // 犯人の修理: この距離に警察がいると直せない
  // 警察ヘリのランチャー（手配度3から）。上空から追い、地面に赤い円で予告してから撃つ
  heliEvery: [0, 0, 0, 6, 4.5, 3.5], // 手配度ごとの発射の間隔（秒）
  heliFirstShot: 4,      // ヘリが出てから最初に撃つまで
  heliSpeed: 48, heliAlt: 42,
  strikeWarn: 1.8,       // 予告（赤い円）から着弾までの秒数
  strikeLead: 1.5,       // 犯人がそのまま走ったら来る場所（この秒数先）を狙う
  strikeRadius: 7,       // 着弾の半径
  strikeDamage: 0.3,     // 車体へのダメージ（耐久 1 の車で 30%）。車体は 8% より下がらない（ミサイルだけでは大破しない）
  strikeKick: 13, strikeLift: 9,
  // 拳銃（2026-10-27 本人「手配度が上がるとパトカーが拳銃を撃ってくるように」）。警察の CPU だけが撃つ
  gunHeat: 2,            // この手配度から撃つ
  gunRange: 60,          // 届く距離。建物の陰には当たらない
  gunEvery: [0, 0, 1.5, 1.2, 0.95, 0.75], // 手配度ごとの1台あたりの発射の間隔（秒）
  gunHit: 0.6, gunHitMin: 0.15, // 命中率（近くて遅いほど当たる）
  gunDamage: 0.015,      // 1発で車体 1.5%（耐久 1 の車）
  gunFloor: 0.3,         // 弾だけでは車体はこれより下がらない（警察が増えても弾だけで瀕死にはしない）
  gunRunner: 0.06,       // ワイヤーの人への1発（体力の6%）
  gunRunnerFloor: [1, 1, 0.25, 0.25, 0, 0], // 手配度ごとの、弾だけで下がる体力の下限（4からは撃たれ続けると倒れる）
  downBustDist: 25,      // 人が倒れたとき（体力が尽きた）、この距離の地上に警察がいれば逮捕
  // スパイクベルト（2026-10-27 本人「タイヤをパンクさせるあれを敷いてくるやつもほしい」）
  spikeHeat: 4,          // この手配度から敷く
  spikeEvery: [0, 0, 0, 0, 12, 8], // 手配度ごとの間隔（秒）
  spikeLead: 2.6,        // 犯人がそのまま走ったらこの秒数後に来る所
  spikeAheadMin: 55,     // ただし犯人からこれより近くには置かない（見てから避けられるように）
  spikeCover: 0.62,      // 道の幅のうち塞ぐ割合（残りの片側を通れば避けられる）
  spikeLife: 16,         // 置いてから消えるまで（秒）
  spikeMax: 2,
  // 捕獲ネット（2026-10-30 本人「警察は捕獲ネットも使ってくるように」）。パトカーが人の行き先を読んで撃つ。弾速は見てから避けられる速さ
  netHeat: 1,
  netRange: 45,          // 届く距離（高さ込み）。建物の陰には撃たない
  netEvery: [0, 6, 5, 4.5, 4, 3.5], // 手配度ごとの1台あたりの間隔（秒）
  netGap: 1.4,           // 警察全体で、次のネットまでの最短の間（同時に何発も来ないように）
  netSpeed: 30, netGravity: 6, netLife: 2.2,
  netRadius: 1.6,        // 当たりの半径
  // 落とし穴（2026-10-30 本人「地面に落とし穴ができるとか」）。人が地上にいると、行く手の道に予告の輪→穴が開く
  pitHeat: 2,
  pitEvery: [0, 0, 10, 8, 6.5, 5], // 手配度ごとの間隔（秒）
  pitWarn: 1.0,          // 予告から穴が開くまで
  pitLife: 7,            // 開いている秒数
  pitRadius: 3.2,
  pitLead: 1.0,          // 人がそのまま走ったらこの秒数後に来る所
  pitMax: 3,
  // 応援のパトカー（2026-10-27 本人「警察の車ももっと増やして」）。手配度が上がるたびに、最初の台数に足す数（オフラインだけ）
  backup: [0, 0, 1, 2, 3, 4],
  maxCops: 14,           // 応援込みの警察の上限
  maxCpuStart: 10        // 最初に選べる警察の数の上限
}

// 報酬（ゲーム内通貨）。保存は各プレイヤーのブラウザ
export const REWARD = {
  place: [700, 520, 420, 340, 280, 240, 210, 190],
  finish: 100,
  perBreak: 8,
  breakCap: 240,
  dnf: 80,
  takedown: 120
}

// 車種と改造レベルから実際の性能値を作る。サーバーでも同じ関数で作るので画面からの値は信じない
export function buildStats(carId, levels = {}) {
  const c = CARS[carId] || CARS.runner
  const s = {
    car: CARS[carId] ? carId : 'runner',
    mass: c.mass, maxSpeed: c.maxSpeed, accel: c.accel, grip: c.grip, steer: c.steer,
    durability: c.durability, air: c.air, landing: 1,
    boostCap: 3.2 * c.boost, boostForce: 15 * c.boost, boostTop: 16, heat: 1
  }
  for (const [k, u] of Object.entries(UPGRADES)) {
    const l = clampLevel(levels[k])
    if (l) u.apply(s, l)
  }
  // 重いほど加速が鈍る
  s.accel /= Math.sqrt(s.mass)
  return s
}

export function clampLevel(v) {
  const n = Math.round(Number(v) || 0)
  return Math.max(0, Math.min(3, n))
}

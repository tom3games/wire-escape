// 端末ごとの描画の重さ。スマホ（タッチが主の端末）は軽くする
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
const small = Math.min(screen.width, screen.height) < 700
export const LOW = coarse || small
export const Q = LOW
  ? { pixelRatio: Math.min(devicePixelRatio, 1.25), shadow: 1024, shadowRange: 45, trees: 0.45, tufts: 0.3, bloom: false, msaa: 0, tex: 'tex512', sky: 'sky_1k', carLite: true }
  : { pixelRatio: Math.min(devicePixelRatio, 1.75), shadow: 2048, shadowRange: 70, trees: 1, tufts: 1, bloom: true, msaa: 4, tex: 'tex', sky: 'sky_2k', carLite: false }

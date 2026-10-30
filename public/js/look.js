// 見た目の土台: 実写の空（HDRI）での照明・太陽・霞・画面の後処理・実写テクスチャの材質。
// 素材は Poly Haven（CC0）。public/assets にある。
import * as THREE from 'three'
import { Q } from './quality.js'
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from '../vendor/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js'

const loader = new THREE.TextureLoader()
const cache = new Map()
let maxAniso = 8

export function setAniso(renderer) { maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy()) }

// 1つの素材（色・法線・粗さ）を読む。repeat はワールド座標で何 m ごとに繰り返すかを使う側で決める
export function tex(name, map, srgb = false) {
  const key = name + map
  if (cache.has(key)) return cache.get(key)
  const t = loader.load(`assets/${Q.tex}/${name}_${map}.webp`)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = maxAniso
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  cache.set(key, t)
  return t
}

export function pbr(name, { repeat = 1, color = 0xffffff, roughness = 1, normalScale = 1, ...rest } = {}) {
  // 繰り返しは箱投影の倍率で決めるので、テクスチャ自体は共有する（読み込み前の複製は警告の元）
  const map = tex(name, 'diff', true), nor = tex(name, 'nor_gl'), rough = tex(name, 'rough')
  return new THREE.MeshStandardMaterial({ map, normalMap: nor, roughnessMap: rough, roughness, color, normalScale: new THREE.Vector2(normalScale, normalScale), ...rest })
}

// ---------------------------------------------------------------- 空と太陽
// 空は実写（Poly Haven の HDRI をトーンマップした画像。20〜55KB）。太陽の向きは元の HDR から求めた値
export const SKY_SUN = [0.5546, 0.742, 0.3767]
export function loadSky(renderer, scene, sun, onReady) {
  new THREE.TextureLoader().load(`assets/hdri/${Q.sky}.webp`, sky => {
    sky.mapping = THREE.EquirectangularReflectionMapping
    sky.colorSpace = THREE.SRGBColorSpace
    const pm = new THREE.PMREMGenerator(renderer)
    scene.environment = pm.fromEquirectangular(sky).texture
    scene.background = sky
    scene.backgroundIntensity = 1.0
    scene.environmentIntensity = 1.0
    pm.dispose()
    const dir = new THREE.Vector3(...SKY_SUN).normalize()
    sun.userData.dir = dir
    onReady && onReady(dir)
  })
}

// ---------------------------------------------------------------- 後処理
// 光のにじみ（強い光だけ）＋ 色の整え（彩度・コントラスト・周辺減光）＋ 速度の放射ぼかし
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, speed: { value: 0 }, vignette: { value: 0.32 }, sat: { value: 1.08 }, contrast: { value: 1.04 }, hurt: { value: 0 } },
  vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: [
    'uniform sampler2D tDiffuse;', 'uniform float speed;', 'uniform float vignette;', 'uniform float sat;', 'uniform float contrast;', 'uniform float hurt;', 'varying vec2 vUv;',
    'void main() {',
    '  vec2 c = vUv - 0.5;',
    '  vec4 col = texture2D(tDiffuse, vUv);',
    // 速いときだけ画面の外側を中心から放射状にぼかす
    '  if (speed > 0.01) {',
    '    float k = speed * smoothstep(0.12, 0.7, length(c));',
    '    vec4 acc = col;',
    '    for (int i = 1; i <= 6; i++) { acc += texture2D(tDiffuse, vUv - c * k * 0.02 * float(i)); }',
    '    col = acc / 7.0;',
    '  }',
    '  float l = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));',
    '  col.rgb = mix(vec3(l), col.rgb, sat);',
    '  col.rgb = (col.rgb - 0.18) * contrast + 0.18;',
    '  col.rgb *= 1.0 - vignette * smoothstep(0.35, 0.85, length(c * vec2(1.25, 1.0)));',
    '  col.rgb = mix(col.rgb, col.rgb * vec3(1.25, 0.55, 0.5), hurt * smoothstep(0.25, 0.8, length(c)));',
    '  gl_FragColor = col;',
    '}'
  ].join('\n')
}

export function makeComposer(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2())
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Q.msaa })
  const composer = new EffectComposer(renderer, rt)
  composer.addPass(new RenderPass(scene, camera))
  // 光のにじみは重いのでスマホでは使わない
  const bloom = Q.bloom ? new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.5, 0.92) : null
  if (bloom) composer.addPass(bloom)
  const grade = new ShaderPass(GradeShader)
  composer.addPass(grade)
  composer.addPass(new OutputPass())
  return { composer, bloom, grade }
}

// ---------------------------------------------------------------- ワールド座標で貼る
// UV を持たない形（箱を組んだ建物・橋・岩）に、面の向きで投影した UV を与える（箱投影）
export function boxMap(material, scale = 0.25) {
  material.onBeforeCompile = sh => {
    sh.uniforms.boxScale = { value: scale }
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float boxScale;')
      .replace('#include <uv_vertex>', [
        '#include <uv_vertex>',
        'vec4 bwp = vec4(position, 1.0);',
        '#ifdef USE_INSTANCING', 'bwp = instanceMatrix * bwp;', '#endif',
        'bwp = modelMatrix * bwp;',
        'vec3 bnr = normal;',
        '#ifdef USE_INSTANCING', 'bnr = mat3(instanceMatrix) * bnr;', '#endif',
        'bnr = abs(normalize(mat3(modelMatrix) * bnr));',
        'vec2 buv = bnr.y > max(bnr.x, bnr.z) ? bwp.xz : (bnr.x > bnr.z ? vec2(bwp.z, bwp.y) : bwp.xy);',
        'buv *= boxScale;',
        '#ifdef USE_MAP', 'vMapUv = buv;', '#endif',
        '#ifdef USE_NORMALMAP', 'vNormalMapUv = buv;', '#endif',
        '#ifdef USE_ROUGHNESSMAP', 'vRoughnessMapUv = buv;', '#endif'
      ].join('\n'))
  }
  material.customProgramCacheKey = () => 'box' + scale
  return material
}

// ---------------------------------------------------------------- 地形（草・土・岩・舗装を混ぜる）
// 頂点ごとの重み splat = (草, 土, 岩, 舗装)。岩は斜面で歪まないよう3方向から投影する
export function terrainMaterial() {
  const t = n => tex(n, 'diff', true)
  const m = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, vertexColors: false })
  const maps = { tGrass: t('rocky_terrain_02'), tDirt: t('forest_leaves_02'), tRock: t('rock_face'), tCity: t('concrete_wall_004'), tSoil: t('dirt') }
  m.onBeforeCompile = sh => {
    for (const [k, v] of Object.entries(maps)) sh.uniforms[k] = { value: v }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nattribute float soil;\nvarying vec4 vSplat;\nvarying float vSoil;\nvarying vec3 vTW;\nvarying vec3 vTN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat; vSoil = soil;\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTN = normalize(mat3(modelMatrix) * objectNormal);')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tGrass, tDirt, tRock, tCity, tSoil;\nvarying vec4 vSplat;\nvarying float vSoil;\nvarying vec3 vTW;\nvarying vec3 vTN;\n' +
        'vec3 tri(sampler2D s, vec3 p, vec3 n, float k) { vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z); return texture2D(s, p.zy * k).rgb * w.x + texture2D(s, p.xz * k).rgb * w.y + texture2D(s, p.xy * k).rgb * w.z; }')
      .replace('#include <map_fragment>', [
        'vec2 wp = vTW.xz;',
        // 同じ柄の繰り返しが目立たないよう、2つの大きさで取って混ぜる
        'vec3 g = mix(texture2D(tGrass, wp * 0.21).rgb, texture2D(tGrass, wp * 0.043).rgb, 0.45) * vec3(1.0, 1.02, 0.95);',
        'vec3 d = mix(texture2D(tDirt, wp * 0.17).rgb, texture2D(tDirt, wp * 0.05).rgb, 0.4) * vec3(0.8, 0.85, 0.7);',
        'vec3 r = tri(tRock, vTW, vTN, 0.06);',
        'vec3 c = texture2D(tCity, wp * 0.12).rgb * vec3(0.92, 0.92, 0.95);',
        'vec3 so = texture2D(tSoil, wp * 0.15).rgb;',
        'vec4 w = vSplat / max(1e-3, vSplat.x + vSplat.y + vSplat.z + vSplat.w);',
        'vec3 col = g * w.x + d * w.y + r * w.z + c * w.w;',
        'col = mix(col, so, vSoil);',
        // 大きなむら（明るさの揺らぎ）
        'float mac = texture2D(tGrass, wp * 0.004).g;',
        'col *= 0.8 + mac * 0.45;',
        'diffuseColor.rgb *= col;'
      ].join('\n'))
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness - vSplat.w * 0.12;')
  }
  m.customProgramCacheKey = () => 'terrain'
  return m
}

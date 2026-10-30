// 使い方: 作業用フォルダで npm i @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
//         CarConcept.glb を置いて node process-car.mjs（スマホ用は OUT=car_lite.glb RATIO=0.12 ERR=0.003 TEX=512）
// CarConcept（Khronos, CC-BY 4.0, Eric Chadwick / DGG）をゲーム用に軽くする。ロゴは全部外す
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup, weld, simplify, textureCompress } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read('CarConcept.glb')
const root = doc.getRoot()
// 1) 見えない・不要・ロゴ入りの部品を消す
const drop = /^(License Plate|InteriorSteeringEmblem|InteriorPedal|InteriorFloormats|InteriorFloor$|InteriorDoor|InteriorRearHatch|InteriorRearPanels|Engine|Axles|BodyHoodInterior|BodyHoodUnder|InteriorCage|InteriorMid)/
for (const n of root.listNodes()) if (drop.test(n.getName() || '')) n.dispose()
// 2) ロゴの画像を使っている所を外す
const logoish = new Set()
for (const t of root.listTextures()) {
  const img = t.getImage(); if (!img) continue
  // ロゴの画像は 512x128（Khronos ロゴ）と、タイヤ側面の色・凹凸（1024 と 512x512 のうち側面用）
}
for (const m of root.listMaterials()) {
  const name = m.getName() || ''
  if (name === 'License') { m.dispose(); continue }
  // 発光テクスチャにロゴが入っている（発光は0だが画像として残る）
  if (m.getEmissiveTexture() && name !== 'Dashboard') m.setEmissiveTexture(null)
  if (name === 'Tireside') { m.setBaseColorTexture(null); m.setNormalTexture(null); m.setBaseColorFactor([0.025, 0.025, 0.027, 1]) }
}
// 3) 色違いの拡張（使わない）を外す
for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'KHR_materials_variants') ext.dispose()
await doc.transform(prune(), dedup(), weld())
// 4) 面を減らす（形が崩れない範囲）
await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Number(process.env.RATIO || 0.32), error: Number(process.env.ERR || 0.0008) }))
// 5) 画像を小さく・webp に
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [Number(process.env.TEX || 1024), Number(process.env.TEX || 1024)], quality: 82 }), prune())
for (const t of root.listTextures()) if (t.listParents().length <= 1) t.dispose()
await io.write(process.env.OUT || 'car.glb', doc)
let tris = 0
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3
console.log('tris', tris, 'materials', root.listMaterials().map(m => m.getName()).join(','), 'textures', root.listTextures().length)

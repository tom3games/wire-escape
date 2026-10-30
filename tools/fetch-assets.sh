#!/bin/sh
# Poly Haven（CC0）から素材を取って webp にする。public/assets に置く。
# 使い方: sh tools/fetch-assets.sh
set -e
cd "$(dirname "$0")/../public/assets"
mkdir -p tex hdri
get() { # name res
  for m in diff nor_gl rough; do
    case $m in diff) K=Diffuse;; nor_gl) K=nor_gl;; rough) K=Rough;; esac
    url=$(curl -s "https://api.polyhaven.com/files/$1" | python3 -c "import sys,json;print(json.load(sys.stdin)['$K']['$2']['jpg']['url'])")
    curl -s -o "${TMPDIR:-/tmp}/btr_$1_$m.jpg" "$url"
    cwebp -quiet -q 82 "${TMPDIR:-/tmp}/btr_$1_$m.jpg" -o "tex/$1_$m.webp"
    rm -f "${TMPDIR:-/tmp}/btr_$1_$m.jpg"
  done
}
for t in asphalt_02 rocky_terrain_02 forest_leaves_02 rock_face dirt concrete_wall_004 japanese_cedar_bark; do get $t 1k; done
# ビルの外壁（public/js/facade.js がアトラスに組む）
for t in rectangular_facade_tiles concrete_panels red_brick_03 plastered_wall_04 corrugated_iron; do get $t 1k; done
# 空: トーンマップ済みの画像を縮めて webp に（太陽の向きは public/js/look.js の SKY_SUN）
url=$(curl -s https://api.polyhaven.com/files/kloofendal_48d_partly_cloudy_puresky | python3 -c "import sys,json;print(json.load(sys.stdin)['tonemapped']['url'])")
curl -s -o "${TMPDIR:-/tmp}/btr_sky.jpg" "$url"
for w in 2048 1024; do
  sips -s format jpeg -z $((w / 2)) $w "${TMPDIR:-/tmp}/btr_sky.jpg" --out "${TMPDIR:-/tmp}/btr_sky_$w.jpg" >/dev/null
  cwebp -quiet -q 80 "${TMPDIR:-/tmp}/btr_sky_$w.jpg" -o "hdri/sky_$((w / 1024))k.webp"
done
# スマホ用の小さいテクスチャ
mkdir -p tex512
for f in tex/*.webp; do cwebp -quiet -q 78 -resize 512 512 "$f" -o "tex512/$(basename "$f")"; done
ls -la tex tex512 hdri

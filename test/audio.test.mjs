// 風の音（2026-11-03 本人「謎の水の音がずっと鳴ってる」）: 地面では鳴らさない・空中で 16m/s から・最大 0.35。素材は継ぎ目なしの WAV
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { windVol } from '../public/js/audio.js?v=6'

test('風の音量: 地面 0、空中で min(0.35, (v-16)/40)', () => {
  for (const v of [0, 6, 20, 40]) assert.equal(windVol(v, false), 0, `地面 ${v}m/s`)
  assert.equal(windVol(6, true), 0, '走る速さでは鳴らない')
  assert.equal(windVol(16, true), 0)
  assert.ok(Math.abs(windVol(26, true) - 0.25) < 1e-9)
  assert.equal(windVol(41, true), 0.35)
  assert.equal(windVol(80, true), 0.35)
})

test('風は air_01（一発の音）ではなく wind_loop.wav をループする', () => {
  const src = readFileSync(new URL('../public/js/audio.js', import.meta.url), 'utf8')
  assert.match(src, /wind: \['wind_loop\.wav'\]/)
  assert.ok(statSync(new URL('../public/snd/wind_loop.wav', import.meta.url)).size > 100000)
  assert.match(readFileSync(new URL('../public/CREDITS.md', import.meta.url), 'utf8'), /wind_loop\.wav: Howling wind \/ Tvabutzku1234 \/ CC0/)
})

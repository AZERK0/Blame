import * as THREE from 'three'
import type { SceneQuality } from './hero-scene'

export type TerrainTextures = {
  color: THREE.CanvasTexture
  bump?: THREE.CanvasTexture
  roughness?: THREE.CanvasTexture
}

type StoneTextureKind = 'color' | 'bump' | 'roughness'

export function createStoneTextures(
  renderer: THREE.WebGLRenderer,
  quality: SceneQuality,
): TerrainTextures {
  const color = createStoneTexture('color', renderer, quality)

  if (!quality.useDetailedTerrainMaterial) {
    return { color }
  }

  return {
    color,
    bump: createStoneTexture('bump', renderer, quality),
    roughness: createStoneTexture('roughness', renderer, quality),
  }
}

function createStoneTexture(
  kind: StoneTextureKind,
  renderer: THREE.WebGLRenderer,
  quality: SceneQuality,
) {
  const canvas = document.createElement('canvas')
  canvas.width = quality.terrainTextureSize
  canvas.height = quality.terrainTextureSize

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to create stone texture canvas context')
  }

  const image = context.createImageData(canvas.width, canvas.height)
  const data = image.data

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const index = (y * canvas.width + x) * 4
      const u = x / canvas.width
      const v = y / canvas.height
      const broadStone = fbm2(u * 5.4 + 19.1, v * 5.4 - 7.3, 6)
      const packedGrain = fbm2(u * 18.5 - 3.6, v * 18.5 + 42.2, 5)
      const pebbleRelief = fbm2(u * 42.0 + 8.7, v * 42.0 - 11.9, 4)
      const weathering = fbm2(
        u * 9.0 + broadStone * 1.8,
        v * 9.0 - packedGrain * 1.2,
        4,
      )
      const mineralFleck = Math.max(0, pebbleRelief - 0.72) * 92
      const stoneValue = THREE.MathUtils.clamp(
        92 +
          broadStone * 76 +
          packedGrain * 38 +
          weathering * 24 +
          mineralFleck,
        58,
        218,
      )

      if (kind === 'bump') {
        const bump = THREE.MathUtils.clamp(
          62 + broadStone * 118 + packedGrain * 54 + pebbleRelief * 42,
          34,
          242,
        )
        data[index] = bump
        data[index + 1] = bump
        data[index + 2] = bump
        data[index + 3] = 255
        continue
      }

      if (kind === 'roughness') {
        const roughness = THREE.MathUtils.clamp(
          194 + weathering * 38 - mineralFleck * 0.18,
          166,
          246,
        )
        data[index] = roughness
        data[index + 1] = roughness
        data[index + 2] = roughness
        data[index + 3] = 255
        continue
      }

      data[index] = stoneValue * 0.64
      data[index + 1] = stoneValue * 0.78
      data[index + 2] = stoneValue * 0.9
      data[index + 3] = 255
    }
  }

  context.putImageData(image, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace =
    kind === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(kind === 'color' ? 2.7 : 3.1, kind === 'color' ? 2.7 : 3.1)
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.anisotropy = Math.min(
    renderer.capabilities.getMaxAnisotropy(),
    quality.anisotropyCap,
  )
  return texture
}

export function fbm2(x: number, y: number, octaves: number) {
  let value = 0
  let amplitude = 0.5
  let frequency = 1
  let amplitudeTotal = 0

  for (let octave = 0; octave < octaves; octave += 1) {
    value += valueNoise2(x * frequency, y * frequency) * amplitude
    amplitudeTotal += amplitude
    frequency *= 2.03
    amplitude *= 0.52
  }

  return value / amplitudeTotal
}

function valueNoise2(x: number, y: number) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const xFade = smoothNoiseFraction(x - x0)
  const yFade = smoothNoiseFraction(y - y0)
  const bottomLeft = hashNoise2(x0, y0)
  const bottomRight = hashNoise2(x0 + 1, y0)
  const topLeft = hashNoise2(x0, y0 + 1)
  const topRight = hashNoise2(x0 + 1, y0 + 1)
  const bottom = THREE.MathUtils.lerp(bottomLeft, bottomRight, xFade)
  const top = THREE.MathUtils.lerp(topLeft, topRight, xFade)

  return THREE.MathUtils.lerp(bottom, top, yFade)
}

function smoothNoiseFraction(value: number) {
  return value * value * value * (value * (value * 6 - 15) + 10)
}

export function hashNoise2(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
  return value - Math.floor(value)
}

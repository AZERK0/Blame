'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'

const TERRAIN_SIZE = 132
const TERRAIN_SEGMENTS = 192
const SUN_ELEVATION_DEGREES = 5.2
const SUN_AZIMUTH_DEGREES = -166
const SUN_DIRECTION = createSunDirection()
const TWILIGHT_FOG_COLOR = 0x3666ff;
const TERRAIN_TEXTURE_SIZE = 512

type SceneState = {
  cleanup: () => void
}

type TerrainTextures = {
  color: THREE.CanvasTexture
  bump: THREE.CanvasTexture
  roughness: THREE.CanvasTexture
}

type SunMaterials = {
  core: THREE.MeshBasicMaterial
  halo: THREE.SpriteMaterial
}

export function HeroScene() {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return undefined
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return undefined
    }

    const sceneState = createHeroScene(container)

    return () => {
      sceneState.cleanup()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="absolute inset-0 -z-20"
    />
  )
}

function createHeroScene(container: HTMLDivElement): SceneState {
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(TWILIGHT_FOG_COLOR, 0.012)

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500000)
  camera.position.set(0, 7.4, 21)

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.62
  renderer.shadowMap.enabled = false
  container.appendChild(renderer.domElement)

  const sky = createAtmosphericSky()
  scene.add(sky)

  const terrainTextures = createStoneTextures(renderer)
  const terrain = createTerrain(terrainTextures)
  scene.add(terrain)

  const atmosphericHaze = createAtmosphericHaze()
  scene.add(atmosphericHaze)

  const ambientLight = new THREE.HemisphereLight(0xbdc3fd, 0x07101f, 0.78)
  scene.add(ambientLight)

  const sunLight = new THREE.DirectionalLight(0xb3acf3, 2.8)
  sunLight.position.copy(SUN_DIRECTION).multiplyScalar(34)
  scene.add(sunLight)

  const sunFill = new THREE.PointLight(0x9799fc, 26, 110, 1.45)
  sunFill.position.copy(SUN_DIRECTION).multiplyScalar(38)
  scene.add(sunFill)

  const iceLight = new THREE.DirectionalLight(0x9799fc, 0.48)
  iceLight.position.set(15, 5, 15)
  scene.add(iceLight)

  const pointer = new THREE.Vector2(0, 0)
  const targetPointer = new THREE.Vector2(0, 0)
  const clock = new THREE.Clock()

  const resize = () => {
    const { width, height } = container.getBoundingClientRect()
    renderer.setSize(width, height, false)
    camera.aspect = width / Math.max(height, 1)
    camera.updateProjectionMatrix()
  }

  const handlePointerMove = (event: PointerEvent) => {
    const bounds = container.getBoundingClientRect()
    targetPointer.x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2
    targetPointer.y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2
  }

  window.addEventListener('resize', resize)
  window.addEventListener('pointermove', handlePointerMove)
  resize()

  let animationFrame = 0

  const animate = () => {
    const elapsed = clock.getElapsedTime()
    pointer.lerp(targetPointer, 0.045)

    camera.position.x = pointer.x * 1.1
    camera.position.y = 7.4 - pointer.y * 0.32
    camera.lookAt(pointer.x * 1.8, -0.52, -8.5)

    terrain.rotation.z = Math.sin(elapsed * 0.08) * 0.006 + pointer.x * 0.012
    atmosphericHaze.material.uniforms.uTime.value = elapsed

    renderer.render(scene, camera)
    animationFrame = requestAnimationFrame(animate)
  }

  animate()

  return {
    cleanup: () => {
      cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', handlePointerMove)
      disposeObject3D(sky)
      disposeObject3D(terrain)
      disposeObject3D(atmosphericHaze)
      terrainTextures.color.dispose()
      terrainTextures.bump.dispose()
      terrainTextures.roughness.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

function createTerrain(textures: TerrainTextures) {
  const terrain = new THREE.Group()
  terrain.add(createTerrainMesh(textures, 0, -3.05, -9, 1.04))
  terrain.add(createTerrainMesh(textures, 24, -2.25, -54, 0.82))
  return terrain
}

function createTerrainMesh(
  textures: TerrainTextures,
  offset: number,
  y: number,
  z: number,
  scale: number,
) {
  const geometry = new THREE.PlaneGeometry(
    TERRAIN_SIZE,
    TERRAIN_SIZE,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  )
  geometry.rotateX(-Math.PI / 2)

  const positions = geometry.attributes.position

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index)
    const z = positions.getZ(index)
    const distanceFromBasin = Math.sqrt((x - 4) ** 2 + (z + 24) ** 2)
    const packedNoise = fbm2((x + offset * 0.52) * 0.058, z * 0.058, 5)
    const coarseNoise = fbm2((x - offset) * 0.025 + 31.7, z * 0.025 - 12.4, 4)
    const horizonRise = THREE.MathUtils.smoothstep(-z, 4, 72) * 9.2
    const longitudinalFold =
      Math.sin((z + offset * 0.28) * 0.19 + x * 0.052 + coarseNoise * 1.35) *
        0.5 +
      0.5
    const diagonalFold =
      Math.sin(x * 0.145 - z * 0.082 + offset * 0.16 + packedNoise * 1.1) *
        0.5 +
      0.5
    const striatedRidges = THREE.MathUtils.smoothstep(
      0.48,
      0.94,
      longitudinalFold,
    )
    const erodedChannels = THREE.MathUtils.smoothstep(0.36, 0.88, diagonalFold)
    const distantMesa =
      Math.exp(-((z + 48) ** 2) / 560) *
      (4.8 + Math.sin((x + offset) * 0.11) * 1.2)
    const diagonalEscarpment =
      Math.exp(-((x * 0.42 + z + 24 + offset * 0.22) ** 2) / 135) * 5.6
    const foregroundShelf =
      Math.exp(-((z - 18) ** 2) / 42) *
      (2.2 + Math.sin((x - offset) * 0.24) * 0.55)
    const stoneMass = (packedNoise - 0.5) * 1.55 + (coarseNoise - 0.5) * 1.25
    const windErosion =
      Math.sin(distanceFromBasin * 0.32 + coarseNoise * 4.2) * 0.16

    positions.setY(
      index,
      (horizonRise * 0.8 +
        distantMesa * 0.78 +
        diagonalEscarpment * 0.68 +
        foregroundShelf * 0.62 +
        striatedRidges * (1.4 + coarseNoise * 1.1) +
        erodedChannels * 0.76 +
        stoneMass * 0.86 +
        windErosion -
        4.65) *
        scale,
    )
  }

  geometry.computeVertexNormals()

  const material = new THREE.MeshStandardMaterial({
    color: 0x1d2a42,
    map: textures.color,
    bumpMap: textures.bump,
    bumpScale: 0.045,
    roughnessMap: textures.roughness,
    roughness: 0.92,
    metalness: 0,
    emissive: 0x071225,
    emissiveIntensity: 0.12,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.castShadow = false
  mesh.position.set(0, y, z)
  return mesh
}

function createAtmosphericHaze() {
  const geometry = new THREE.SphereGeometry(95, 48, 24)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uDuskColor: { value: new THREE.Color(0x202a55) },
      uHorizonColor: { value: new THREE.Color(0x5d5578) },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uDuskColor;
      uniform vec3 uHorizonColor;
      uniform float uTime;
      varying vec3 vWorldPosition;

      float hash(vec2 point) {
        return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 point) {
        vec2 cell = floor(point);
        vec2 local = fract(point);
        vec2 curve = local * local * (3.0 - 2.0 * local);

        float bottomLeft = hash(cell);
        float bottomRight = hash(cell + vec2(1.0, 0.0));
        float topLeft = hash(cell + vec2(0.0, 1.0));
        float topRight = hash(cell + vec2(1.0, 1.0));

        return mix(
          mix(bottomLeft, bottomRight, curve.x),
          mix(topLeft, topRight, curve.x),
          curve.y
        );
      }

      float fbm(vec2 point) {
        float value = 0.0;
        float amplitude = 0.5;
        mat2 rotation = mat2(0.8, -0.6, 0.6, 0.8);

        for (int octave = 0; octave < 4; octave += 1) {
          value += noise(point) * amplitude;
          point = rotation * point * 2.05 + 17.0;
          amplitude *= 0.5;
        }

        return value;
      }

      void main() {
        float distanceFade = smoothstep(9.0, 66.0, -vWorldPosition.z);
        float horizonBand = 1.0 - smoothstep(-0.4, 7.6, abs(vWorldPosition.y - 0.55));
        float groundLift = 1.0 - smoothstep(-2.0, 8.0, vWorldPosition.y);
        float drift = fbm(vWorldPosition.xz * 0.022 + vec2(uTime * 0.01, -uTime * 0.006));
        float veil = smoothstep(0.18, 0.82, drift) * 0.34 + 0.66;
        float warmCore = smoothstep(0.0, 0.72, horizonBand) * smoothstep(-22.0, 7.0, vWorldPosition.x);
        vec3 color = mix(uDuskColor, uHorizonColor, warmCore * 0.64);
        float alpha = distanceFade * horizonBand * groundLift * veil * 0.08;

        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.BackSide,
    blending: THREE.NormalBlending,
  })

  const haze = new THREE.Mesh(geometry, material)
  haze.position.set(0, -1.25, -19)
  haze.renderOrder = -40
  return haze
}

function createStoneTextures(renderer: THREE.WebGLRenderer): TerrainTextures {
  return {
    color: createStoneTexture('color', renderer),
    bump: createStoneTexture('bump', renderer),
    roughness: createStoneTexture('roughness', renderer),
  }
}

function createStoneTexture(
  kind: keyof TerrainTextures,
  renderer: THREE.WebGLRenderer,
) {
  const canvas = document.createElement('canvas')
  canvas.width = TERRAIN_TEXTURE_SIZE
  canvas.height = TERRAIN_TEXTURE_SIZE

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
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 16)
  return texture
}

function fbm2(x: number, y: number, octaves: number) {
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

function hashNoise2(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
  return value - Math.floor(value)
}

function createSunDirection() {
  const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION_DEGREES)
  const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH_DEGREES)

  return new THREE.Vector3().setFromSphericalCoords(1, phi, theta)
}

function createAtmosphericSky() {
  const sky = new Sky()
  sky.scale.setScalar(450000)

  const uniforms = sky.material.uniforms
  uniforms.turbidity.value = 8.8
  uniforms.rayleigh.value = 1.05
  uniforms.mieCoefficient.value = 0.012
  uniforms.mieDirectionalG.value = 0.79
  uniforms.cloudCoverage.value = 0.18
  uniforms.cloudDensity.value = 0.14
  uniforms.cloudElevation.value = 0.62
  uniforms.sunPosition.value.copy(SUN_DIRECTION)
  sky.material.fragmentShader = sky.material.fragmentShader.replace(
    'gl_FragColor = vec4( texColor, 1.0 );',
    `
      vec3 paletteZenith = vec3(0.024, 0.032, 1);
      vec3 paletteHorizon = vec3(0.260, 0.235, 1);
      vec3 paletteSun = vec3(0.470, 0.410, 1);
      float horizonTint = 1.0 - smoothstep(0.0, 0.58, direction.y);
      float sunTint = pow(max(dot(direction, vSunDirection), 0.0), 12.0);
      vec3 paletteColor = mix(paletteZenith, paletteHorizon, horizonTint);
      paletteColor = mix(paletteColor, paletteSun, sunTint * 0.38);
      texColor = mix(texColor * 0.38, paletteColor, 0.82);
      gl_FragColor = vec4( texColor, 1.0 );
    `,
  )

  if ('showSunDisc' in uniforms) {
    uniforms.showSunDisc.value = true
  }

  sky.material.depthWrite = false
  sky.material.depthTest = false
  sky.renderOrder = -1000
  return sky
}

function createRadialGlowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to create sun glow texture canvas context')
  }

  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(189, 195, 253, 1)')
  gradient.addColorStop(0.18, 'rgba(179, 172, 243, 0.82)')
  gradient.addColorStop(0.48, 'rgba(151, 153, 252, 0.28)')
  gradient.addColorStop(1, 'rgba(151, 153, 252, 0)')

  context.fillStyle = gradient
  context.fillRect(0, 0, canvas.width, canvas.height)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  return texture
}

function updateSunGlow(sun: THREE.Group, elapsed: number) {
  const materials = sun.userData.materials as SunMaterials | undefined

  if (!materials) {
    return
  }

  const heatPulse =
    Math.sin(elapsed * 1.45) * 0.5 + Math.sin(elapsed * 2.2) * 0.25
  materials.core.opacity = 0.96 + heatPulse * 0.018
  materials.halo.opacity = 0.52 + heatPulse * 0.04
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose())
    return
  }

  material.dispose()
}

function disposeObject3D(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Sprite) {
      child.material.map?.dispose()
      child.material.dispose()
      return
    }

    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.Line ||
      child instanceof THREE.Points
    ) {
      child.geometry.dispose()
      disposeMaterial(child.material)
    }
  })
}

'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'

const TERRAIN_SIZE = 132
const SUN_ELEVATION_DEGREES = 5.2
const SUN_AZIMUTH_DEGREES = -166
const SUN_DIRECTION = createSunDirection()
const TWILIGHT_FOG_COLOR = 0x3666ff
const PLUS_FIELD_RADIUS = 11.5
const PLUS_FIELD_BACK_Z = -80
const PLUS_FIELD_FRONT_Z = 0
const PLUS_FIELD_POINTER_X_RANGE = 40
const PLUS_FIELD_TERRAIN_CLEARANCE = 0.24
const PRIMARY_TERRAIN_OFFSET = 0
const PRIMARY_TERRAIN_Y = -5
const PRIMARY_TERRAIN_Z = -15
const PRIMARY_TERRAIN_SCALE = 2
const FRAME_DELTA_MAX = 0.1
const CAMERA_POINTER_RESPONSE = 7
const PLUS_FIELD_RESPONSE = 9
const PLUS_HEIGHT_RESPONSE = 20

type TerrainRelief = {
  heightScale: number
  horizonRise: number
  ridgeIntensity: number
  mesaIntensity: number
  escarpmentIntensity: number
  foregroundShelfIntensity: number
  stoneMassIntensity: number
  baseDepth: number
}

const terrainReliefPresets = {
  default: {
    heightScale: 1,
    horizonRise: 9.2,
    ridgeIntensity: 1,
    mesaIntensity: 1,
    escarpmentIntensity: 1,
    foregroundShelfIntensity: 1,
    stoneMassIntensity: 1,
    baseDepth: 4.65,
  },
  pricing: {
    heightScale: 0.74,
    horizonRise: 6.6,
    ridgeIntensity: 0.72,
    mesaIntensity: 1.28,
    escarpmentIntensity: 0.48,
    foregroundShelfIntensity: 0.36,
    stoneMassIntensity: 0.62,
    baseDepth: 3.9,
  },
} satisfies Record<string, TerrainRelief>

export type HeroSceneTerrainPreset = keyof typeof terrainReliefPresets

type HeroSceneProps = {
  terrainPreset?: HeroSceneTerrainPreset
}

type SceneState = {
  cleanup: () => void
}

type TerrainTextures = {
  color: THREE.CanvasTexture
  bump?: THREE.CanvasTexture
  roughness?: THREE.CanvasTexture
}

type SceneQuality = {
  terrainSegments: number
  terrainTextureSize: number
  plusFieldStep: number
  pixelRatioCap: number
  anisotropyCap: number
  plusHeightUpdateInterval: number
  plusHeightMoveThreshold: number
  useDetailedTerrainMaterial: boolean
}

type StoneTextureKind = 'color' | 'bump' | 'roughness'

type PlusMarker = {
  localX: number
  localZ: number
  scale: number
  rotation: number
  baseOpacity: number
  pulsePhase: number
  currentHeight: number
  targetHeight: number
}

type PlusField = {
  group: THREE.Group
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  markers: PlusMarker[]
  matrix: THREE.Matrix4
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
  euler: THREE.Euler
  lastHeightUpdate: number
  lastSampleX: number
  lastSampleZ: number
  terrainRelief: TerrainRelief
}

export function HeroScene({ terrainPreset = 'default' }: HeroSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return undefined
    }

    const sceneState = createHeroScene(container, terrainReliefPresets[terrainPreset])

    return () => {
      sceneState.cleanup()
    }
  }, [terrainPreset])

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="absolute inset-x-0 top-0 -z-20 h-screen"
    />
  )
}

function createSceneQuality(): SceneQuality {
  const navigatorProfile = navigator as Navigator & {
    connection?: { saveData?: boolean }
    deviceMemory?: number
  }
  const cores = navigator.hardwareConcurrency ?? 4
  const memory = navigatorProfile.deviceMemory ?? 8
  const saveData = navigatorProfile.connection?.saveData === true
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches
  const narrowViewport = window.innerWidth < 900
  const pixelLoad = window.innerWidth * window.innerHeight * window.devicePixelRatio ** 2

  if (saveData || coarsePointer || narrowViewport || cores <= 4 || memory <= 4) {
    return createLeanSceneQuality()
  }

  if (cores >= 10 && memory >= 8 && pixelLoad < 3_200_000) {
    return {
      terrainSegments: 128,
      terrainTextureSize: 192,
      plusFieldStep: 2.55,
      pixelRatioCap: 1.35,
      anisotropyCap: 6,
      plusHeightUpdateInterval: 1 / 45,
      plusHeightMoveThreshold: 0.1,
      useDetailedTerrainMaterial: true,
    }
  }

  return {
    terrainSegments: 96,
    terrainTextureSize: 160,
    plusFieldStep: 2.95,
    pixelRatioCap: 1.1,
    anisotropyCap: 4,
    plusHeightUpdateInterval: 1 / 36,
    plusHeightMoveThreshold: 0.14,
    useDetailedTerrainMaterial: false,
  }
}

function createLeanSceneQuality(): SceneQuality {
  return {
    terrainSegments: 64,
    terrainTextureSize: 128,
    plusFieldStep: 3.45,
    pixelRatioCap: 1,
    anisotropyCap: 2,
    plusHeightUpdateInterval: 1 / 30,
    plusHeightMoveThreshold: 0.18,
    useDetailedTerrainMaterial: false,
  }
}

function createSoftwareSceneQuality(): SceneQuality {
  return {
    terrainSegments: 48,
    terrainTextureSize: 96,
    plusFieldStep: 4.4,
    pixelRatioCap: 0.75,
    anisotropyCap: 1,
    plusHeightUpdateInterval: 1 / 24,
    plusHeightMoveThreshold: 0.24,
    useDetailedTerrainMaterial: false,
  }
}

function usesSoftwareRenderer(renderer: THREE.WebGLRenderer) {
  const context = renderer.getContext()
  const debugInfo = context.getExtension('WEBGL_debug_renderer_info')

  if (!debugInfo) {
    return false
  }

  const rendererName = String(
    context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
  ).toLowerCase()

  return /swiftshader|software|llvmpipe|mesa offscreen/.test(rendererName)
}

function createHeroScene(
  container: HTMLDivElement,
  terrainRelief: TerrainRelief,
): SceneState {
  let quality = createSceneQuality()
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(TWILIGHT_FOG_COLOR, 0.012)

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500000)
  camera.position.set(0, 7.4, 21)

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: false,
    powerPreference: 'high-performance',
  })
  if (usesSoftwareRenderer(renderer)) {
    quality = createSoftwareSceneQuality()
  }
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.62
  renderer.shadowMap.enabled = false
  container.appendChild(renderer.domElement)

  const sky = createAtmosphericSky()
  scene.add(sky)

  const terrainTextures = createStoneTextures(renderer, quality)
  const terrain = createTerrain(terrainTextures, quality, terrainRelief)
  scene.add(terrain)

  const plusField = createPlusField(quality, terrainRelief)
  terrain.add(plusField.group)

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
    renderer.setSize(width, height)
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
    const delta = Math.min(clock.getDelta(), FRAME_DELTA_MAX)
    const elapsed = clock.elapsedTime
    pointer.lerp(targetPointer, createFrameLerp(CAMERA_POINTER_RESPONSE, delta))

    camera.position.x = pointer.x * 1.1
    camera.position.y = 7.4 - pointer.y * 0.32
    camera.lookAt(pointer.x * 1.8, -0.52, -8.5)

    terrain.rotation.z = Math.sin(elapsed * 0.08) * 0.006 + pointer.x * 0.012
    updatePlusField(plusField, targetPointer, elapsed, delta, quality)

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
      terrainTextures.color.dispose()
      terrainTextures.bump?.dispose()
      terrainTextures.roughness?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

function createTerrain(
  textures: TerrainTextures,
  quality: SceneQuality,
  terrainRelief: TerrainRelief,
) {
  const terrain = new THREE.Group()
  terrain.add(
    createTerrainMesh(
      textures,
      quality,
      PRIMARY_TERRAIN_OFFSET,
      PRIMARY_TERRAIN_Y,
      PRIMARY_TERRAIN_Z,
      PRIMARY_TERRAIN_SCALE,
      terrainRelief,
    ),
  )
  return terrain
}

function createTerrainMesh(
  textures: TerrainTextures,
  quality: SceneQuality,
  offset: number,
  y: number,
  z: number,
  scale: number,
  terrainRelief: TerrainRelief,
) {
  const geometry = new THREE.PlaneGeometry(
    TERRAIN_SIZE,
    TERRAIN_SIZE,
    quality.terrainSegments,
    quality.terrainSegments,
  )
  geometry.rotateX(-Math.PI / 2)

  const positions = geometry.attributes.position

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index)
    const z = positions.getZ(index)
    positions.setY(index, sampleTerrainHeight(x, z, offset, scale, terrainRelief))
  }

  geometry.computeVertexNormals()

  const material = createTerrainMaterial(textures, quality)

  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.castShadow = false
  mesh.position.set(0, y, z)
  return mesh
}

function createTerrainMaterial(
  textures: TerrainTextures,
  quality: SceneQuality,
) {
  if (!quality.useDetailedTerrainMaterial) {
    return new THREE.MeshLambertMaterial({
      color: 0x1d2a42,
      map: textures.color,
      emissive: 0x071225,
      emissiveIntensity: 0.18,
    })
  }

  return new THREE.MeshStandardMaterial({
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
}

function sampleTerrainHeight(
  x: number,
  z: number,
  offset: number,
  scale: number,
  terrainRelief: TerrainRelief,
) {
  const distanceFromBasin = Math.sqrt((x - 4) ** 2 + (z + 24) ** 2)
  const packedNoise = fbm2((x + offset * 0.52) * 0.058, z * 0.058, 5)
  const coarseNoise = fbm2((x - offset) * 0.025 + 31.7, z * 0.025 - 12.4, 4)
  const horizonRise = THREE.MathUtils.smoothstep(-z, 4, 72) * terrainRelief.horizonRise
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
  const windErosion = Math.sin(distanceFromBasin * 0.32 + coarseNoise * 4.2) * 0.16

  return (
    (horizonRise * 0.8 +
      distantMesa * 0.78 * terrainRelief.mesaIntensity +
      diagonalEscarpment * 0.68 * terrainRelief.escarpmentIntensity +
      foregroundShelf * 0.62 * terrainRelief.foregroundShelfIntensity +
      striatedRidges * (1.4 + coarseNoise * 1.1) * terrainRelief.ridgeIntensity +
      erodedChannels * 0.76 +
      stoneMass * 0.86 * terrainRelief.stoneMassIntensity +
      windErosion -
      terrainRelief.baseDepth) *
    scale *
    terrainRelief.heightScale
  )
}

function createPlusField(
  quality: SceneQuality,
  terrainRelief: TerrainRelief,
): PlusField {
  const group = new THREE.Group()
  const markers: PlusMarker[] = []
  const geometry = createPlusGeometry()

  group.position.set(0, PRIMARY_TERRAIN_Y, 0)
  group.renderOrder = 8

  for (let localZ = -PLUS_FIELD_RADIUS; localZ <= PLUS_FIELD_RADIUS; localZ += quality.plusFieldStep) {
    for (let localX = -PLUS_FIELD_RADIUS; localX <= PLUS_FIELD_RADIUS; localX += quality.plusFieldStep) {
      const distance = Math.sqrt(localX ** 2 + localZ ** 2)

      if (distance > PLUS_FIELD_RADIUS) {
        continue
      }

      const edgeFade = 1 - THREE.MathUtils.smoothstep(
        PLUS_FIELD_RADIUS * 0.52,
        PLUS_FIELD_RADIUS,
        distance,
      )
      const jitterX = (hashNoise2(localX * 2.7, localZ * 2.7) - 0.5) * 0.42
      const jitterZ = (hashNoise2(localX * 3.1 + 17, localZ * 3.1 - 11) - 0.5) * 0.42
      const markerX = localX + jitterX
      const markerZ = localZ + jitterZ

      markers.push({
        localX: markerX,
        localZ: markerZ,
        rotation: (hashNoise2(localX + 8, localZ - 6) - 0.5) * 0.16,
        scale: 0.66 + edgeFade * 0.18,
        baseOpacity: 0.1 + edgeFade * 0.46,
        pulsePhase: markerX * 0.26 + markerZ * 0.19,
        currentHeight: 0,
        targetHeight: 0,
      })
    }
  }

  const material = createPlusMaterial()
  const mesh = new THREE.InstancedMesh(geometry, material, markers.length)
  const baseOpacity = new Float32Array(markers.length)
  const pulsePhase = new Float32Array(markers.length)
  const field = {
    group,
    mesh,
    markers,
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
    euler: new THREE.Euler(),
    lastHeightUpdate: -Infinity,
    lastSampleX: Infinity,
    lastSampleZ: Infinity,
    terrainRelief,
  }

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]
    baseOpacity[index] = marker.baseOpacity
    pulsePhase[index] = marker.pulsePhase
  }

  geometry.setAttribute('aBaseOpacity', new THREE.InstancedBufferAttribute(baseOpacity, 1))
  geometry.setAttribute('aPulsePhase', new THREE.InstancedBufferAttribute(pulsePhase, 1))
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false
  group.add(mesh)
  updatePlusTargetHeights(field, 0)
  snapPlusHeightsToTargets(field)
  updatePlusMatrices(field, 0)

  return field
}

function createPlusGeometry() {
  const shape = new THREE.Shape()
  const armLength = 0.42
  const armWidth = 0.12

  shape.moveTo(-armWidth, -armLength)
  shape.lineTo(armWidth, -armLength)
  shape.lineTo(armWidth, -armWidth)
  shape.lineTo(armLength, -armWidth)
  shape.lineTo(armLength, armWidth)
  shape.lineTo(armWidth, armWidth)
  shape.lineTo(armWidth, armLength)
  shape.lineTo(-armWidth, armLength)
  shape.lineTo(-armWidth, armWidth)
  shape.lineTo(-armLength, armWidth)
  shape.lineTo(-armLength, -armWidth)
  shape.lineTo(-armWidth, -armWidth)
  shape.closePath()

  return new THREE.ShapeGeometry(shape)
}

function createPlusMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      uniform float uTime;
      attribute float aBaseOpacity;
      attribute float aPulsePhase;
      varying float vOpacity;

      void main() {
        vOpacity = max(0.02, aBaseOpacity + sin(uTime * 1.7 + aPulsePhase) * 0.08);
        vec4 instancePosition = instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * instancePosition;
      }
    `,
    fragmentShader: `
      varying float vOpacity;

      void main() {
        gl_FragColor = vec4(1.0, 1.0, 1.0, vOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
}

function updatePlusField(
  field: PlusField,
  pointer: THREE.Vector2,
  elapsed: number,
  delta: number,
  quality: SceneQuality,
) {
  const follow = createFrameLerp(PLUS_FIELD_RESPONSE, delta)
  const targetZ = THREE.MathUtils.mapLinear(
    pointer.y,
    -1,
    1,
    PLUS_FIELD_BACK_Z,
    PLUS_FIELD_FRONT_Z,
  )
  field.group.position.x = THREE.MathUtils.lerp(
    field.group.position.x,
    pointer.x * PLUS_FIELD_POINTER_X_RANGE,
    follow,
  )
  field.group.position.z = THREE.MathUtils.lerp(field.group.position.z, targetZ, follow)
  field.mesh.material.uniforms.uTime.value = elapsed

  if (!shouldUpdatePlusHeights(field, elapsed, quality)) {
    updatePlusMatrices(field, delta)
    return
  }

  updatePlusTargetHeights(field, elapsed)
  updatePlusMatrices(field, delta)
}

function shouldUpdatePlusHeights(
  field: PlusField,
  elapsed: number,
  quality: SceneQuality,
) {
  if (elapsed - field.lastHeightUpdate < quality.plusHeightUpdateInterval) {
    return false
  }

  const movement = Math.hypot(
    field.group.position.x - field.lastSampleX,
    field.group.position.z - field.lastSampleZ,
  )

  return movement >= quality.plusHeightMoveThreshold
}

function updatePlusTargetHeights(field: PlusField, elapsed: number) {
  field.lastHeightUpdate = elapsed
  field.lastSampleX = field.group.position.x
  field.lastSampleZ = field.group.position.z

  for (const marker of field.markers) {
    const terrainX = field.group.position.x + marker.localX
    const terrainZ = field.group.position.z + marker.localZ - PRIMARY_TERRAIN_Z
    marker.targetHeight = sampleTerrainHeight(
      terrainX,
      terrainZ,
      PRIMARY_TERRAIN_OFFSET,
      PRIMARY_TERRAIN_SCALE,
      field.terrainRelief,
    )
  }
}

function snapPlusHeightsToTargets(field: PlusField) {
  for (const marker of field.markers) {
    marker.currentHeight = marker.targetHeight
  }
}

function updatePlusMatrices(field: PlusField, delta: number) {
  const heightFollow = createFrameLerp(PLUS_HEIGHT_RESPONSE, delta)

  for (let index = 0; index < field.markers.length; index += 1) {
    const marker = field.markers[index]
    marker.currentHeight = THREE.MathUtils.lerp(
      marker.currentHeight,
      marker.targetHeight,
      heightFollow,
    )

    field.position.set(
      marker.localX,
      marker.currentHeight + PLUS_FIELD_TERRAIN_CLEARANCE,
      marker.localZ,
    )
    field.euler.set(-Math.PI / 2, 0, marker.rotation)
    field.quaternion.setFromEuler(field.euler)
    field.scale.setScalar(marker.scale)
    field.matrix.compose(field.position, field.quaternion, field.scale)
    field.mesh.setMatrixAt(index, field.matrix)
  }

  field.mesh.instanceMatrix.needsUpdate = true
}

function createFrameLerp(response: number, delta: number) {
  return 1 - Math.exp(-response * delta)
}

function createStoneTextures(
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

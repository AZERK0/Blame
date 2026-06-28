'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const TERRAIN_SIZE = 72
const TERRAIN_SEGMENTS = 168
const RIDGE_COUNT = 4
const ROCK_COUNT = 18

type SceneState = {
  cleanup: () => void
}

type SunMaterials = {
  core: THREE.MeshBasicMaterial
  innerGlow: THREE.MeshBasicMaterial
  outerGlow: THREE.MeshBasicMaterial
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
      className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_44%_24%,rgba(255,118,28,0.48),transparent_18%),radial-gradient(circle_at_48%_42%,rgba(2,5,12,0.3),transparent_38%),linear-gradient(180deg,#04060d_0%,#131a27_36%,#293244_58%,#080a12_100%)]"
    />
  )
}

function createHeroScene(container: HTMLDivElement): SceneState {
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x1c2635, 0.019)

  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 180)
  camera.position.set(0, 12.8, 32)
  camera.rotation.x = -0.32

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.18
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.appendChild(renderer.domElement)

  const rockTexture = createStoneTexture()
  const terrain = createTerrain(rockTexture)
  scene.add(terrain)

  const foregroundRocks = createForegroundRocks(rockTexture)
  scene.add(foregroundRocks)

  const sunset = createSunset()
  scene.add(sunset)

  const ridges = createRidgeLines()
  ridges.forEach((ridge) => scene.add(ridge))

  const particles = createAtmosphereParticles()
  scene.add(particles)

  const ambientLight = new THREE.HemisphereLight(0xbfd5f0, 0x080a10, 1.45)
  scene.add(ambientLight)

  const sunLight = new THREE.DirectionalLight(0xff8a24, 6.8)
  sunLight.position.set(-11, 17, -23)
  sunLight.castShadow = true
  sunLight.shadow.mapSize.set(1536, 1536)
  scene.add(sunLight)

  const sunFill = new THREE.PointLight(0xff5a1f, 52, 72, 1.7)
  sunFill.position.set(-11, 9.6, -34)
  scene.add(sunFill)

  const iceLight = new THREE.DirectionalLight(0x9dbfff, 1.35)
  iceLight.position.set(15, 7, 17)
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

    camera.position.x = pointer.x * 1.35
    camera.position.y = 12.8 - pointer.y * 0.55
    camera.lookAt(pointer.x * 2.3, 0.2, -8)

    terrain.rotation.z = Math.sin(elapsed * 0.08) * 0.008 + pointer.x * 0.018
    foregroundRocks.rotation.z = pointer.x * 0.01
    sunset.scale.setScalar(1 + Math.sin(elapsed * 0.72) * 0.018)
    updateSunGlow(sunset, elapsed)
    particles.rotation.y = elapsed * 0.012
    particles.position.x = pointer.x * 0.65

    ridges.forEach((ridge, index) => {
      ridge.material.opacity = 0.18 + Math.sin(elapsed * 0.8 + index) * 0.08
    })

    renderer.render(scene, camera)
    animationFrame = requestAnimationFrame(animate)
  }

  animate()

  return {
    cleanup: () => {
      cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', handlePointerMove)
      disposeObject3D(terrain)
      disposeObject3D(foregroundRocks)
      disposeObject3D(sunset)
      ridges.forEach((ridge) => {
        ridge.geometry.dispose()
        disposeMaterial(ridge.material)
      })
      particles.geometry.dispose()
      disposeMaterial(particles.material)
      rockTexture.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

function createTerrain(stoneTexture: THREE.CanvasTexture) {
  const terrain = new THREE.Group()
  terrain.add(createTerrainMesh(stoneTexture, 0, -2.35, -10, 1))
  terrain.add(createTerrainMesh(stoneTexture, 18, -1.2, -36, 0.74))
  return terrain
}

function createTerrainMesh(
  stoneTexture: THREE.CanvasTexture,
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
    const distanceFromCenter = Math.sqrt((x - 3) ** 2 + (z + 10) ** 2)
    const horizonRise = THREE.MathUtils.smoothstep(-z, -7, 35) * 7.4
    const centralPeak = Math.exp(-((x + 9 + offset * 0.16) ** 2 + (z + 18) ** 2) / 78) * 9.8
    const sidePeak = Math.exp(-((x - 22) ** 2 + (z + 23) ** 2) / 170) * 6.3
    const leftRidge = Math.exp(-((x + 28) ** 2 + (z + 6) ** 2) / 220) * 5.4
    const foregroundRidge = Math.exp(-((z - 12) ** 2) / 26) * (3.2 + Math.sin(x * 0.41) * 0.95)
    const stratifiedNoise =
      Math.sin((x + offset) * 0.38 + z * 0.22) * 0.84 +
      Math.sin(x * 1.17 - z * 0.46) * 0.28 +
      Math.cos(distanceFromCenter * 0.74) * 0.56
    const fracturedNoise =
      Math.sign(Math.sin(x * 0.73 + z * 0.51)) * 0.32 +
      Math.sign(Math.cos(x * 1.07 - z * 0.34)) * 0.18

    positions.setY(
      index,
      (horizonRise + centralPeak + sidePeak + leftRidge + foregroundRidge + stratifiedNoise + fracturedNoise - 4.6) * scale,
    )
  }

  geometry.computeVertexNormals()

  const material = new THREE.MeshStandardMaterial({
    color: 0x5f6e80,
    map: stoneTexture,
    bumpMap: stoneTexture,
    bumpScale: 0.38,
    roughness: 0.96,
    metalness: 0,
    emissive: 0x111a27,
    emissiveIntensity: 0.13,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.castShadow = true
  mesh.position.set(0, y, z)
  return mesh
}

function createForegroundRocks(stoneTexture: THREE.CanvasTexture) {
  const group = new THREE.Group()
  const geometry = new THREE.DodecahedronGeometry(1, 1)

  for (let index = 0; index < ROCK_COUNT; index += 1) {
    const side = index % 2 === 0 ? -1 : 1
    const row = Math.floor(index / 2)
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x657589).offsetHSL(0, 0, (index % 5) * 0.018 - 0.035),
      map: stoneTexture,
      bumpMap: stoneTexture,
      bumpScale: 0.28,
      roughness: 0.98,
      metalness: 0,
      emissive: 0x0c121b,
      emissiveIntensity: 0.08,
      flatShading: true,
    })
    const rock = new THREE.Mesh(geometry.clone(), material)
    const size = 0.9 + ((index * 17) % 9) * 0.12
    rock.scale.set(size * (1.35 + row * 0.04), size * (0.58 + (index % 3) * 0.08), size)
    rock.position.set(
      side * (9.5 + row * 2.15 + Math.sin(index * 1.9) * 2.1),
      -0.8 + row * 0.04,
      5.8 + row * 2.3 + Math.cos(index * 1.2) * 1.1,
    )
    rock.rotation.set(index * 0.43, index * 0.81, index * 0.27)
    rock.castShadow = true
    rock.receiveShadow = true
    group.add(rock)
  }

  group.position.set(0, -1.85, -9)
  geometry.dispose()
  return group
}

function createStoneTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to create stone texture canvas context')
  }

  const image = context.createImageData(canvas.width, canvas.height)
  const data = image.data

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const index = (y * canvas.width + x) * 4
      const grain =
        Math.sin(x * 0.17 + y * 0.09) * 20 +
        Math.sin(x * 0.63 - y * 0.27) * 12 +
        Math.cos((x + y) * 0.41) * 9 +
        ((x * 13 + y * 7) % 23)
      const vein = Math.abs(Math.sin(x * 0.035 + Math.sin(y * 0.04) * 2.2)) * 28
      const shade = THREE.MathUtils.clamp(92 + grain - vein, 42, 155)
      data[index] = shade * 0.72
      data[index + 1] = shade * 0.82
      data[index + 2] = shade
      data[index + 3] = 255
    }
  }

  context.putImageData(image, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(6, 6)
  texture.anisotropy = 4
  return texture
}

function createSunset() {
  const sun = new THREE.Group()
  sun.position.set(-10.8, 9.7, -37)

  const coreMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff2b3,
    transparent: true,
    opacity: 0.98,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const core = new THREE.Mesh(new THREE.CircleGeometry(3.45, 96), coreMaterial)

  const innerGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0xff8a24,
    transparent: true,
    opacity: 0.58,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const innerGlow = new THREE.Mesh(new THREE.CircleGeometry(7.8, 96), innerGlowMaterial)
  innerGlow.position.z = -0.04

  const outerGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0xff3d12,
    transparent: true,
    opacity: 0.2,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const outerGlow = new THREE.Mesh(new THREE.CircleGeometry(15, 128), outerGlowMaterial)
  outerGlow.position.z = -0.08

  sun.add(outerGlow, innerGlow, core)
  sun.userData = {
    materials: {
      core: coreMaterial,
      innerGlow: innerGlowMaterial,
      outerGlow: outerGlowMaterial,
    } satisfies SunMaterials,
  }
  return sun
}

function updateSunGlow(sun: THREE.Group, elapsed: number) {
  const materials = sun.userData.materials as SunMaterials | undefined

  if (!materials) {
    return
  }

  const heatPulse = Math.sin(elapsed * 2.1) * 0.5 + Math.sin(elapsed * 3.7) * 0.25
  materials.core.opacity = 0.9 + heatPulse * 0.04
  materials.innerGlow.opacity = 0.48 + heatPulse * 0.05
  materials.outerGlow.opacity = 0.18 + heatPulse * 0.025
}

function createRidgeLines() {
  return Array.from({ length: RIDGE_COUNT }, (_, ridgeIndex) => {
    const points = Array.from({ length: 90 }, (_point, pointIndex) => {
      const progress = pointIndex / 89
      const x = (progress - 0.5) * 48
      const z = -22 + ridgeIndex * 5.5 + Math.sin(progress * Math.PI * 2) * 1.5
      const y =
        1.3 +
        ridgeIndex * 0.35 +
        Math.sin(progress * Math.PI * 3 + ridgeIndex) * 0.65

      return new THREE.Vector3(x, y, z)
    })

    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({
      color: ridgeIndex === 2 ? 0xffd08a : 0xd8ecff,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    return new THREE.Line(geometry, material)
  })
}

function createAtmosphereParticles() {
  const particleCount = 520
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(particleCount * 3)

  for (let index = 0; index < particleCount; index += 1) {
    positions[index * 3] = (Math.random() - 0.5) * 80
    positions[index * 3 + 1] = Math.random() * 26 - 1
    positions[index * 3 + 2] = Math.random() * -58 + 12
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const material = new THREE.PointsMaterial({
    color: 0xf4fbff,
    transparent: true,
    opacity: 0.32,
    size: 0.055,
    depthWrite: false,
  })

  return new THREE.Points(geometry, material)
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
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points) {
      child.geometry.dispose()
      disposeMaterial(child.material)
    }
  })
}

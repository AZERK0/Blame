'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'

const TERRAIN_SIZE = 72
const TERRAIN_SEGMENTS = 168
const SUN_ELEVATION_DEGREES = 4.2
const SUN_AZIMUTH_DEGREES = -166
const SUN_DIRECTION = createSunDirection()

type SceneState = {
  cleanup: () => void
}

type SunMaterials = {
  core: THREE.MeshBasicMaterial
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
  scene.fog = new THREE.FogExp2(0x0b1220, 0.022)

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500000)
  camera.position.set(0, 7.4, 21)

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.82
  renderer.shadowMap.enabled = false
  container.appendChild(renderer.domElement)

  const sky = createAtmosphericSky()
  scene.add(sky)

  const rockTexture = createStoneTexture()
  const terrain = createTerrain(rockTexture)
  scene.add(terrain)

  const ambientLight = new THREE.HemisphereLight(0xffe4bd, 0x121a2a, 1.18)
  scene.add(ambientLight)

  const sunLight = new THREE.DirectionalLight(0xffffff, 5)
  sunLight.position.copy(SUN_DIRECTION).multiplyScalar(34)
  scene.add(sunLight)

  const sunFill = new THREE.PointLight(0xff8a32, 54, 90, 1.45)
  sunFill.position.copy(SUN_DIRECTION).multiplyScalar(38)
  scene.add(sunFill)

  const iceLight = new THREE.DirectionalLight(0x90a8ff, 0.72)
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
    camera.lookAt(pointer.x * 1.8, -0.78, -8.5)

    terrain.rotation.z = Math.sin(elapsed * 0.08) * 0.006 + pointer.x * 0.012

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
      rockTexture.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

function createTerrain(stoneTexture: THREE.CanvasTexture) {
  const terrain = new THREE.Group()
  terrain.add(createTerrainMesh(stoneTexture, 0, -2.65, -4.5, 1.05))
  terrain.add(createTerrainMesh(stoneTexture, 18, -1.7, -29, 0.76))
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
      Math.sin(x * 0.73 + z * 0.51) * 0.26 +
      Math.cos(x * 1.07 - z * 0.34) * 0.14 +
      Math.sin((x + z) * 0.18 + Math.sin(x * 0.27) * 1.8) * 0.22

    positions.setY(
      index,
      (horizonRise * 0.8 +
        centralPeak * 0.68 +
        sidePeak * 0.7 +
        leftRidge * 0.7 +
        foregroundRidge * 0.72 +
        stratifiedNoise * 0.58 +
        fracturedNoise * 0.42 -
        4.15) *
        scale,
    )
  }

  geometry.computeVertexNormals()

  const material = new THREE.MeshStandardMaterial({
    color: 0x4a5870,
    map: stoneTexture,
    bumpMap: stoneTexture,
    bumpScale: 0.026,
    roughness: 0.88,
    metalness: 0,
    emissive: 0x17243a,
    emissiveIntensity: 0.18,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.castShadow = false
  mesh.position.set(0, y, z)
  return mesh
}

function createStoneTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512

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
        Math.sin(x * 0.09 + y * 0.05) * 18 +
        Math.sin(x * 0.28 - y * 0.13) * 10 +
        Math.cos((x + y) * 0.19) * 7
      const vein = Math.abs(Math.sin(x * 0.02 + Math.sin(y * 0.023) * 2.1)) * 22
      const shade = THREE.MathUtils.clamp(92 + grain * 0.72 - vein * 0.72, 54, 138)
      data[index] = shade * 0.62
      data[index + 1] = shade * 0.73
      data[index + 2] = shade * 0.94
      data[index + 3] = 255
    }
  }

  context.putImageData(image, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(2.8, 2.8)
  texture.anisotropy = 8
  return texture
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
  uniforms.turbidity.value = 9.6
  uniforms.rayleigh.value = 2.25
  uniforms.mieCoefficient.value = 0.018
  uniforms.mieDirectionalG.value = 0.72
  uniforms.sunPosition.value.copy(SUN_DIRECTION)

  if ('showSunDisc' in uniforms) {
    uniforms.showSunDisc.value = false
  }

  sky.material.depthWrite = false
  sky.material.depthTest = false
  sky.renderOrder = -1000
  return sky
}

function updateSunGlow(sun: THREE.Group, elapsed: number) {
  const materials = sun.userData.materials as SunMaterials | undefined

  if (!materials) {
    return
  }

  const heatPulse = Math.sin(elapsed * 2.1) * 0.5 + Math.sin(elapsed * 3.7) * 0.25
  materials.core.opacity = 0.94 + heatPulse * 0.025
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

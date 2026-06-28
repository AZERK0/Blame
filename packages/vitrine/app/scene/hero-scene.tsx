'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const TERRAIN_SIZE = 72
const TERRAIN_SEGMENTS = 128
const RIDGE_COUNT = 5

type SceneState = {
  cleanup: () => void
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
      className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_50%_34%,rgba(250,174,84,0.34),transparent_24%),linear-gradient(180deg,#151a30_0%,#7c879f_42%,#111521_100%)]"
    />
  )
}

function createHeroScene(container: HTMLDivElement): SceneState {
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x8690a4, 0.017)

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 160)
  camera.position.set(0, 13.5, 31)
  camera.rotation.x = -0.35

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.appendChild(renderer.domElement)

  const terrain = createTerrain()
  scene.add(terrain)

  const sunset = createSunset()
  scene.add(sunset)

  const ridges = createRidgeLines()
  ridges.forEach((ridge) => scene.add(ridge))

  const particles = createAtmosphereParticles()
  scene.add(particles)

  const ambientLight = new THREE.HemisphereLight(0xdde8ff, 0x141722, 2.25)
  scene.add(ambientLight)

  const sunLight = new THREE.DirectionalLight(0xffbd78, 4.5)
  sunLight.position.set(-8, 18, -14)
  sunLight.castShadow = true
  sunLight.shadow.mapSize.set(1024, 1024)
  scene.add(sunLight)

  const iceLight = new THREE.DirectionalLight(0xaac8ff, 1.9)
  iceLight.position.set(12, 8, 18)
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
    camera.position.y = 13.5 - pointer.y * 0.55
    camera.lookAt(pointer.x * 2.5, 0.5, -7)

    terrain.rotation.z = Math.sin(elapsed * 0.08) * 0.008 + pointer.x * 0.018
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
      terrain.geometry.dispose()
      disposeMaterial(terrain.material)
      sunset.geometry.dispose()
      disposeMaterial(sunset.material)
      ridges.forEach((ridge) => {
        ridge.geometry.dispose()
        disposeMaterial(ridge.material)
      })
      particles.geometry.dispose()
      disposeMaterial(particles.material)
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

function createTerrain() {
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
    const distanceFromCenter = Math.sqrt(x * x + (z + 12) * (z + 12))
    const horizonRise = THREE.MathUtils.smoothstep(-z, -8, 34) * 7.8
    const centralPeak = Math.exp(-((x + 7) ** 2 + (z + 19) ** 2) / 120) * 9
    const sidePeak = Math.exp(-((x - 22) ** 2 + (z + 24) ** 2) / 210) * 6.5
    const foregroundRidge = Math.exp(-((z - 10) ** 2) / 35) * (2.6 + Math.sin(x * 0.33) * 0.7)
    const organicNoise =
      Math.sin(x * 0.28 + z * 0.18) * 0.9 +
      Math.sin(x * 0.61 - z * 0.34) * 0.42 +
      Math.cos(distanceFromCenter * 0.38) * 0.5

    positions.setY(
      index,
      horizonRise + centralPeak + sidePeak + foregroundRidge + organicNoise - 4.2,
    )
  }

  geometry.computeVertexNormals()

  const material = new THREE.MeshStandardMaterial({
    color: 0xb7c2d4,
    roughness: 0.92,
    metalness: 0.04,
    emissive: 0x283247,
    emissiveIntensity: 0.11,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.position.set(0, -2.1, -10)
  return mesh
}

function createSunset() {
  const geometry = new THREE.CircleGeometry(7.5, 64)
  const material = new THREE.MeshBasicMaterial({
    color: 0xffb15f,
    transparent: true,
    opacity: 0.58,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const sun = new THREE.Mesh(geometry, material)
  sun.position.set(-9, 9.5, -32)
  return sun
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
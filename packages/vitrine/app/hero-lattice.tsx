'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

type Lane = {
  curve: THREE.CatmullRomCurve3
  runner: THREE.Mesh
  offset: number
  speed: number
}

const laneColors = ['#2563eb', '#16a34a', '#d97706', '#64748b'] as const

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh

    if (mesh.geometry) {
      mesh.geometry.dispose()
    }

    const material = mesh.material

    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose())
    } else if (material) {
      material.dispose()
    }
  })
}

function createLanePoints(index: number) {
  const verticalOffset = (index - 2) * 0.58
  const depthOffset = Math.sin(index * 1.17) * 0.38

  return [
    new THREE.Vector3(-3.1, verticalOffset - 0.18, depthOffset - 0.22),
    new THREE.Vector3(-1.45, verticalOffset + Math.sin(index) * 0.22, depthOffset + 0.16),
    new THREE.Vector3(0.15, verticalOffset + Math.cos(index * 0.8) * 0.34, depthOffset - 0.08),
    new THREE.Vector3(1.55, verticalOffset - Math.sin(index * 0.7) * 0.22, depthOffset + 0.18),
    new THREE.Vector3(3.1, verticalOffset + 0.16, depthOffset - 0.18),
  ]
}

export function HeroLattice() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const frame = canvas?.parentElement

    if (!canvas || !frame) {
      return undefined
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas,
      powerPreference: 'high-performance',
    })

    renderer.setClearColor(0xffffff, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7))

    camera.position.set(0, 0.2, 7.4)
    camera.lookAt(0, 0, 0)

    const root = new THREE.Group()
    root.rotation.set(-0.16, -0.3, 0.05)
    scene.add(root)

    const ambient = new THREE.AmbientLight(0xffffff, 1.8)
    const keyLight = new THREE.DirectionalLight(0xdbeafe, 2.2)
    keyLight.position.set(2, 4, 6)
    scene.add(ambient, keyLight)

    const gridMaterial = new THREE.LineBasicMaterial({
      color: '#cbd5e1',
      opacity: 0.22,
      transparent: true,
    })

    for (let index = -4; index <= 4; index += 1) {
      const horizontal = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-3.4, index * 0.42, -0.9),
        new THREE.Vector3(3.4, index * 0.42, -0.9),
      ])
      const horizontalLine = new THREE.Line(horizontal, gridMaterial)
      root.add(horizontalLine)

      const vertical = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(index * 0.82, -2.1, -0.9),
        new THREE.Vector3(index * 0.82, 2.1, -0.9),
      ])
      const verticalLine = new THREE.Line(vertical, gridMaterial)
      root.add(verticalLine)
    }

    const lanes: Lane[] = []
    const runnerGeometry = new THREE.SphereGeometry(0.08, 24, 24)
    const checkpointGeometry = new THREE.TorusGeometry(0.17, 0.012, 10, 52)

    for (let index = 0; index < 5; index += 1) {
      const color = laneColors[index % laneColors.length]
      const curve = new THREE.CatmullRomCurve3(createLanePoints(index))
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(90))
      const material = new THREE.LineBasicMaterial({
        color,
        opacity: index === 2 ? 0.68 : 0.5,
        transparent: true,
      })
      const line = new THREE.Line(geometry, material)
      root.add(line)

      const checkpointMaterial = new THREE.MeshBasicMaterial({
        color,
        opacity: 0.38,
        transparent: true,
      })

      ;[0.28, 0.68].forEach((position) => {
        const checkpoint = new THREE.Mesh(checkpointGeometry, checkpointMaterial)
        checkpoint.position.copy(curve.getPoint(position))
        checkpoint.rotation.set(Math.PI / 2, 0.18, 0)
        root.add(checkpoint)
      })

      const runnerMaterial = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.45,
        metalness: 0.08,
        roughness: 0.32,
      })
      const runner = new THREE.Mesh(runnerGeometry, runnerMaterial)
      root.add(runner)

      lanes.push({
        curve,
        runner,
        offset: index * 0.17,
        speed: 0.035 + index * 0.006,
      })
    }

    const haloGeometry = new THREE.IcosahedronGeometry(1.45, 2)
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: '#bfdbfe',
      opacity: 0.12,
      transparent: true,
      wireframe: true,
    })
    const halo = new THREE.Mesh(haloGeometry, haloMaterial)
    halo.position.set(0.9, 0.1, -0.35)
    root.add(halo)

    let animationFrameId: number | null = null
    let isVisible = true
    const clock = new THREE.Clock()

    const resize = () => {
      const { width, height } = frame.getBoundingClientRect()
      const safeHeight = Math.max(height, 320)

      renderer.setSize(Math.max(width, 1), safeHeight, false)
      camera.aspect = Math.max(width, 1) / safeHeight
      camera.updateProjectionMatrix()
    }

    const render = () => {
      const elapsed = clock.getElapsedTime()

      root.rotation.y = -0.3 + Math.sin(elapsed * 0.28) * 0.08
      root.rotation.x = -0.16 + Math.cos(elapsed * 0.22) * 0.04
      halo.rotation.x = elapsed * 0.08
      halo.rotation.y = elapsed * 0.11

      lanes.forEach((lane) => {
        const progress = (elapsed * lane.speed + lane.offset) % 1
        lane.runner.position.copy(lane.curve.getPoint(progress))
        lane.runner.scale.setScalar(1 + Math.sin(elapsed * 3 + lane.offset) * 0.14)
      })

      renderer.render(scene, camera)
    }

    const animate = () => {
      render()

      if (!prefersReducedMotion && isVisible) {
        animationFrameId = window.requestAnimationFrame(animate)
      } else {
        animationFrameId = null
      }
    }

    const observer = new IntersectionObserver(([entry]) => {
      isVisible = entry?.isIntersecting ?? true

      if (isVisible && !prefersReducedMotion && animationFrameId === null) {
        animationFrameId = window.requestAnimationFrame(animate)
      }
    })

    const resizeObserver = new ResizeObserver(() => {
      resize()
      render()
    })

    resizeObserver.observe(frame)
    observer.observe(frame)
    resize()
    animate()

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }

      observer.disconnect()
      resizeObserver.disconnect()
      disposeScene(scene)
      renderer.dispose()
    }
  }, [])

  return (
    <div className="hero-lattice" aria-hidden="true">
      <canvas ref={canvasRef} />
      <div className="lattice-chip lattice-chip-primary">worktree isolated</div>
      <div className="lattice-chip lattice-chip-secondary">diff ready</div>
    </div>
  )
}
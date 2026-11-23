import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Box3, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { buildLand, buildRange } from '@/components/three/evoLand'
import { DEPTH, cameraAt, type Shot } from '@/components/three/evoScript'

/**
 * The long walk's sky is drawn after everything solid, on the far plane, with
 * the depth test on and no depth of its own (`makeSkyMaterial`): it fills the
 * samples nothing solid was drawn into, which is exactly what drawing it first
 * and covering it used to show. That holds while two things do, and these
 * are those.
 */

const THREE_DIR = 'src/components/three'

function corners(box: Box3): Vector3[] {
  const out: Vector3[] = []
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new Vector3(x, y, z))
  return out
}

describe('the sky, drawn last', () => {
  it('has the far plane to itself: nothing in the walk is anywhere near it', () => {
    // The land is the floor of every set and the ranges ring it: nothing is further out than they are.
    const boxes = [buildLand(), buildRange()].map((geometry) => {
      geometry.computeBoundingBox()
      return geometry.boundingBox!
    })
    // How far off a fragment can be and still keep a 24-bit depth apart from the far plane's.
    const { near, far } = DEPTH
    const apart = far / (1 + (far - near) / (near * 2 ** 25))
    const shot: Shot = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: 45 }
    let farthest = 0
    for (let i = 0; i <= 400; i++) {
      for (const aspect of [0.46, 1.6, 2.4]) {
        cameraAt(i / 400, shot, aspect)
        const eye = new Vector3(shot.x, shot.y, shot.z)
        for (const box of boxes) for (const corner of corners(box)) farthest = Math.max(farthest, corner.distanceTo(eye))
      }
    }
    expect(apart).toBeGreaterThan(far * 0.999)
    expect(farthest).toBeLessThan(apart * 0.9)
  })

  it('is the only solid thing in the walk that writes no depth', () => {
    // Anything else that wrote no depth and was not see-through would be drawn over by the sky.
    for (const file of readdirSync(THREE_DIR).filter((name) => /^evo\w*\.tsx?$/.test(name) || name === 'EvolutionScene.tsx')) {
      const lines = readFileSync(join(THREE_DIR, file), 'utf8').split('\n')
      expect(lines.some((line) => /colorWrite/.test(line)), `${file} has a material that writes no colour`).toBe(false)
      lines.forEach((line, i) => {
        if (!/depthWrite(:|\s*=)\s*false/.test(line)) return
        // The post's full-screen passes draw into frames of their own, not the scene.
        if (file === 'evoPost.ts') return
        if (file === 'evoAir.ts' && lines.slice(Math.max(0, i - 14), i).some((before) => before.includes('function makeSkyMaterial'))) return
        const around = lines.slice(Math.max(0, i - 6), i + 7).join('\n')
        expect(/transparent(:\s*true|\s*=\s*true)/.test(around), `${file}:${i + 1} writes no depth and is not see-through`).toBe(true)
      })
    }
  })

  it('comes after everything solid', () => {
    const walk = readFileSync(join(THREE_DIR, 'evoWalk.ts'), 'utf8')
    expect(walk).toMatch(/dome\.renderOrder = 1000/)
    // The highest place anything else is given in the walk.
    let highest = -Infinity
    for (const file of readdirSync(THREE_DIR).filter((name) => /^evo\w*\.ts$/.test(name))) {
      for (const match of readFileSync(join(THREE_DIR, file), 'utf8').matchAll(/(\w+)\.renderOrder = (-?\d+)/g)) {
        if (match[1] !== 'dome') highest = Math.max(highest, Number(match[2]))
      }
    }
    expect(highest).toBeLessThan(1000)
  })
})

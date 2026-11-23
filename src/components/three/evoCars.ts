import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  ShaderMaterial,
} from 'three'
import { inAir, ownShadow, type Air } from './evoAir'
import { hash2 } from './evoLand'
import { LANES, STREET_LENGTH, STREET_START } from './evoStreet'
import type { Beat, Part } from './evoWalk'

/**
 * The traffic on the street the walk ends on.
 *
 * It keeps its own time: the city does not wait for the scroll. Where the
 * lanes are, and where the walk crosses them, is `evoStreet.ts`.
 */

export interface CarsOptions {
  shadows: boolean
  /** How many of them. */
  cars: number
}

export function createCars(air: Air, options: CarsOptions): Part {
  const root = new Group()
  const disposers: (() => void)[] = []
  const shared = { uLamps: { value: 0 } }
  const length = STREET_LENGTH
  const dummy = new Object3D()

  const CARS = options.cars
  const { body: bodyGeometry, dark: cabinGeometry } = carGeometry()
  const paint = inAir(new MeshStandardMaterial({ color: '#ffffff', roughness: 0.38, metalness: 0.25 }), air, 'car')
  const glass = inAir(new MeshStandardMaterial({ color: '#0b0d11', roughness: 0.12, metalness: 0.4 }), air, 'carglass')
  const bodies = new InstancedMesh(bodyGeometry, paint, Math.max(1, CARS))
  const cabins = new InstancedMesh(cabinGeometry, glass, Math.max(1, CARS))
  const lightGeometry = new BoxGeometry(0.08, 0.16, 0.34)
  const headlightMaterial = new MeshBasicMaterial({ color: '#fff4d6' })
  const taillightMaterial = new MeshBasicMaterial({ color: '#ff1d0a' })
  const headlights = new InstancedMesh(lightGeometry, headlightMaterial, Math.max(1, CARS * 2))
  const taillights = new InstancedMesh(lightGeometry, taillightMaterial, Math.max(1, CARS * 2))
  // What the headlights throw on the road ahead: a soft cone, added to it.
  const beamGeometry = new BufferGeometry()
  beamGeometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, -1.1, 15, 0, -3.4, 15, 0, 3.4, 0, 0, 1.1]), 3))
  beamGeometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2))
  beamGeometry.setIndex([0, 2, 1, 0, 3, 2])
  const beamMaterial = new ShaderMaterial({
    uniforms: { uLamps: shared.uLamps },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uLamps;
      varying vec2 vUv;
      void main() {
        float along = vUv.x;
        float across = abs(vUv.y - 0.5) * 2.0;
        float beam = (1.0 - smoothstep(0.0, 1.0, along)) * (1.0 - smoothstep(0.2, 1.0, across)) * smoothstep(0.0, 0.06, along);
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.78) * beam * 0.55 * uLamps, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  })
  const beams = new InstancedMesh(beamGeometry, beamMaterial, Math.max(1, CARS))
  for (const mesh of [bodies, cabins, headlights, taillights, beams]) {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.count = CARS
    root.add(mesh)
  }
  headlights.count = CARS * 2
  taillights.count = CARS * 2
  bodies.castShadow = options.shadows
  if (options.shadows) disposers.push(ownShadow(bodies))
  beams.renderOrder = 4
  const PAINTS = ['#b9bcc2', '#1a1c20', '#e9e7e2', '#7a1c18', '#1f3a5c', '#4a4d52', '#c7a23a', '#2e4a3a']
  const tint = new Color()
  const fleet = Array.from({ length: CARS }, (_, i) => {
    const { z, going } = LANES[i % LANES.length]!
    bodies.setColorAt(i, tint.set(PAINTS[Math.floor(hash2(i, 61) * PAINTS.length)] ?? '#888888'))
    return { z, going, speed: 9 + hash2(i, 67) * 6, start: hash2(i, 71) * length }
  })
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true
  disposers.push(
    () => bodyGeometry.dispose(),
    () => cabinGeometry.dispose(),
    () => paint.dispose(),
    () => glass.dispose(),
    () => lightGeometry.dispose(),
    () => headlightMaterial.dispose(),
    () => taillightMaterial.dispose(),
    () => beamGeometry.dispose(),
    () => beamMaterial.dispose(),
  )

  const m = new Matrix4()

  function update(beat: Beat): void {
    const seen = beat.stage.city > 0.001
    root.visible = seen
    if (!seen) return
    shared.uLamps.value = beat.lamps
    // They come with the street, which is laid as the first fronts go up.
    const traffic = beat.stage.city > 0.7
    for (const mesh of [bodies, cabins, headlights, taillights, beams]) mesh.visible = traffic
    beams.visible = traffic && beat.lamps > 0.05
    if (!traffic) return
    const from = STREET_START
    fleet.forEach((car, i) => {
      const run = (((car.start + beat.t * car.speed) % length) + length) % length
      const x = car.going > 0 ? from + run : from + length - run
      dummy.position.set(x, 0.07, car.z)
      dummy.rotation.set(0, car.going > 0 ? 0 : Math.PI, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      bodies.setMatrixAt(i, dummy.matrix)
      cabins.setMatrixAt(i, dummy.matrix)
      beams.setMatrixAt(i, m.copy(dummy.matrix).multiply(BEAM_AT))
      for (const side of [0, 1]) {
        headlights.setMatrixAt(i * 2 + side, m.copy(dummy.matrix).multiply(LIGHT_AT[side]!))
        taillights.setMatrixAt(i * 2 + side, m.copy(dummy.matrix).multiply(LIGHT_AT[2 + side]!))
      }
    })
    for (const mesh of [bodies, cabins, headlights, taillights, beams]) mesh.instanceMatrix.needsUpdate = true
    headlightMaterial.color.setRGB(1, 0.95, 0.82).multiplyScalar(0.8 + 5 * beat.lamps)
    taillightMaterial.color.setRGB(1, 0.1, 0.04).multiplyScalar(0.7 + 3 * beat.lamps)
  }

  return {
    object: root,
    update,
    dispose: () => {
      for (const dispose of disposers) dispose()
    },
  }
}

/** Where a car's lights are on it: two at the front, two at the back. */
const LIGHT_AT = [
  new Matrix4().makeTranslation(2.16, 0.68, 0.62),
  new Matrix4().makeTranslation(2.16, 0.68, -0.62),
  new Matrix4().makeTranslation(-2.16, 0.74, 0.64),
  new Matrix4().makeTranslation(-2.16, 0.74, -0.64),
]
const BEAM_AT = new Matrix4().makeTranslation(2.3, 0.03, 0)

/**
 * A car: its side view pushed out sideways into a body, and the dark things on
 * it — glass, and four wheels — as a second mesh in the same place.
 */
function carGeometry(): { body: BufferGeometry; dark: BufferGeometry } {
  // Clockwise from the back bumper: boot, rear glass, roof, windscreen, bonnet, nose.
  const outline: [number, number][] = [
    [-2.15, 0.3],
    [-2.17, 0.8],
    [-1.75, 0.9],
    [-1.3, 0.95],
    [-0.72, 1.36],
    [0.38, 1.39],
    [1.08, 0.98],
    [2.0, 0.85],
    [2.17, 0.62],
    [2.15, 0.3],
  ]
  const half = 0.9
  const flat = (triangles: number[]): BufferGeometry => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(triangles), 3))
    geometry.computeVertexNormals()
    return geometry
  }
  const body: number[] = []
  const hub: [number, number] = [0, 0.75]
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length]!
    // The two sides, as a fan round the middle, and the skin between them.
    body.push(hub[0], hub[1], half, b[0], b[1], half, a[0], a[1], half)
    body.push(hub[0], hub[1], -half, a[0], a[1], -half, b[0], b[1], -half)
    body.push(a[0], a[1], half, b[0], b[1], half, b[0], b[1], -half)
    body.push(a[0], a[1], half, b[0], b[1], -half, a[0], a[1], -half)
  })
  const dark: number[] = []
  const quad = (p: [number, number, number][]) => {
    const [a, b, c, d] = p as [[number, number, number], [number, number, number], [number, number, number], [number, number, number]]
    dark.push(...a, ...b, ...c, ...a, ...c, ...d)
  }
  // Side glass, a hair outside the body, and the two screens on their slopes.
  for (const side of [1, -1]) {
    const z = side * (half + 0.012)
    const pane: [number, number, number][] = [
      [-1.18, 0.98, z],
      [0.98, 0.99, z],
      [0.36, 1.32, z],
      [-0.7, 1.3, z],
    ]
    quad(side > 0 ? pane : [...pane].reverse())
  }
  quad([
    [1.1, 1.0, 0.8],
    [1.1, 1.0, -0.8],
    [0.42, 1.38, -0.74],
    [0.42, 1.38, 0.74],
  ])
  quad([
    [-0.76, 1.35, 0.74],
    [-0.76, 1.35, -0.74],
    [-1.3, 0.98, -0.8],
    [-1.3, 0.98, 0.8],
  ])
  const glass = flat(dark)
  // Wheels: four short drums.
  const wheels: BufferGeometry[] = []
  for (const x of [-1.36, 1.38]) {
    for (const z of [-0.8, 0.8]) {
      const wheel = new CylinderGeometry(0.33, 0.33, 0.24, 12)
      wheel.rotateX(Math.PI / 2)
      wheel.translate(x, 0.33, z)
      wheels.push(wheel.toNonIndexed())
      wheel.dispose()
    }
  }
  const all: number[] = [...(glass.getAttribute('position').array as Float32Array)]
  for (const wheel of wheels) {
    all.push(...(wheel.getAttribute('position').array as Float32Array))
    wheel.dispose()
  }
  glass.dispose()
  return { body: flat(body), dark: flat(all) }
}

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Points,
  ShaderMaterial,
} from 'three'
import type { CreatureDetail } from './creatures'
import { EVO_NOISE, type Air, type Arrivals } from './evoAir'
import { PLACE, groundAt, hash2 } from './evoLand'
import { makeRockMaterial } from './evoMaterials'
import type { Beat, Part } from './evoWalk'
import { requestCreature } from './useCreature'

/**
 * The cave the walk begins in: the crag it is cut into, and the hearth.
 *
 * The rock is meshed in the worker like a creature (`evoFigures.ts`), and
 * arrives a moment after the scene does; until then there is the dark, which
 * is what the scene opens on anyway. The fire is the only light in here: a
 * point light that flickers, flames drawn on crossed cards, embers going up,
 * and stones and logs to burn on.
 */

const HEARTH = PLACE.cave.hearth

const FLAME_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uFire;
  uniform float uSeed;
  varying vec2 vUv;
  ${EVO_NOISE}
  void main() {
    // A teardrop that leans and wavers, with turbulence rising through it and
    // its top torn into tongues. It never reaches the edge of its card: a
    // flame with a straight side is a picture of a flame.
    float y = vUv.y;
    float x = (vUv.x - 0.5) * 2.0;
    x -= (evoNoise(vec2(uSeed * 2.3, uTime * 1.4)) - 0.5) * 0.5 * y * y;
    float n = evoFbm(vec2(x * 1.6 + uSeed * 3.1, y * 2.5 - uTime * 2.2));
    float lick = evoNoise(vec2(x * 4.6 - uSeed, y * 5.5 - uTime * 4.4));
    float profile = sqrt(max(y, 0.0)) * (1.0 - y) * 2.05 * (0.55 + 0.5 * uFire);
    float f = clamp(1.0 - abs(x) / max(profile * (0.7 + 0.6 * n), 1e-3), 0.0, 1.0);
    f *= smoothstep(0.0, 0.3, n + 0.42 - y * 0.62 + f * 0.25);
    f = pow(f, 0.8) * (0.62 + 0.38 * lick);
    f *= smoothstep(1.0, 0.8, abs(x)) * smoothstep(1.0, 0.86, y);
    vec3 color = mix(vec3(0.95, 0.16, 0.02), vec3(1.0, 0.55, 0.1), smoothstep(0.1, 0.5, f));
    color = mix(color, vec3(1.0, 0.9, 0.62), smoothstep(0.55, 0.95, f) * (1.0 - y * 0.5));
    gl_FragColor = vec4(color * f * 2.1 * uFire, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const CARD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/** Sparks: born in the fire, carried up and sideways, gone in a second or two. */
const EMBER_VERT = /* glsl */ `
  attribute vec4 seed;
  uniform float uTime;
  uniform float uFire;
  uniform float uScale;
  varying float vLife;
  void main() {
    float life = fract(uTime * (0.28 + seed.x * 0.3) + seed.y);
    vLife = life;
    vec3 p = position;
    p.y += life * (1.6 + seed.z * 2.6);
    p.x += sin(life * 6.0 + seed.w * 40.0) * 0.16 * life + (seed.z - 0.5) * 0.9 * life;
    p.z += cos(life * 5.0 + seed.x * 40.0) * 0.16 * life + (seed.w - 0.5) * 0.9 * life;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uScale * (0.012 + 0.02 * seed.x) * (1.0 - life * 0.6) * uFire / max(-mv.z, 0.1);
  }
`

const EMBER_FRAG = /* glsl */ `
  uniform float uFire;
  varying float vLife;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = 1.0 - smoothstep(0.1, 0.5, length(c));
    vec3 color = mix(vec3(1.0, 0.75, 0.3), vec3(1.0, 0.22, 0.03), vLife);
    gl_FragColor = vec4(color * d * (1.0 - vLife) * 3.0 * uFire, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function createCave(air: Air & Arrivals, detail: CreatureDetail, bump: number, shadows: boolean): Part {
  const root = new Group()
  const disposers: (() => void)[] = []
  let gone = false

  // ---- the crag ------------------------------------------------------------
  const rock = makeRockMaterial(air, bump)
  disposers.push(() => rock.dispose())
  // As long as the worker needs: the walk is built before it is looked at, and
  // a hill meshed on the main thread is the page stopped for a second.
  void requestCreature('crag', detail, 30000).then((creature) => {
    if (gone) return
    const mesh = new Mesh(creature.geometry, rock)
    const size = creature.size ?? 1
    // The mesh is centred and a unit long; the anatomy's own origin is the
    // root bone, and that is the mouth of the cave.
    const origin = creature.bones[0]!.head
    mesh.scale.setScalar(size)
    mesh.position.set(-origin[0] * size, -origin[1] * size, -origin[2] * size)
    mesh.castShadow = shadows
    mesh.receiveShadow = shadows
    mesh.updateMatrix()
    mesh.matrixAutoUpdate = false
    root.add(mesh)
    air.arrived?.(mesh)
  })

  // ---- the hearth ----------------------------------------------------------
  const hearth = new Group()
  const floor = groundAt(HEARTH.x, HEARTH.z)
  hearth.position.set(HEARTH.x, floor, HEARTH.z)
  root.add(hearth)

  const stoneGeometry = new IcosahedronGeometry(1, 1)
  const stoneMaterial = new MeshStandardMaterial({ color: '#4a443d', roughness: 0.95, flatShading: true })
  const logGeometry = new CylinderGeometry(0.055, 0.07, 1, 7)
  const logMaterial = new MeshStandardMaterial({ color: '#1c1410', roughness: 1, emissive: new Color('#ff4a0c'), emissiveIntensity: 0 })
  disposers.push(
    () => stoneGeometry.dispose(),
    () => stoneMaterial.dispose(),
    () => logGeometry.dispose(),
    () => logMaterial.dispose(),
  )
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + hash2(i, 3) * 0.3
    const stone = new Mesh(stoneGeometry, stoneMaterial)
    const r = 0.14 + hash2(i, 5) * 0.08
    stone.scale.set(r * (1 + hash2(i, 7) * 0.5), r * 0.75, r)
    stone.position.set(Math.cos(a) * 0.62, r * 0.4, Math.sin(a) * 0.62)
    stone.rotation.set(hash2(i, 11) * 3, hash2(i, 13) * 3, 0)
    stone.castShadow = shadows
    stone.receiveShadow = shadows
    hearth.add(stone)
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4
    const log = new Mesh(logGeometry, logMaterial)
    log.scale.y = 0.62 + hash2(i, 17) * 0.3
    // Leaning in on one another over the middle.
    log.position.set(Math.cos(a) * 0.2, 0.2, Math.sin(a) * 0.2)
    log.rotation.set(Math.sin(a) * -1.02, 0, Math.cos(a) * 1.02)
    hearth.add(log)
  }

  // Flames on crossed cards: each is flat, three of them at angles are not.
  const fire = { uTime: { value: 0 }, uFire: { value: 0 } }
  const cardGeometry = new PlaneGeometry(1.5, 1.9)
  cardGeometry.translate(0, 0.95, 0)
  disposers.push(() => cardGeometry.dispose())
  const flames: ShaderMaterial[] = []
  for (let i = 0; i < 3; i++) {
    const material = new ShaderMaterial({
      uniforms: { ...fire, uSeed: { value: i * 3.7 } },
      vertexShader: CARD_VERT,
      fragmentShader: FLAME_FRAG,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      side: DoubleSide,
    })
    flames.push(material)
    disposers.push(() => material.dispose())
    const card = new Mesh(cardGeometry, material)
    card.rotation.y = (i / 3) * Math.PI
    card.position.y = 0.08
    card.renderOrder = 5
    hearth.add(card)
  }

  const EMBERS = 70
  const emberGeometry = new BufferGeometry()
  const places = new Float32Array(EMBERS * 3)
  const seeds = new Float32Array(EMBERS * 4)
  for (let i = 0; i < EMBERS; i++) {
    places[i * 3] = (hash2(i, 21) - 0.5) * 0.5
    places[i * 3 + 1] = 0.25 + hash2(i, 23) * 0.4
    places[i * 3 + 2] = (hash2(i, 27) - 0.5) * 0.5
    for (let k = 0; k < 4; k++) seeds[i * 4 + k] = hash2(i, 31 + k * 7)
  }
  emberGeometry.setAttribute('position', new BufferAttribute(places, 3))
  emberGeometry.setAttribute('seed', new BufferAttribute(seeds, 4))
  const emberMaterial = new ShaderMaterial({
    uniforms: { ...fire, uScale: { value: 900 } },
    vertexShader: EMBER_VERT,
    fragmentShader: EMBER_FRAG,
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  })
  const embers = new Points(emberGeometry, emberMaterial)
  embers.frustumCulled = false
  embers.renderOrder = 6
  hearth.add(embers)
  disposers.push(
    () => emberGeometry.dispose(),
    () => emberMaterial.dispose(),
  )

  const light = new PointLight('#ff8436', 0, 30, 1.7)
  light.position.set(0, 0.75, 0)
  if (shadows) {
    light.castShadow = true
    light.shadow.mapSize.set(512, 512)
    light.shadow.camera.near = 0.15
    light.shadow.camera.far = 24
    light.shadow.bias = -0.012
    light.shadow.normalBias = 0.06
  }
  hearth.add(light)
  disposers.push(() => {
    light.shadow.map?.dispose()
    light.dispose()
  })

  function update(beat: Beat): void {
    const seen = beat.stage.cave > 0
    root.visible = seen
    if (!seen) return
    const t = beat.t
    const lit = beat.stage.fire
    fire.uTime.value = t
    fire.uFire.value = lit
    emberMaterial.uniforms.uScale!.value = beat.camera.projectionMatrix.elements[5]! * 450
    // Never steady: two slow swells and a quick shiver on top of them.
    const flicker = 0.82 + 0.1 * Math.sin(t * 7.3) + 0.07 * Math.sin(t * 12.7 + 1.3) + 0.05 * Math.sin(t * 23.1 + 0.4)
    // A bed of embers before it catches, and a fire after.
    light.intensity = (4.5 + 44 * lit) * flicker * beat.stage.cave
    light.position.set(Math.sin(t * 5.1) * 0.05, 0.7 + 0.06 * Math.sin(t * 8.3), Math.cos(t * 4.3) * 0.05)
    logMaterial.emissiveIntensity = (0.55 + 0.9 * lit) * (0.8 + 0.2 * Math.sin(t * 3.1))
  }

  return {
    object: root,
    update,
    dispose: () => {
      gone = true
      for (const dispose of disposers) dispose()
    },
  }
}

import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  Object3D,
  SphereGeometry,
  Vector3,
  type Light,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three'
import type { ValleyQuality } from '@/lib/valley'
import type { CreatureDetail } from './creatures'
import { createCars } from './evoCars'
import { createCast } from './evoCast'
import { createCave } from './evoCave'
import { createCity } from './evoCity'
import { createPassers, createPond, createVillage } from './evoDressing'
import { createGrass } from './evoGrass'
import { createStudio } from './evoStudio'
import { createTashkent } from './evoTashkent'
import { createTrees } from './evoTrees'
import { createAir, makeRangeMaterial, makeSkyMaterial, type Air, type Arrivals } from './evoAir'
import { buildLand, buildRange, groundAt } from './evoLand'
import { createLandUniforms, makeLandMaterial, type LandUniforms } from './evoMaterials'
import { MOODS, cameraAt, lampsAt, lensFor, moodAt, skyAt, stageAt, sunShare, type Shot, type Sky, type Stage } from './evoScript'

/**
 * The long walk, as a thing that can be asked for a frame.
 *
 * Built by hand rather than as a tree of components: nearly everything in it
 * is driven from one number every frame, none of it is React state, and a
 * scene this size written as JSX is mostly refs. `createWalk` makes the world,
 * `frame` moves it to a point of the scroll, `dispose` takes it down.
 */

const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback)

export interface WalkQuality {
  dpr: number | [number, number]
  /** 0 for no shadows. */
  shadowMap: number
  bump: number
  glow: boolean
  /** How finely the people and the animals are meshed. */
  people: CreatureDetail
  beasts: CreatureDetail
  /** How much of the fur and hair grown at that detail is drawn. */
  coat: number
  /** Cars on the street. */
  cars: number
  /** How many of its leaf cards each street tree gets, 0 to 1. */
  leaves: number
}

export const WALK_QUALITY: Record<ValleyQuality, WalkQuality> = {
  low: { dpr: 1, shadowMap: 0, bump: 0, glow: false, people: 'low', beasts: 'low', coat: 0.55, cars: 10, leaves: 0.4 },
  medium: { dpr: 1, shadowMap: 1024, bump: 0.025, glow: false, people: 'low', beasts: 'low', coat: 1, cars: 20, leaves: 0.65 },
  high: { dpr: [1, 1.4], shadowMap: 2048, bump: 0.035, glow: true, people: 'medium', beasts: 'medium', coat: 1, cars: 32, leaves: 1 },
  ultra: { dpr: [1, 1.6], shadowMap: 4096, bump: 0.035, glow: true, people: 'high', beasts: 'high', coat: 1, cars: 44, leaves: 1 },
}

/** Everything the scene tells its parts, once a frame. */
export interface Beat {
  /** How far through the walk, eased towards where the page is. */
  p: number
  /** Seconds the scene has been running, for whatever keeps its own time. */
  t: number
  dt: number
  shot: Shot
  sky: Sky
  stage: Stage
  /** How lit the city is, 0 to 1. */
  lamps: number
  /** The light on things now: the sun's or the moon's colour times its strength. */
  light: Color
  /** The sky's own light on things, colour times strength. */
  ambient: Color
  /** The height of what is being drawn into, in pixels. */
  height: number
  camera: PerspectiveCamera
  air: Air
}

/** One piece of the world: something in the scene that follows the beat. */
export interface Part {
  object?: Object3D
  update(beat: Beat): void
  dispose(): void
}

export interface Walk {
  root: Group
  /** Moves the world to `progress` (0 to 1) and the camera with it. */
  frame(gl: WebGLRenderer, camera: PerspectiveCamera, progress: number, delta: number): void
  /** The beat of the last frame, for the canvas to report. */
  beat: Beat
  /** Where the canvas says what to do with a mesh that has just arrived. */
  arrivals: Arrivals
  /**
   * Runs something once for each way the walk is ever lit: by the fire in the
   * cave, by the sky alone, by the lamp in the studio. A program is built for
   * a number of lights, so one built while the fire is the only lamp lit has
   * to be built again on the frame the fire is left behind — a stall of a
   * tenth of a second or three in the middle of somebody's scroll. Compiling
   * inside this builds all of them beforehand.
   */
  rehearse(run: () => void): void
  /**
   * The same idea, for the graphics card rather than the compiler. A program
   * that has been built is still made ready a second time, by the driver, on
   * the first frame something is drawn with it — and each set of the walk is
   * first drawn in the middle of a scroll, as it comes into shot. This is a
   * list of small jobs, each of which draws one set once, in one lighting,
   * whether or not it is in shot; done one at a time while nobody is looking,
   * they leave nothing to be made ready later.
   */
  warmups(draw: () => void): (() => void)[]
  add(part: Part): void
  /** The page's own colours, for the screen the walk ends in. */
  setPaper(paper: string, ink: string, accent: string): void
  dispose(): void
}

interface Lit {
  zenith: Color
  horizon: Color
  glow: Color
  light: Color
  ambient: Color
  ground: Color
  haze: Color
}

const LIT: readonly Lit[] = MOODS.map((mood) => ({
  zenith: new Color(mood.zenith),
  horizon: new Color(mood.horizon),
  glow: new Color(mood.glow),
  light: new Color(mood.light),
  ambient: new Color(mood.ambient),
  ground: new Color(mood.ground),
  haze: new Color(mood.haze),
}))

const SCRATCH = new Color()
const blend = (out: Color, a: Color, b: Color, m: number) => out.copy(a).lerp(SCRATCH.copy(b), m)
const mixNumber = (a: number, b: number, m: number) => a + (b - a) * m
const ramp = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** How far ahead of the camera the shadow box is centred, and how wide it is. */
const SHADOW = { ahead: 24, half: 40, depth: 260 }

export function createWalk(quality: ValleyQuality): Walk {
  const q = WALK_QUALITY[quality]
  const root = new Group()
  const air = createAir()
  const land: LandUniforms = createLandUniforms()
  land.uBump.value = q.bump
  // Where no grass is drawn the ground is the meadow's colour all the way to the lens.
  land.uBlades.value = quality === 'low' ? 0 : 1
  const parts: Part[] = []

  // ---- sky -----------------------------------------------------------------
  const dome = new Mesh(new SphereGeometry(1, 48, 24), makeSkyMaterial(air))
  dome.frustumCulled = false
  dome.renderOrder = -1000
  root.add(dome)

  // ---- land ----------------------------------------------------------------
  const ground = new Mesh(buildLand(), makeLandMaterial(air, land))
  ground.receiveShadow = q.shadowMap > 0
  ground.matrixAutoUpdate = false
  root.add(ground)

  const rangeMaterial = makeRangeMaterial(air)
  const range = new Mesh(buildRange(), rangeMaterial)
  range.frustumCulled = false
  range.matrixAutoUpdate = false
  root.add(range)

  // ---- light ---------------------------------------------------------------
  const sun = new DirectionalLight('#ffffff', 1)
  const target = new Object3D()
  sun.target = target
  if (q.shadowMap > 0) {
    sun.castShadow = true
    sun.shadow.mapSize.set(q.shadowMap, q.shadowMap)
    const box = sun.shadow.camera
    box.left = -SHADOW.half
    box.right = SHADOW.half
    box.top = SHADOW.half
    box.bottom = -SHADOW.half
    box.near = 1
    box.far = SHADOW.depth
    box.updateProjectionMatrix()
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.05
  }
  const skyLight = new HemisphereLight('#ffffff', '#000000', 1)
  root.add(sun, target, skyLight)

  const beat: Beat = {
    p: 0,
    t: 0,
    dt: 0,
    shot: { x: 0, y: 2, z: 0, tx: 1, ty: 2, tz: 0, fov: 45 },
    sky: { sx: 1, sy: 0, sz: 0, mx: -1, my: 0.3, mz: 0, elevation: 0, days: 0 },
    stage: { cave: 1, fire: 0, steppe: 1, field: 0, city: 0, lapse: 0, veil: 1 },
    lamps: 0,
    light: new Color(),
    ambient: new Color(),
    height: 900,
    camera: null as unknown as PerspectiveCamera,
    air,
  }

  const grass = createGrass(air, quality, { a: land.uMeadowA, b: land.uMeadowB })
  const studio = createStudio(air, q.people, q.bump, q.coat)
  const shadows = q.shadowMap > 0
  for (const part of [
    createCave(air, q.people, q.bump, shadows),
    grass,
    createCast(air, { people: q.people, beasts: q.beasts, coat: q.coat }, q.bump, shadows, grass.tread),
    createPond(air),
    createVillage(air, shadows),
    createCity(air, { bump: q.bump, shadows }),
    createTashkent(air),
    createTrees(air, { leaves: q.leaves }),
    createCars(air, { shadows, cars: q.cars }),
    createPassers(air, q.people, q.bump, shadows, q.coat),
    studio,
  ]) {
    parts.push(part)
    if (part.object) root.add(part.object)
  }

  let started = false
  const look = new Vector3()
  const toLight = new Vector3()
  const focus = new Vector3()
  const forward = new Vector3()
  const lightColor = new Color()

  function frame(gl: WebGLRenderer, camera: PerspectiveCamera, progress: number, delta: number): void {
    // Clamped, not trusted: a parked canvas hands back the whole time it was
    // parked as one frame, and that must not fast-forward anything.
    const dt = Math.min(0.25, Math.max(0, finite(delta)))
    const goal = Math.min(1, Math.max(0, finite(progress)))
    // The first frame, and any frame after a long gap, goes straight there:
    // easing from wherever the scene was left is a camera flying through walls.
    if (!started || dt >= 0.25 || Math.abs(goal - beat.p) > 0.2) beat.p = goal
    else beat.p += (goal - beat.p) * (1 - Math.exp(-9 * dt))
    started = true
    beat.t += dt
    beat.dt = dt
    beat.camera = camera
    beat.height = gl.domElement.height
    const p = beat.p

    // ---- where we are ------------------------------------------------------
    const shot = cameraAt(p, beat.shot, camera.aspect)
    const sky = skyAt(p, beat.sky)
    const stage = stageAt(p, beat.stage)
    const mood = moodAt(sky.elevation)
    const a = LIT[mood.from]!
    const b = LIT[mood.to]!
    const ma = MOODS[mood.from]!
    const mb = MOODS[mood.to]!
    beat.lamps = lampsAt(sky.elevation)

    camera.position.set(finite(shot.x), finite(shot.y, 2), finite(shot.z))
    camera.lookAt(look.set(finite(shot.tx), finite(shot.ty, 2), finite(shot.tz)))
    const fov = lensFor(shot.fov, camera.aspect)
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }

    // ---- the air -----------------------------------------------------------
    air.uSunDir.value.set(sky.sx, sky.sy, sky.sz)
    air.uMoonDir.value.set(sky.mx, sky.my, sky.mz)
    blend(air.uZenith.value, a.zenith, b.zenith, mood.mix)
    blend(air.uHorizon.value, a.horizon, b.horizon, mood.mix)
    blend(air.uGlow.value, a.glow, b.glow, mood.mix)
    blend(air.uHaze.value, a.haze, b.haze, mood.mix)
    blend(air.uSunColor.value, a.light, b.light, mood.mix)
    air.uSunUp.value = ramp(-2.5, 0.6, sky.elevation)
    air.uMoonUp.value = ramp(-1.5, -7, sky.elevation) * ramp(0, 0.1, sky.my)
    air.uStars.value = mixNumber(ma.stars, mb.stars, mood.mix)
    // The clouds drift on the scene's own clock, and race while the days do.
    air.uTime.value = beat.t + sky.days * 260
    air.uDays.value = sky.days
    air.uCloud.value = 0.42 + 0.2 * Math.sin(sky.days * 2.1 + 0.6)
    // Mist in the low ground at dawn, clear by mid-morning, a little in the city at night.
    // Mist in the low ground on the first morning, burnt off by the time the
    // hunt is over; after that only the ordinary thickness of air, and a
    // little more of it over the city at night, where there is light to show it.
    const mist = (1 - ramp(0.26, 0.42, p)) * (1 - ramp(1, 15, Math.max(0, sky.elevation)))
    const density = 0.0021 + 0.0041 * mist + 0.0011 * beat.lamps
    air.uAir.value.set(density, 0.05, -1, 0.75 * air.uSunUp.value)

    // ---- the light ---------------------------------------------------------
    const share = sunShare(sky.elevation)
    const bySun = sky.elevation > -3
    toLight.set(bySun ? sky.sx : sky.mx, bySun ? sky.sy : sky.my, bySun ? sky.sz : sky.mz)
    // Never from below, whatever the script says: a light under the ground
    // lights the undersides of everything.
    toLight.y = Math.max(toLight.y, 0.06)
    toLight.normalize()
    // Through nothing at the moment the sun hands over to the moon.
    const handover = Math.min(1, Math.abs(sky.elevation + 3) / 1.6)
    const moonUp = ramp(0.02, 0.2, sky.my)
    const power = mixNumber(ma.power, mb.power, mood.mix) * handover * (bySun ? Math.max(share, 0.25) : moonUp)
    blend(lightColor, a.light, b.light, mood.mix)
    sun.color.copy(lightColor)
    sun.intensity = power
    beat.light.copy(lightColor).multiplyScalar(power)

    // The shadow box rides ahead of the camera, on the ground.
    camera.getWorldDirection(forward)
    forward.y = 0
    if (forward.lengthSq() < 1e-6) forward.set(1, 0, 0)
    forward.normalize()
    focus.set(shot.x + forward.x * SHADOW.ahead, 0, shot.z + forward.z * SHADOW.ahead)
    focus.y = groundAt(focus.x, focus.z)
    target.position.copy(focus)
    sun.position.copy(focus).addScaledVector(toLight, SHADOW.depth * 0.5)
    target.updateMatrixWorld()

    blend(skyLight.color, a.ambient, b.ambient, mood.mix)
    blend(skyLight.groundColor, a.ground, b.ground, mood.mix)
    skyLight.intensity = mixNumber(ma.fill, mb.fill, mood.mix)
    beat.ambient.copy(skyLight.color).multiplyScalar(skyLight.intensity)

    const rangeUniforms = rangeMaterial.uniforms as { uLight: { value: Color }; uAmbient: { value: Color } }
    rangeUniforms.uLight.value.copy(beat.light).multiplyScalar(0.34)
    rangeUniforms.uAmbient.value.copy(skyLight.color).multiplyScalar(skyLight.intensity * 0.6)

    // ---- the ground through the years --------------------------------------
    land.uField.value = stage.field
    land.uCity.value = stage.city

    // Eyes that have been in the dark: wide open in the cave, and the day
    // outside its mouth is white until they have closed down again.
    const indoors = 1 - ramp(0.15, 0.225, p)
    // And while the days race, the nights are a moment each: lifted, or the
    // reader spends a third of that stretch looking at a black frame.
    const lifted = 1 + 2.1 * stage.lapse * ramp(3, -5, sky.elevation)
    gl.toneMappingExposure = mixNumber(ma.exposure, mb.exposure, mood.mix) * mixNumber(1, 1.75, indoors) * lifted

    for (const part of parts) part.update(beat)
    // Where the walk is, for anything outside that wants to know — a test, mostly.
    gl.domElement.dataset.walk = p.toFixed(3)
  }

  /** The sets that bring a lamp of their own, which are never lit together. */
  const lamps = (): Object3D[] =>
    parts.flatMap((part) => {
      let has = false
      part.object?.traverse((object) => {
        if ((object as Light).isLight) has = true
      })
      return has && part.object ? [part.object] : []
    })

  return {
    root,
    frame,
    beat,
    arrivals: air,
    rehearse(run) {
      const lit = lamps()
      const were = lit.map((object) => object.visible)
      for (let only = -1; only < lit.length; only++) {
        lit.forEach((object, index) => {
          object.visible = index === only
        })
        run()
      }
      lit.forEach((object, index) => {
        object.visible = were[index]!
      })
    },
    warmups(draw) {
      const lit = lamps()
      const sets: Object3D[] = [dome, ground, range, ...parts.flatMap((part) => (part.object ? [part.object] : []))]
      const jobs: (() => void)[] = []
      for (let only = -1; only < lit.length; only++) {
        for (const set of sets) {
          // A set with a lamp of its own is only ever drawn by that lamp.
          const lamp = lit.indexOf(set)
          if (lamp >= 0 && lamp !== only) continue
          jobs.push(() => {
            const shown = sets.map((object) => object.visible)
            // Only this set, by the one lamp that is lit.
            sets.forEach((object) => {
              object.visible = object === set || (only >= 0 && object === lit[only])
            })
            // Everything in the set, wherever it is and whether or not it has come on yet.
            const inside: [Object3D, boolean, boolean][] = []
            set.traverse((object) => {
              inside.push([object, object.visible, object.frustumCulled])
              object.visible = true
              object.frustumCulled = false
            })
            draw()
            for (const [object, visible, culled] of inside) {
              object.visible = visible
              object.frustumCulled = culled
            }
            sets.forEach((object, index) => {
              object.visible = shown[index]!
            })
          })
        }
      }
      return jobs
    },
    add(part) {
      parts.push(part)
      if (part.object) root.add(part.object)
    },
    setPaper: studio.setPaper,
    dispose() {
      for (const part of parts) part.dispose()
      dome.geometry.dispose()
      dome.material.dispose()
      ground.geometry.dispose()
      ground.material.dispose()
      range.geometry.dispose()
      rangeMaterial.dispose()
      sun.shadow.map?.dispose()
      sun.dispose()
      skyLight.dispose()
    },
  }
}

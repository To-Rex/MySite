import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  CatmullRomCurve3,
  ConeGeometry,
  type Group,
  IcosahedronGeometry,
  type InstancedMesh,
  MathUtils,
  Matrix4,
  type Mesh,
  MeshStandardMaterial,
  type Object3D,
  type PointLight,
  type Points,
  Quaternion,
  type ShaderMaterial,
  type SkinnedMesh,
  Vector3,
} from 'three'
import type { DeviceTier } from '@/hooks/useDeviceTier'
import { pointer } from '@/lib/pointer'
import { CAMERA, OPENING, VIEW_HEIGHT, drainCommands, setNotFoundAct, stageLayout, toStage } from '@/lib/notFound'
import { cue, grindSound } from '@/features/sound/store'
import type { Theme } from '@/theme/context'
import type { CreatureDetail } from './creatures'
import { DETAIL_BY_TIER, MASCOT_SKIN, animateFlap, animateTurtleSwim, useBind, useCreature, type Rig } from './creatureRig'
import { Eyes } from './creatureFittings'
import { GLOW_LAYER, createBloom } from './notFoundBloom'
import { DIGIT_HEIGHT, NUMBER_WIDTH, buildColumns } from './notFoundGlyphs'
import {
  EMBERS,
  FIELD,
  GROUND,
  SKY,
  makeBurstMaterial,
  makeColumnGeometry,
  makeColumnGlowMaterial,
  makeColumnMaterial,
  makeCoreGeometry,
  makeCoreMaterial,
  makeEmberMaterial,
  makeFlareMaterial,
  makeGroundMaterial,
  makeMeteorHeadMaterial,
  makeMeteorTrailMaterial,
  makeRingMaterial,
  makeSeedCloud,
  makeSkyMaterial,
  makeStarMaterial,
  makeStreakGeometry,
  makeStreakMaterial,
} from './notFoundMaterials'
import { GlowMask, Rex } from './NotFoundRex'
import { ROAR_HOLD, ROAR_WIND } from './notFoundRexActs'
import { type Burst, finite, landMeteor, launchMeteor, panOf, requestAct, resetShow, seeded, show, smooth } from './notFoundShow'
import { SkinMaterial } from './skinMaterial'
import { ThemedEnvironment } from './ThemedEnvironment'

export interface NotFoundSceneProps {
  theme: Theme
  tier: DeviceTier
  reducedMotion: boolean
}

interface Quality {
  dpr: number | [number, number]
  /** Circumradius of a column: smaller means more of them. */
  cell: number
  embers: number
  stars: number
  rocks: number
  bloom: boolean
  /** Skin bump strength; 0 skips the effect on weak devices. */
  bump: number
  turtles: number
  flyers: number
}

const FAR_METEORS = 5

const QUALITY: Record<DeviceTier, Quality> = {
  high: { dpr: [1, 2], cell: 0.052, embers: 620, stars: 900, rocks: 44, bloom: true, bump: 0.03, turtles: 3, flyers: 3 },
  medium: { dpr: [1, 1.5], cell: 0.064, embers: 340, stars: 520, rocks: 26, bloom: true, bump: 0.012, turtles: 2, flyers: 2 },
  low: { dpr: [1, 1], cell: 0.088, embers: 110, stars: 200, rocks: 0, bloom: false, bump: 0, turtles: 1, flyers: 0 },
}

/** Things the bloom pass should draw as well as the frame. */
const glows = (object: Object3D) => object.layers.enable(GLOW_LAYER)

const scratch = new Vector3()
const scratch2 = new Vector3()

/** Where a point on the screen falls on the plane just in front of the number. */
function onNumberPlane(nx: number, ny: number, camera: { position: Vector3 } & Object3D, out: Vector3): Vector3 {
  scratch.set(nx, ny, 0.5).unproject(camera as never)
  scratch.sub(camera.position).normalize()
  const z = show.layout.stageScale * 0.5
  const along = (z - camera.position.z) / scratch.z
  return out.copy(camera.position).addScaledVector(scratch, along)
}

/** Whether a click on the screen landed on the tyrannosaur, near enough. */
function hitsTheAnimal(nx: number, ny: number, camera: { position: Vector3 } & Object3D): boolean {
  const L = show.layout
  scratch.set(nx, ny, 0.5).unproject(camera as never)
  scratch.sub(camera.position).normalize()
  const along = (L.rexZ - camera.position.z) / scratch.z
  const x = camera.position.x + scratch.x * along
  const y = camera.position.y + scratch.y * along
  const rx = (x - show.rexX) / (L.rexScale * 0.56)
  const ry = (y - (L.groundY + L.rexScale * 0.2)) / (L.rexScale * 0.24)
  return rx * rx + ry * ry < 1
}

/**
 * Runs the opening and everything that happens by itself afterwards. Sits ahead
 * of the rest of the scene: the negative priority means every other callback
 * this frame reads the same time, and it does not count as taking over the
 * render the way a positive priority would.
 */
function Director({ theme, reducedMotion }: { theme: Theme; reducedMotion: boolean }) {
  const size = useThree((state) => state.size)
  const invalidate = useThree((state) => state.invalidate)
  // Only uniforms change with the theme, which R3F cannot see.
  useEffect(() => invalidate(), [invalidate, theme, size])
  useLayoutEffect(() => {
    show.layout = stageLayout(size.width, size.height, NUMBER_WIDTH)
  }, [size.width, size.height])

  const hoverPower = useRef(0)
  const parallax = useRef({ x: 0, y: 0 })

  useFrame((state, dt) => {
    const { camera } = state
    const L = show.layout
    // Sprites are sized in pixels, and a pixel is a much larger share of a phone.
    FIELD.uPointScale.value = state.gl.getPixelRatio() * MathUtils.clamp(Math.min(state.size.height / 900, state.size.width / 1100), 0.55, 1.4)

    // The sky is centred on the number as the camera sees it, whatever depth it is really at.
    const skyZ = -9
    const reach = (CAMERA.z - skyZ) / CAMERA.z
    SKY.uCentre.value.set(L.stageX * reach, CAMERA.y + (L.stageY - CAMERA.y) * reach)
    SKY.uRadius.value = (DIGIT_HEIGHT * 0.5) * L.stageScale * 1.3 * reach
    EMBERS.uFloor.value = L.groundY - 0.3
    GROUND.uShade.value.set(L.rexX, L.rexZ, L.rexScale * 0.44, L.rexScale * 0.16)
    GROUND.uQuiet.value.set(L.quiet[0], L.quiet[1], L.quiet[2], L.quiet[3])

    if (reducedMotion) {
      show.t = 20
      FIELD.uTime.value = 20
      FIELD.uBuild.value = 99
      SKY.uReveal.value = 1
      GROUND.uCrack.value = 99
      camera.position.set(0, CAMERA.y, CAMERA.z)
      camera.lookAt(0, CAMERA.lookY, 0)
      setNotFoundAct('alive')
      return
    }

    const step = Math.min(dt, 0.25)
    show.t += step
    const t = show.t
    FIELD.uTime.value = t
    FIELD.uBuild.value = Math.max(0, t - OPENING.rise)

    show.shake = MathUtils.damp(show.shake, 0, 3.8, step)
    show.thump = MathUtils.damp(show.thump, 0, 11, step)
    FIELD.uLava.value = MathUtils.damp(FIELD.uLava.value, 1, 1.7, step)
    SKY.uFlash.value = MathUtils.damp(SKY.uFlash.value, 0, 6.5, step)
    EMBERS.uGust.value = MathUtils.damp(EMBERS.uGust.value, 0, 0.9, step)

    // ---- The opening ---------------------------------------------------------
    if (!show.opened && t >= OPENING.meteor) {
      show.opened = true
      scratch2.set(L.stageX, L.stageY, 0.4)
      launchMeteor(scratch2, OPENING.impact - OPENING.meteor, 1.3)
      GROUND.uCrackFrom.value.set(L.stageX, 0.2)
    }
    if (!show.stonesCued && t >= OPENING.rise) {
      show.stonesCued = true
      cue({ kind: 'stones' })
    }
    if (t >= OPENING.impact) {
      setNotFoundAct(t >= OPENING.alive ? 'alive' : 'impact')
      SKY.uReveal.value = smooth(OPENING.impact, OPENING.impact + 1.1, t)
      GROUND.uCrack.value = t - OPENING.impact
    }

    for (const strike of show.strikes) if (strike.live && t >= strike.lands) landMeteor(strike)

    // ---- What the visitor is doing -------------------------------------------
    for (const command of drainCommands()) {
      if (command.kind === 'roar') {
        // Not mid-stride: it stops to do this.
        if (show.arrived) requestAct('roar')
      } else if (show.arrived && hitsTheAnimal(command.nx, command.ny, camera)) {
        show.rexPoked = true
      } else if (show.strikes.some((strike) => !strike.live)) {
        onNumberPlane(command.nx, command.ny, camera, scratch2)
        const halfW = NUMBER_WIDTH * 0.5 * L.stageScale
        const halfH = DIGIT_HEIGHT * 0.5 * L.stageScale
        scratch2.x = MathUtils.clamp(scratch2.x, L.stageX - halfW, L.stageX + halfW)
        scratch2.y = MathUtils.clamp(scratch2.y, L.stageY - halfH, L.stageY + halfH)
        launchMeteor(scratch2, 0.5, 0.82)
      }
    }

    // It mutters to itself, between roars.
    if (show.arrived && !show.rexBusy && t >= show.nextGrumble && t - show.roarAt > 3.4) {
      const n = Math.floor(t)
      show.nextGrumble = t + 6.5 + seeded(n, 41) * 7.5
      show.grumbleAt = t
      cue({ kind: seeded(n, 42) < 0.62 ? 'growl' : 'snort', pan: panOf(show.mouth.x) })
    }

    // The far meteors are timed in their own shader; this is the same sum.
    for (let i = 0; i < FAR_METEORS; i++) {
      const period = 7 + seeded(i, 50) * 11
      const pass = Math.floor((t + seeded(i, 51) * period) / period)
      if (show.streakCycles[i] !== undefined && pass !== show.streakCycles[i] && t > OPENING.impact) {
        cue({ kind: 'farStreak', pan: (seeded(i, 53) - 0.5) * 1.4 })
      }
      show.streakCycles[i] = pass
    }

    // Left alone, it carries on without you.
    if (t >= show.nextAuto) {
      const n = ++show.autos
      show.nextAuto = t + 8 + seeded(n, 31) * 8
      scratch2.set(
        L.stageX + (seeded(n, 32) - 0.5) * NUMBER_WIDTH * L.stageScale * 0.92,
        L.stageY + (seeded(n, 33) - 0.5) * DIGIT_HEIGHT * L.stageScale * 0.9,
        L.stageScale * 0.5,
      )
      launchMeteor(scratch2, 0.85, 0.55)
    }

    const touch = pointer.isTouch || !pointer.active
    const wanted = t > OPENING.rise + 2.2 ? (touch ? 0.62 : pointer.inside ? 1 : 0) : 0
    hoverPower.current = MathUtils.damp(hoverPower.current, wanted, 3.2, step)
    if (touch) {
      // No cursor to follow, so something wanders over the number by itself.
      const [wx, wy] = [Math.sin(t * 0.37) * NUMBER_WIDTH * 0.42, Math.sin(t * 0.61 + 1.2) * DIGIT_HEIGHT * 0.36]
      FIELD.uHover.value.set(wx, wy, hoverPower.current)
    } else {
      onNumberPlane(pointer.nx, pointer.ny, camera, scratch2)
      const [sx, sy] = toStage(scratch2.x, scratch2.y, L)
      // Stone dragging on stone, for as long as the cursor is moving over it.
      const moved = Math.hypot(sx - FIELD.uHover.value.x, sy - FIELD.uHover.value.y) / Math.max(step, 0.001)
      const over = Math.abs(sx) < NUMBER_WIDTH / 2 && Math.abs(sy) < DIGIT_HEIGHT / 2
      const level = over ? Math.min(1, moved * 0.14) * hoverPower.current : 0
      if (Math.abs(level - show.grindLevel) > 0.02) {
        show.grindLevel = level
        grindSound(level, MathUtils.clamp(sx / (NUMBER_WIDTH / 2), -1, 1))
      }
      FIELD.uHover.value.set(sx, sy, hoverPower.current)
    }

    // ---- The camera ----------------------------------------------------------
    const mx = pointer.inside && !pointer.isTouch ? pointer.nx : 0
    const my = pointer.inside && !pointer.isTouch ? pointer.ny : 0
    parallax.current.x = MathUtils.damp(parallax.current.x, mx * 0.42, 2.4, step)
    parallax.current.y = MathUtils.damp(parallax.current.y, my * 0.24, 2.4, step)

    const settle = 1 - (1 - smooth(0, 5.5, t)) ** 2
    const drift = Math.sin(t * 0.17) * 0.05
    const quake = show.shake * show.shake
    camera.position.set(
      parallax.current.x + drift + finite(Math.sin(t * 73) * quake * 0.13),
      CAMERA.y + parallax.current.y + finite(Math.cos(t * 91) * quake * 0.11) - show.thump * 0.05,
      MathUtils.lerp(CAMERA.z + 1.9, CAMERA.z, settle),
    )
    camera.lookAt(0, CAMERA.lookY + finite(Math.sin(t * 61) * quake * 0.03), 0)
  }, -1)
  return null
}

/* -------------------------------------------------------------------------- */
/* Backdrop                                                                    */
/* -------------------------------------------------------------------------- */

function Sky() {
  const material = useMemo(() => makeSkyMaterial(), [])
  useEffect(() => () => material.dispose(), [material])
  return (
    <mesh position={[0, 0, -9]} renderOrder={-10} material={material}>
      <planeGeometry args={[120, 70]} />
    </mesh>
  )
}

function Stars({ count }: { count: number }) {
  const geometry = useMemo(() => makeSeedCloud(count, (i, c) => seeded(i, c + 20)), [count])
  const material = useMemo(() => makeStarMaterial(), [])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={-9} />
}

function FarMeteors({ theme, count }: { theme: Theme; count: number }) {
  const geometry = useMemo(() => makeStreakGeometry(count, (i, c) => seeded(i, c + 50)), [count])
  const material = useMemo(() => makeStreakMaterial(theme), [theme])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={-8} />
}

function Ground() {
  const material = useMemo(() => makeGroundMaterial(), [])
  const mesh = useRef<Mesh>(null)
  useEffect(() => () => material.dispose(), [material])
  useFrame(() => {
    if (mesh.current) mesh.current.position.y = show.layout.groundY
  })
  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-5} material={material} onUpdate={glows}>
      <planeGeometry args={[70, 40]} />
    </mesh>
  )
}

function Lights({ theme }: { theme: Theme }) {
  const dark = theme === 'dark'
  const lava = useRef<PointLight>(null)
  const burst = useRef<PointLight>(null)
  const throat = useRef<PointLight>(null)
  useFrame(() => {
    const L = show.layout
    const t = show.t
    if (throat.current) {
      const since = t - show.roarAt - ROAR_WIND
      throat.current.position.copy(show.mouth)
      throat.current.intensity = since > 0 && since < ROAR_HOLD ? Math.sin((since / ROAR_HOLD) * Math.PI) * (dark ? 7 : 3) : 0
    }
    if (lava.current) {
      lava.current.position.set(L.stageX, L.stageY - DIGIT_HEIGHT * 0.5 * L.stageScale - 0.25, 1.5)
      const flicker = 0.85 + Math.sin(t * 3.1) * 0.08 + Math.sin(t * 7.3 + 1.2) * 0.05
      lava.current.intensity = (dark ? 15 : 5) * flicker * FIELD.uLava.value * smooth(OPENING.impact, OPENING.impact + 1.4, t)
    }
    if (burst.current) {
      const flare = show.flares.reduce((best, f) => (f.born > best.born ? f : best), show.flares[0]!)
      const age = t - flare.born
      burst.current.position.copy(flare.at).setZ(flare.at.z + 1.5)
      burst.current.intensity = age >= 0 && age < 1 ? (1 - age) ** 2 * (dark ? 170 : 60) : 0
    }
  })
  return (
    <>
      <ambientLight intensity={dark ? 0.16 : 0.55} />
      {/* The ground is what is on fire, so the undersides of things are what is warm. */}
      <hemisphereLight color="#000000" groundColor="#ff5a1c" intensity={dark ? 0.75 : 0.28} />
      <directionalLight position={[-4, 5, 7]} intensity={dark ? 1.15 : 1.25} color={dark ? '#ffe7cc' : '#fff6ea'} />
      {/* From the eclipse, behind: what draws the edges of everything against the sky. */}
      <directionalLight position={[3, 3.5, -7]} intensity={dark ? 3.1 : 0.7} color={dark ? '#ffb27a' : '#ffd2ad'} />
      <pointLight ref={lava} color="#ff5a1c" intensity={0} distance={15} decay={2} />
      <pointLight ref={burst} color="#ffb070" intensity={0} distance={18} decay={2} />
      <pointLight ref={throat} color="#ff6a24" intensity={0} distance={3.5} decay={2} />
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* The number                                                                  */
/* -------------------------------------------------------------------------- */

function Columns({ theme, cell, bloom }: { theme: Theme; cell: number; bloom: boolean }) {
  const field = useMemo(() => buildColumns(cell), [cell])
  const geometry = useMemo(() => makeColumnGeometry(field), [field])
  const material = useMemo(() => makeColumnMaterial(theme), [theme])
  const glow = useMemo(() => makeColumnGlowMaterial(), [])
  const core = useMemo(() => makeCoreMaterial(), [])
  const coreGeometry = useMemo(() => makeCoreGeometry(), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  useEffect(
    () => () => {
      glow.dispose()
      core.dispose()
      coreGeometry.dispose()
    },
    [glow, core, coreGeometry],
  )
  return (
    <>
      <mesh geometry={coreGeometry} material={core} onUpdate={glows} />
      <mesh geometry={geometry} material={material} frustumCulled={false} />
      {bloom && <mesh geometry={geometry} material={glow} frustumCulled={false} layers={GLOW_LAYER} />}
    </>
  )
}

/** Stone and swimmers both hang off this, so they stay threaded through the zero at any size. */
function Stage({ reducedMotion, children }: { reducedMotion: boolean; children: ReactNode }) {
  const group = useRef<Group>(null)
  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    const L = show.layout
    const t = show.t
    const step = Math.min(dt, 1 / 30)
    const float = reducedMotion ? 0 : Math.sin(t * 0.55) * 0.035
    g.position.set(finite(L.stageX), finite(L.stageY) + float, 0)
    g.scale.setScalar(L.stageScale)
    const mx = reducedMotion || !pointer.inside || pointer.isTouch ? 0 : pointer.nx
    const my = reducedMotion || !pointer.inside || pointer.isTouch ? 0 : pointer.ny
    const idle = reducedMotion ? 0 : Math.sin(t * 0.21) * 0.035
    g.rotation.y = MathUtils.damp(g.rotation.y, mx * 0.13 + idle, 2.6, step)
    g.rotation.x = MathUtils.damp(g.rotation.x, -my * 0.07, 2.6, step)
  })
  return <group ref={group}>{children}</group>
}

/* -------------------------------------------------------------------------- */
/* Everything else that is alive                                               */
/* -------------------------------------------------------------------------- */

/** In and out through the zero, and round the back of the last four. */
const THROUGH_THE_ZERO = new CatmullRomCurve3(
  [
    new Vector3(0, 0.08, 1.9),
    new Vector3(0, 0, 0.1),
    new Vector3(0.04, -0.04, -1.9),
    new Vector3(2.5, 0.6, -2.8),
    new Vector3(5, 1.7, -0.5),
    new Vector3(3.4, 2.4, 2.1),
    new Vector3(1.1, 1.1, 2.9),
  ],
  true,
  'catmullrom',
  0.5,
)

const ROUND_THE_NUMBER = new CatmullRomCurve3(
  [
    new Vector3(-6.2, 0.9, 0.6),
    new Vector3(-3.5, 2.3, 3),
    new Vector3(0.5, 2.5, 3.6),
    new Vector3(4.6, 1.9, 2.4),
    new Vector3(6.6, 0.4, -0.8),
    new Vector3(3, -1.9, -3.2),
    new Vector3(-2.6, -2.1, -3.2),
    new Vector3(-6, -0.8, -1.8),
  ],
  true,
  'catmullrom',
  0.5,
)

const HIGH_LOOP = new CatmullRomCurve3(
  [
    new Vector3(-5.4, 2.1, 1),
    new Vector3(-2.9, 2.75, -2.2),
    new Vector3(1.6, 2.7, -2.8),
    new Vector3(4.3, 2.5, -0.4),
    new Vector3(2, 2.2, 2.8),
    new Vector3(-2.6, 2.3, 3),
  ],
  true,
  'catmullrom',
  0.5,
)

const SWIMS = [
  { path: THROUGH_THE_ZERO, scale: 0.72, lap: 25, phase: 0.62 },
  { path: ROUND_THE_NUMBER, scale: 1.05, lap: 41, phase: 0.08 },
  { path: HIGH_LOOP, scale: 0.6, lap: 33, phase: 0.4 },
] as const

interface SwimmerProps {
  swim: (typeof SWIMS)[number]
  index: number
  theme: Theme
  bump: number
  bloom: boolean
  reducedMotion: boolean
}

function Swimmer({ detail, ...props }: SwimmerProps & { detail: CreatureDetail }) {
  const rig = useCreature('turtle', detail)
  if (!rig) return null
  return <SwimmerBody rig={rig} {...props} />
}

function SwimmerBody({ rig, swim, index, theme, bump, bloom, reducedMotion }: SwimmerProps & { rig: Rig }) {
  const group = useRef<Group>(null)
  const mesh = useRef<SkinnedMesh>(null)
  const { geometry, root, skeleton, byName } = rig
  useBind(mesh, skeleton)
  const tangent = useMemo(() => new Vector3(), [])
  const invalidate = useThree((three) => three.invalidate)
  useEffect(() => invalidate(), [invalidate, rig])
  const lastZ = useRef(0)
  const nextBubbles = useRef(index * 3.7 + OPENING.alive + 3)

  useFrame(() => {
    const g = group.current
    if (!g) return
    const t = show.t
    const u = (swim.phase + t / swim.lap) % 1
    lastZ.current = g.position.z
    swim.path.getPointAt(u, g.position)
    if (!reducedMotion && t > OPENING.alive) {
      const L = show.layout
      const pan = panOf(L.stageX + g.position.x * L.stageScale)
      // The first one's path goes through the hole in the zero.
      if (index === 0 && lastZ.current > 0 && g.position.z <= 0 && Math.abs(g.position.x) < 1.2) cue({ kind: 'portal', pan })
      if (t >= nextBubbles.current) {
        nextBubbles.current = t + 5 + seeded(Math.floor(t), index + 60) * 9
        cue({ kind: 'bubbles', pan })
      }
    }
    swim.path.getTangentAt(u, tangent)
    g.rotation.order = 'YZX'
    g.rotation.y = finite(Math.atan2(-tangent.z, tangent.x))
    g.rotation.z = finite(Math.asin(MathUtils.clamp(tangent.y, -1, 1)))
    g.rotation.x = reducedMotion ? 0 : Math.sin(t * 0.5 + index) * 0.16
    // They come in once the number has stopped flying about.
    const born = reducedMotion ? 1 : smooth(OPENING.rise + 2.2, OPENING.rise + 3.6, t)
    g.scale.setScalar(Math.max(0.0001, swim.scale * born))
    if (!reducedMotion) animateTurtleSwim(byName, t * 1.4, index * 2.1)
  })

  return (
    <group ref={group} scale={0.0001}>
      <skinnedMesh ref={mesh} geometry={geometry} frustumCulled={false}>
        <SkinMaterial theme={theme} species="turtle" texScale={1.7} bump={bump} halfHeight={0.17} plateMix={0.8} />
      </skinnedMesh>
      {bloom && <GlowMask rig={rig} />}
      <primitive object={root} />
      <Eyes rig={rig} theme={theme} />
    </group>
  )
}

function Flyer({ index, theme, reducedMotion }: { index: number; theme: Theme; reducedMotion: boolean }) {
  const rig = useCreature('pterosaur', 'low')
  if (!rig || reducedMotion) return null
  return <FlyerBody rig={rig} index={index} theme={theme} />
}

/** Three of them, high and far, crossing the sun every so often. */
function FlyerBody({ rig, index, theme }: { rig: Rig; index: number; theme: Theme }) {
  const group = useRef<Group>(null)
  const mesh = useRef<SkinnedMesh>(null)
  const { geometry, root, skeleton, byName } = rig
  useBind(mesh, skeleton)
  const nextCall = useRef(0)
  const lastBeat = useRef(0)

  useFrame(() => {
    const g = group.current
    if (!g) return
    const L = show.layout
    const t = show.t
    const lap = 28
    const u = (t / lap + 0.72 + index * 0.028) % 1
    const span = (VIEW_HEIGHT * Math.max(L.aspect, 1) + 8) * 1.2
    const lift = animateFlap(byName, t + index * 0.7, 1.05, 0.5)
    g.position.set(span * (0.5 - u), L.stageY + 1.5 + index * 0.42 + Math.sin(t * 0.6 + index) * 0.25 + lift * 0.8, -5.5 - index * 0.8)
    g.rotation.set(0.1, Math.PI + Math.sin(t * 0.4 + index) * 0.1, 0.04)
    g.scale.setScalar(Math.max(0.0001, (1.15 - index * 0.14) * smooth(OPENING.impact, OPENING.impact + 1, t)))

    // Only worth hearing while they are on the screen.
    const pan = g.position.x / ((VIEW_HEIGHT * Math.max(0.5, L.aspect)) / 2)
    if (Math.abs(pan) < 1.05 && t > OPENING.impact + 1) {
      if (index === 0) {
        show.flyerAt.copy(g.position)
        show.flyerSeen = t
      }
      if (t >= nextCall.current) {
        nextCall.current = t + 2.2 + seeded(Math.floor(t), index + 40) * 4.5
        cue({ kind: 'screech', pan: MathUtils.clamp(pan, -1, 1) })
      }
      const beat = Math.floor((t + index * 0.7) * 1.05)
      if (index === 0 && beat !== lastBeat.current) cue({ kind: 'wing', pan: MathUtils.clamp(pan, -1, 1) })
      lastBeat.current = beat
    }
  })

  return (
    <group ref={group} scale={0.0001}>
      <skinnedMesh ref={mesh} geometry={geometry} frustumCulled={false}>
        <SkinMaterial theme={theme} species="pterosaur" texScale={MASCOT_SKIN.pterosaur.texScale} bump={0} halfHeight={MASCOT_SKIN.pterosaur.halfHeight} plateMix={MASCOT_SKIN.pterosaur.plateMix} />
      </skinnedMesh>
      <primitive object={root} />
      <Eyes rig={rig} theme={theme} />
    </group>
  )
}

/** Chunks of the crater that never came back down. */
function Rocks({ count, theme }: { count: number; theme: Theme }) {
  const mesh = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => new IcosahedronGeometry(1, 0), [])
  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        color: theme === 'dark' ? '#403c39' : '#3a3633',
        roughness: 0.74,
        metalness: 0.1,
        flatShading: true,
        envMapIntensity: theme === 'dark' ? 1.4 : 0.7,
      }),
    [theme],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  const rocks = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        angle: seeded(i, 1) * Math.PI * 2,
        rx: 5.4 + seeded(i, 2) * 4.2,
        rz: 2 + seeded(i, 3) * 3.5,
        y: 0.3 + (seeded(i, 4) - 0.5) * 3.4,
        speed: (0.02 + seeded(i, 5) * 0.05) * (seeded(i, 6) < 0.5 ? -1 : 1),
        size: 0.05 + seeded(i, 7) ** 3 * 0.17,
        axis: new Vector3(seeded(i, 8) - 0.5, seeded(i, 9) - 0.5, seeded(i, 10) - 0.5).normalize(),
        spin: 0.1 + seeded(i, 11) * 0.5,
      })),
    [count],
  )

  const matrix = useMemo(() => new Matrix4(), [])
  const q = useMemo(() => new Quaternion(), [])
  const p = useMemo(() => new Vector3(), [])
  const s = useMemo(() => new Vector3(), [])

  useFrame(() => {
    const instanced = mesh.current
    if (!instanced) return
    const t = show.t
    const L = show.layout
    const born = smooth(OPENING.rise, OPENING.rise + 2, t)
    rocks.forEach((rock, i) => {
      const a = rock.angle + t * rock.speed
      p.set(L.stageX + Math.cos(a) * rock.rx * L.stageScale, L.stageY + rock.y * L.stageScale + Math.sin(t * 0.3 + i) * 0.08, Math.sin(a) * rock.rz)
      q.setFromAxisAngle(rock.axis, t * rock.spin + i)
      s.setScalar(rock.size * Math.max(0.0001, born) * L.stageScale)
      matrix.compose(p, q, s)
      instanced.setMatrixAt(i, matrix)
    })
    instanced.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} />
}

function Embers({ count, theme }: { count: number; theme: Theme }) {
  const geometry = useMemo(() => makeSeedCloud(count, (i, c) => seeded(i, c + 80)), [count])
  const material = useMemo(() => makeEmberMaterial(theme), [theme])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  return <points geometry={geometry} material={material} frustumCulled={false} onUpdate={theme === 'dark' ? glows : undefined} />
}

/* -------------------------------------------------------------------------- */
/* Meteors and impacts                                                         */
/* -------------------------------------------------------------------------- */

const UP = new Vector3(0, 1, 0)
const METEOR_ROCK = 0.22
const TRAIL_LENGTH = 4.6

function Meteor({ index, theme }: { index: number; theme: Theme }) {
  const group = useRef<Group>(null)
  const head = useMemo(() => makeMeteorHeadMaterial(), [])
  const trail = useMemo(() => makeMeteorTrailMaterial(theme), [theme])
  const flare = useMemo(() => makeFlareMaterial(theme), [theme])
  const cone = useMemo(() => {
    const geometry = new ConeGeometry(METEOR_ROCK * 1.15, TRAIL_LENGTH, 18, 1, true)
    // Point at the rock; the wide end trails behind.
    geometry.rotateX(Math.PI)
    geometry.translate(0, -TRAIL_LENGTH / 2, 0)
    return geometry
  }, [])
  const sprite = useRef<Mesh>(null)
  useEffect(() => () => head.dispose(), [head])
  useEffect(
    () => () => {
      trail.dispose()
      flare.dispose()
    },
    [trail, flare],
  )
  useEffect(() => () => cone.dispose(), [cone])

  useFrame(({ camera }) => {
    const g = group.current
    if (!g) return
    const strike = show.strikes[index]!
    g.visible = strike.live && show.t >= strike.born
    if (!g.visible) return
    const u = MathUtils.clamp((show.t - strike.born) / Math.max(0.001, strike.lands - strike.born), 0, 1)
    const eased = u * u * (0.35 + 0.65 * u)
    g.position.lerpVectors(strike.from, strike.to, eased)
    scratch.copy(strike.from).sub(strike.to).normalize()
    g.quaternion.setFromUnitVectors(UP, scratch)
    g.scale.setScalar(0.6 + strike.power * 0.5)
    const s = sprite.current
    if (s) {
      s.quaternion.copy(g.quaternion).invert().multiply(camera.quaternion)
      ;(s.material as ShaderMaterial).uniforms.uPower!.value = 1.4
    }
  })

  return (
    <group ref={group} visible={false}>
      <mesh material={head} onUpdate={glows}>
        <icosahedronGeometry args={[METEOR_ROCK, 1]} />
      </mesh>
      <mesh geometry={cone} material={trail} position={[0, TRAIL_LENGTH, 0]} onUpdate={glows} frustumCulled={false} />
      <mesh ref={sprite} material={flare} onUpdate={theme === 'dark' ? glows : undefined} scale={2.4}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  )
}

/** By day these are drawn as themselves: added on top of paper, glow only turns the page yellow. */
const glowsAtNight = (theme: Theme) => (theme === 'dark' ? glows : undefined)

function Rings({ theme }: { theme: Theme }) {
  const meshes = useRef<(Mesh | null)[]>([])
  const materials = useMemo(() => show.rings.map(() => makeRingMaterial(theme)), [theme])
  useEffect(() => () => materials.forEach((material) => material.dispose()), [materials])
  useFrame(({ camera }) => {
    show.rings.forEach((ring, i) => {
      const mesh = meshes.current[i]
      if (!mesh) return
      const age = (show.t - ring.born) / ring.life
      mesh.visible = age >= 0 && age <= 1
      if (!mesh.visible) return
      mesh.position.copy(ring.at)
      mesh.quaternion.copy(camera.quaternion)
      mesh.scale.setScalar(ring.size)
      const material = mesh.material as ShaderMaterial
      material.uniforms.uAge!.value = age
      material.uniforms.uPower!.value = ring.power
    })
  })
  return (
    <>
      {materials.map((material, i) => (
        <mesh
          key={i}
          ref={(mesh) => {
            meshes.current[i] = mesh
          }}
          material={material}
          visible={false}
          onUpdate={glowsAtNight(theme)}
          frustumCulled={false}
        >
          <planeGeometry args={[1, 1]} />
        </mesh>
      ))}
    </>
  )
}

function Flares({ theme }: { theme: Theme }) {
  const meshes = useRef<(Mesh | null)[]>([])
  const materials = useMemo(() => show.flares.map(() => makeFlareMaterial(theme)), [theme])
  useEffect(() => () => materials.forEach((material) => material.dispose()), [materials])
  useFrame(({ camera }) => {
    show.flares.forEach((flare, i) => {
      const mesh = meshes.current[i]
      if (!mesh) return
      const age = (show.t - flare.born) / flare.life
      mesh.visible = age >= 0 && age <= 1
      if (!mesh.visible) return
      mesh.position.copy(flare.at)
      mesh.quaternion.copy(camera.quaternion)
      mesh.scale.setScalar(flare.size * (0.6 + age * 0.6))
      ;(mesh.material as ShaderMaterial).uniforms.uPower!.value = (1 - age) ** 2 * 1.6
    })
  })
  return (
    <>
      {materials.map((material, i) => (
        <mesh
          key={i}
          ref={(mesh) => {
            meshes.current[i] = mesh
          }}
          material={material}
          visible={false}
          onUpdate={glowsAtNight(theme)}
          frustumCulled={false}
          renderOrder={20}
        >
          <planeGeometry args={[1, 1]} />
        </mesh>
      ))}
    </>
  )
}

function BurstPool({ pool, count, dust, theme }: { pool: Burst[]; count: number; dust: boolean; theme: Theme }) {
  const geometry = useMemo(() => makeSeedCloud(count, (i, c) => seeded(i + (dust ? 500 : 0), c + 120)), [count, dust])
  const materials = useMemo(() => pool.map(() => makeBurstMaterial(theme, dust)), [pool, theme, dust])
  const points = useRef<(Object3D | null)[]>([])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => materials.forEach((material) => material.dispose()), [materials])
  useFrame(() => {
    pool.forEach((burst, i) => {
      const cloud = points.current[i]
      if (!cloud) return
      const age = show.t - burst.born
      cloud.visible = age >= 0 && age < 1.6
      if (!cloud.visible) return
      const { uniforms } = (cloud as Points).material as ShaderMaterial
      ;(uniforms.uOrigin!.value as Vector3).copy(burst.at)
      uniforms.uAge!.value = age
      uniforms.uPower!.value = burst.power
    })
  })
  return (
    <>
      {materials.map((material, i) => (
        <points
          key={i}
          ref={(cloud) => {
            points.current[i] = cloud
          }}
          geometry={geometry}
          material={material}
          visible={false}
          frustumCulled={false}
          onUpdate={dust ? undefined : glows}
        />
      ))}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* The canvas                                                                  */
/* -------------------------------------------------------------------------- */

function BloomPass({ strength }: { strength: number }) {
  const size = useThree((state) => state.size)
  const dpr = useThree((state) => state.viewport.dpr)
  const bloom = useRef<ReturnType<typeof createBloom> | null>(null)

  useEffect(() => {
    const created = createBloom()
    bloom.current = created
    return () => {
      bloom.current = null
      created.dispose()
    }
  }, [])

  useEffect(() => {
    bloom.current?.resize(size.width * dpr, size.height * dpr)
  }, [size.width, size.height, dpr])

  // A positive priority is how R3F is told this callback does the drawing.
  useFrame(({ gl, scene, camera }) => {
    const pass = bloom.current
    if (!pass) {
      gl.render(scene, camera)
      return
    }
    pass.render(gl, scene, camera as never, strength)
  }, 1)
  return null
}

/**
 * The 404 page: a number of basalt columns over something molten, a sky with
 * the sun gone out behind it, and the animal that did not make it either.
 */
export default function NotFoundScene({ theme, tier, reducedMotion }: NotFoundSceneProps) {
  const q = QUALITY[tier]
  const [dpr, setDpr] = useState(q.dpr)
  const [bloom, setBloom] = useState(q.bloom)
  const detail = DETAIL_BY_TIER[tier]

  useLayoutEffect(() => {
    resetShow()
    FIELD.uDark.value = theme === 'dark' ? 1 : 0
    // Mount only: changing theme must not restart the show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    FIELD.uDark.value = theme === 'dark' ? 1 : 0
  }, [theme])

  return (
    <Canvas
      dpr={dpr}
      frameloop={reducedMotion ? 'demand' : 'always'}
      camera={{ position: [0, CAMERA.y, CAMERA.z + 1.9], fov: CAMERA.fov, near: 0.1, far: 70 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', stencil: false }}
      style={{ pointerEvents: 'none' }}
    >
      <Director theme={theme} reducedMotion={reducedMotion} />
      <PerformanceMonitor
        onDecline={() => {
          setDpr(1)
          setBloom(false)
        }}
        flipflops={2}
      />
      <ThemedEnvironment theme={theme} resolution={tier === 'high' ? 256 : tier === 'medium' ? 128 : 64} />
      <Lights theme={theme} />
      <Sky />
      {theme === 'dark' && <Stars count={q.stars} />}
      {!reducedMotion && <FarMeteors theme={theme} count={FAR_METEORS} />}
      <Ground />
      <Stage reducedMotion={reducedMotion}>
        <Columns theme={theme} cell={q.cell} bloom={bloom} />
        {SWIMS.slice(0, q.turtles).map((swim, i) => (
          <Swimmer key={i} swim={swim} index={i} theme={theme} detail={detail} bump={q.bump} bloom={bloom} reducedMotion={reducedMotion} />
        ))}
      </Stage>
      {q.rocks > 0 && <Rocks count={q.rocks} theme={theme} />}
      <Rex theme={theme} detail={detail} bump={q.bump} bloom={bloom} reducedMotion={reducedMotion} />
      {Array.from({ length: q.flyers }, (_, i) => (
        <Flyer key={i} index={i} theme={theme} reducedMotion={reducedMotion} />
      ))}
      {!reducedMotion && (
        <>
          <Embers key={theme} count={q.embers} theme={theme} />
          {show.strikes.map((_, i) => (
            <Meteor key={`${theme}-${i}`} index={i} theme={theme} />
          ))}
          <Rings key={`rings-${theme}`} theme={theme} />
          <Flares key={`flares-${theme}`} theme={theme} />
          <BurstPool pool={show.hot} count={tier === 'low' ? 90 : 200} dust={false} theme={theme} />
          <BurstPool pool={show.dust} count={tier === 'low' ? 10 : 22} dust theme={theme} />
        </>
      )}
      {bloom && <BloomPass strength={theme === 'dark' ? 0.6 : 0.34} />}
    </Canvas>
  )
}

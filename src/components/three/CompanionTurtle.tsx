import { Canvas, useFrame, type RootState } from '@react-three/fiber'
import { useRef } from 'react'
import { MathUtils, type Group, type SkinnedMesh } from 'three'
import type { Theme } from '@/theme/context'
import type { DeviceTier } from '@/hooks/useDeviceTier'
import { DETAIL_BY_TIER, animateTurtleSwim, useBind, useCreature, type Rig } from './creatureRig'
import { Eyes } from './creatureFittings'
import { SkinMaterial } from './skinMaterial'
import { ThemedEnvironment } from './ThemedEnvironment'

/**
 * A single turtle that follows the reader down the page.
 *
 * It lives in its own fixed, pointer-transparent canvas rather than in the hero
 * scene, because the hero canvas scrolls away with its section. The turtle is
 * the same cached geometry the hero uses — only the skeleton is per-instance —
 * so it costs no extra generation work.
 */

export interface CompanionTurtleProps {
  theme: Theme
  tier: DeviceTier
  /** Fades the layer without tearing the WebGL context down. */
  visible: boolean
}

/**
 * Where the turtle swims: how far in from the edge it can reach, and how big it
 * is as a fraction of the screen.
 *
 * `inset` is measured from the on-screen limit worked out each frame, not from
 * the middle of the viewport, so the lane can never put the body half outside
 * the frame. The wide lane rides the right margin — the content column is capped
 * at 84rem, so the turtle crosses only the ends of lines — while a phone, which
 * has no margin to hide in, gets the bottom corner instead.
 */
const LANE = {
  wide: { inset: 0.015, y: 0.1, driftX: 0.045, lagY: 0.62, size: 0.105 },
  narrow: { inset: 0.02, y: -0.72, driftX: 0.06, lagY: 0.3, size: 0.17 },
} as const

/** Seconds each stunt runs for. */
const TRICK_TIME = { barrel: 1.15, loop: 1.4, spin: 1.5, dart: 0.85, wave: 2.6 } as const
type TrickKind = keyof typeof TRICK_TIME

/** Scroll speeds, in px/s, that count as hurried and as standing still. */
const FAST = 1250
const CALM = 70

/** Breathing room kept between the body and the edge, as a fraction of half the viewport. */
const MARGIN = 0.02

const TAU = Math.PI * 2

/**
 * Guards every value that feeds a transform. A single NaN reaching a rotation
 * makes the object's matrix invalid, and three then draws nothing at all — no
 * warning, no error, the creature simply is not there while still reporting
 * `visible: true` and a sane position.
 */
const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback)

/** Rises to 1 over the first `edge` of a run, holds, then falls back over the last. */
const hold = (u: number, edge: number) =>
  MathUtils.smoothstep(u, 0, edge) * (1 - MathUtils.smoothstep(u, 1 - edge, 1))

function Swimmer({ rig, theme, tier }: { rig: Rig; theme: Theme; tier: DeviceTier }) {
  const group = useRef<Group>(null)
  const body = useRef<Group>(null)
  const mesh = useRef<SkinnedMesh>(null)
  const { geometry, root, skeleton, byName } = rig
  useBind(mesh, skeleton)

  // Furthest any vertex can sit from the group's origin. Taken from the bounding
  // sphere rather than a box so it holds at any orientation — mid-somersault
  // included — which is what lets the clamp below be a hard guarantee.
  const sphere = geometry.boundingSphere
  const reach = sphere ? sphere.center.length() + sphere.radius : 1

  // Current normalised position, eased toward the target every frame, plus the
  // scroll state it follows. Scroll is read straight from the window rather than
  // through a motion value, so the numbers driving the matrix are always real.
  const at = useRef<{ x: number; y: number }>({ x: 0.7, y: LANE.wide.y })
  const previous = useRef<{ x: number; y: number }>({ x: 0.7, y: LANE.wide.y })
  const lastScroll = useRef(0)
  const speed = useRef(0)

  // The swim has its own clock, which runs faster the harder the page is being
  // scrolled: the flippers then row for the speed the turtle appears to travel at.
  const swim = useRef(0)

  // Stunt state. The cooldown matters — without it a fast scroll would start a
  // fresh roll on every frame it stayed fast. The greeting keeps a second, much
  // longer one of its own, so that waiting for it can never leave a scroll
  // unanswered.
  const trick = useRef<{ kind: TrickKind; start: number; end: number } | null>(null)
  const nextTrick = useRef(3)
  const nextWave = useRef(9)
  const movedAt = useRef(0)
  const quarter = useRef(-1)
  const crossed = useRef(0)
  const turn = useRef(0)

  const bump = tier === 'high' ? 0.03 : tier === 'medium' ? 0.022 : 0

  useFrame((state: RootState, dt) => {
    const g = group.current
    const b = body.current
    if (!g || !b) return
    // Two clocks: `elapsed` is how long the frame really took and divides the
    // velocities, so a 20 fps phone reads the same scroll speed a 120 Hz monitor
    // does; `delta` is capped for the damping, where a long frame would
    // otherwise overshoot.
    const elapsed = MathUtils.clamp(dt, 1 / 240, 0.25)
    const delta = Math.min(elapsed, 1 / 30)
    const t = state.clock.elapsedTime
    const lane = state.size.width < 760 ? LANE.narrow : LANE.wide

    // Size follows the screen instead of being a fixed world scale. Viewport
    // height is constant for a given camera, so the smaller of the two keeps the
    // turtle a phone-sized accent on a phone without letting an ultrawide
    // monitor inflate it.
    const screen = Math.min(state.viewport.width, state.viewport.height * 1.6)
    const scale = screen * lane.size
    b.scale.setScalar(scale)

    // --- what the reader is doing -------------------------------------------
    const scroll = finite(window.scrollY, 0)
    // Clamped because an anchor jump covers thousands of pixels in one frame,
    // which would otherwise read as a scroll speed nothing can damp back down.
    const raw = MathUtils.clamp(finite((scroll - lastScroll.current) / elapsed, 0), -15000, 15000)
    lastScroll.current = scroll
    // Smoothed with the true frame time, not the capped one: damping a signal
    // with a clock that runs slow makes it lag, and on a device drawing 15 fps
    // the reader would be halfway down the page before the turtle noticed.
    speed.current = MathUtils.damp(speed.current, raw, 7, elapsed)
    const rush = Math.abs(speed.current)
    if (rush > CALM) movedAt.current = t

    const span = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
    const progress = MathUtils.clamp(finite(scroll / span, 0), 0, 1)

    // --- pick a stunt --------------------------------------------------------
    // Each one answers something the reader just did: a hurry down the page, a
    // jump back up, crossing into a new quarter of it, or leaving it alone.
    //
    // A crossing is remembered rather than acted on at once, because a hurried
    // scroll crosses one too and a hurry has earned the roll, not the pirouette —
    // the damped speed just needs a moment before it can say which this is.
    // Anything that fires meanwhile consumes the crossing.
    const step = Math.floor(progress * 4)
    if (step !== quarter.current) {
      if (quarter.current >= 0) crossed.current = t
      quarter.current = step
    }
    if (crossed.current > 0 && t - crossed.current > 3) crossed.current = 0

    const run = trick.current
    if (run?.kind === 'wave' && rush > FAST * 0.6 && run.end - t > 0.3) {
      // The greeting is for a reader who has stopped. Once they move again the
      // turtle drops it and gets back to swimming — rewinding `start` so the run
      // still ends on its own ramp instead of the pose snapping away. The
      // `end - t` guard makes this happen once: re-cutting an already-cut run
      // every frame leaves it stuck just short of finished, holding a tenth of
      // the pose for as long as the reader keeps scrolling.
      const u = MathUtils.clamp((t - run.start) / Math.max(0.001, run.end - run.start), 0, 0.94)
      run.start = t - (0.3 * u) / (1 - u)
      run.end = t + 0.3
      nextTrick.current = Math.min(nextTrick.current, t + 0.35)
    } else if (!trick.current && t > nextTrick.current) {
      let kind: TrickKind | null = null
      if (speed.current > FAST) kind = turn.current++ % 2 === 0 ? 'barrel' : 'dart'
      else if (speed.current < -FAST) kind = 'loop'
      else if (rush > CALM && crossed.current > 0 && t - crossed.current > 0.5) kind = 'spin'
      else if (t - movedAt.current > 7 && t > nextWave.current) kind = 'wave'
      if (kind) {
        trick.current = { kind, start: t, end: t + TRICK_TIME[kind] }
        nextTrick.current = t + TRICK_TIME[kind] + 2.5
        crossed.current = 0
        // Greeting the reader is charming once and nagging twice.
        if (kind === 'wave') nextWave.current = t + TRICK_TIME[kind] + 13
      }
    }

    // --- run it --------------------------------------------------------------
    let roll = 0
    let flip = 0
    let spin = 0
    let offX = 0
    let offY = 0
    let offZ = 0
    let greet = 0
    const active = trick.current
    if (active) {
      const u = MathUtils.clamp((t - active.start) / Math.max(0.001, active.end - active.start), 0, 1)
      const ease = MathUtils.smoothstep(u, 0, 1)
      const bell = Math.sin(u * Math.PI)
      switch (active.kind) {
        case 'barrel':
          roll = ease * TAU
          offY = bell * 0.05
          break
        case 'loop':
          flip = -ease * TAU
          offY = bell * 0.14
          break
        case 'spin':
          spin = ease * TAU
          offY = bell * 0.07
          break
        case 'dart':
          offX = -bell * 0.26
          offZ = bell * 0.75
          roll = Math.sin(u * TAU) * 0.6
          break
        case 'wave':
          greet = hold(u, 0.3)
          offY = greet * 0.04
          break
      }
      if (t >= active.end) trick.current = null
    }

    // --- where it is allowed to be -------------------------------------------
    const { width, height } = state.viewport
    const camZ = Math.max(1, state.camera.position.z)
    // Darting toward the camera magnifies the body *and* its distance from the
    // centre, so the limit has to shrink by the same factor or the stunt is what
    // finally pushes the turtle off the edge.
    const persp = camZ / Math.max(0.5, camZ - offZ)
    const room = (1 - MARGIN) / persp
    const limitX = Math.max(0.02, room - (reach * scale) / (width / 2))
    const limitY = Math.max(0.02, room - (reach * scale) / (height / 2))

    // Where it wants to be: drifting slowly along its lane as the page advances,
    // and dragged down-screen while the reader scrolls away from it — that lag is
    // what reads as following rather than floating in place.
    const edge = limitX - lane.inset
    const lag = MathUtils.clamp(speed.current / 2600, -1, 1)
    const targetX = edge - lane.driftX * (0.5 + 0.5 * Math.sin(progress * Math.PI * 2.6 + 0.7))
    const targetY = MathUtils.clamp(lane.y - lag * lane.lagY + Math.sin(t * 0.4) * 0.05, -limitY, limitY)

    at.current.x = finite(MathUtils.damp(at.current.x, targetX, 1.6, delta), targetX)
    at.current.y = finite(MathUtils.damp(at.current.y, targetY, 2.6, delta), targetY)

    const px = MathUtils.clamp(at.current.x + offX, -limitX, limitX)
    const py = MathUtils.clamp(at.current.y + offY, -limitY, limitY)
    g.position.set((px * width) / 2, (py * height) / 2, offZ)

    // Bank into the direction of travel, so a fast scroll tips it nose-down.
    const vx = finite((at.current.x - previous.current.x) / elapsed, 0)
    const vy = finite((at.current.y - previous.current.y) / elapsed, 0)
    previous.current = { x: at.current.x, y: at.current.y }
    g.rotation.y = MathUtils.damp(g.rotation.y, -0.5 + MathUtils.clamp(vx * 1.4, -0.7, 0.7), 4, delta)
    g.rotation.z = MathUtils.damp(g.rotation.z, MathUtils.clamp(vy * 0.9, -0.6, 0.6), 4, delta)
    g.rotation.x = Math.sin(t * 0.5) * 0.12

    // Stunts go on the inner group, in the turtle's own axes — head sits at +X,
    // flippers at ±Z — so X rolls it along its length, Z somersaults it nose over
    // tail and Y pirouettes it flat. The outer group stays free for placement.
    b.rotation.set(roll, spin + greet * 0.55, flip)

    const hurry = 1 + Math.min(rush / 900, 2.4) + (active?.kind === 'dart' ? 2.5 : 0)
    swim.current += delta * hurry
    animateTurtleSwim(byName, swim.current, 1.3)

    if (greet > 0.01) {
      // Blended over the stroke the swim just wrote, rather than replacing it, so
      // the turtle lifts a flipper out of its rowing instead of snapping into a pose.
      const flipper = byName.get('flipperFL')!
      flipper.rotation.x = MathUtils.lerp(flipper.rotation.x, -1.15 + Math.sin(swim.current * 9) * 0.5, greet)
      flipper.rotation.y = MathUtils.lerp(flipper.rotation.y, 0.45, greet)
      const head = byName.get('head')!
      head.rotation.y = MathUtils.lerp(head.rotation.y, 0.35, greet)
    }
  })

  return (
    <group ref={group}>
      <group ref={body} scale={0.6}>
        <skinnedMesh ref={mesh} geometry={geometry} frustumCulled={false}>
          <SkinMaterial theme={theme} species="turtle" texScale={1.7} bump={bump} halfHeight={0.17} plateMix={0.8} />
        </skinnedMesh>
        <primitive object={root} />
        <Eyes rig={rig} theme={theme} />
      </group>
    </group>
  )
}

function Scene({ theme, tier }: { theme: Theme; tier: DeviceTier }) {
  const rig = useCreature('turtle', DETAIL_BY_TIER[tier])
  return (
    <>
      {/* Brighter than the hero's night lighting: this turtle is small and often
          over a near-black background, where hero-level light leaves a silhouette. */}
      <ambientLight intensity={theme === 'dark' ? 0.38 : 0.55} />
      <directionalLight position={[3, 5, 4]} intensity={theme === 'dark' ? 1 : 0.9} />
      <directionalLight position={[-4, 1, -3]} intensity={theme === 'dark' ? 0.45 : 0.25} />
      {/* A sixteenth of the hero's cubemap: baking one costs a visible main-thread
          stall, and at this size the reflections it feeds are a few pixels wide. */}
      <ThemedEnvironment theme={theme} resolution={64} />
      {rig && <Swimmer rig={rig} theme={theme} tier={tier} />}
    </>
  )
}

export default function CompanionTurtle({ theme, tier, visible }: CompanionTurtleProps) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[2] transition-opacity duration-700 ease-[var(--ease-out)]"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <Canvas
        dpr={tier === 'high' ? [1, 1.5] : 1}
        frameloop={visible ? 'always' : 'never'}
        camera={{ position: [0, 0, 6], fov: 34, near: 0.1, far: 40 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power', stencil: false }}
        style={{ background: 'transparent' }}
      >
        <Scene theme={theme} tier={tier} />
      </Canvas>
    </div>
  )
}

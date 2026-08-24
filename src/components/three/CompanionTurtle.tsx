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
 * Where the turtle is allowed to swim, in normalised screen coordinates
 * (0,0 = centre, ±1 = edges), and how big it is as a fraction of the screen.
 *
 * The wide lane hugs the right margin: the content column is capped at 84rem
 * with a 3rem gutter, so past ~0.8 the turtle is mostly over empty page and
 * only its flippers cross the text. On a phone there is no margin to hide in,
 * so it drops into the bottom corner — behind the line being read — and shrinks.
 */
const LANE = {
  wide: { x: 0.84, y: 0.1, driftX: 0.09, lagY: 0.62, size: 0.105 },
  narrow: { x: 0.7, y: -0.72, driftX: 0.1, lagY: 0.3, size: 0.17 },
} as const

/**
 * Guards every value that feeds a transform. A single NaN reaching a rotation
 * makes the object's matrix invalid, and three then draws nothing at all — no
 * warning, no error, the creature simply is not there while still reporting
 * `visible: true` and a sane position.
 */
const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback)

function Swimmer({ rig, theme, tier }: { rig: Rig; theme: Theme; tier: DeviceTier }) {
  const group = useRef<Group>(null)
  const body = useRef<Group>(null)
  const mesh = useRef<SkinnedMesh>(null)
  const { geometry, root, skeleton, byName } = rig
  useBind(mesh, skeleton)

  // Current normalised position, eased toward the target every frame, plus the
  // scroll state it follows. Scroll is read straight from the window rather than
  // through a motion value, so the numbers driving the matrix are always real.
  const at = useRef<{ x: number; y: number }>({ x: LANE.wide.x, y: LANE.wide.y })
  const previous = useRef<{ x: number; y: number }>({ x: LANE.wide.x, y: LANE.wide.y })
  const lastScroll = useRef(0)
  const speed = useRef(0)
  const bump = tier === 'high' ? 0.03 : tier === 'medium' ? 0.022 : 0

  useFrame((state: RootState, dt) => {
    const g = group.current
    if (!g) return
    const delta = MathUtils.clamp(dt, 1 / 240, 1 / 30)
    const t = state.clock.elapsedTime
    const lane = state.size.width < 760 ? LANE.narrow : LANE.wide

    // Size follows the screen instead of being a fixed world scale. Viewport
    // height is constant for a given camera, so the smaller of the two keeps the
    // turtle a phone-sized accent on a phone without letting an ultrawide
    // monitor inflate it.
    const screen = Math.min(state.viewport.width, state.viewport.height * 1.6)
    body.current?.scale.setScalar(screen * lane.size)

    const scroll = finite(window.scrollY, 0)
    const raw = (scroll - lastScroll.current) / delta
    lastScroll.current = scroll
    speed.current = MathUtils.damp(speed.current, finite(raw, 0), 7, delta)

    // Where it wants to be: drifting slowly sideways as the page advances, and
    // dragged down-screen while the reader scrolls away from it — that lag is
    // what reads as following rather than floating in place.
    const span = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
    const progress = finite(scroll / span, 0)
    const lag = MathUtils.clamp(speed.current / 2600, -1, 1)
    const targetX = lane.x + Math.sin(progress * Math.PI * 2.6 + 0.7) * lane.driftX
    const targetY = MathUtils.clamp(lane.y - lag * lane.lagY + Math.sin(t * 0.4) * 0.05, -0.84, 0.84)

    at.current.x = finite(MathUtils.damp(at.current.x, targetX, 1.6, delta), lane.x)
    at.current.y = finite(MathUtils.damp(at.current.y, targetY, 2.6, delta), lane.y)

    const { width, height } = state.viewport
    g.position.set((at.current.x * width) / 2, (at.current.y * height) / 2, 0)

    // Bank into the direction of travel, so a fast scroll tips it nose-down.
    const vx = finite((at.current.x - previous.current.x) / delta, 0)
    const vy = finite((at.current.y - previous.current.y) / delta, 0)
    previous.current = { x: at.current.x, y: at.current.y }
    g.rotation.y = MathUtils.damp(g.rotation.y, -0.5 + MathUtils.clamp(vx * 1.4, -0.7, 0.7), 4, delta)
    g.rotation.z = MathUtils.damp(g.rotation.z, MathUtils.clamp(vy * 0.9, -0.6, 0.6), 4, delta)
    g.rotation.x = Math.sin(t * 0.5) * 0.12

    animateTurtleSwim(byName, t, 1.3)
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

import { useFrame, type RootState } from '@react-three/fiber'
import { useRef, type RefObject } from 'react'
import { MathUtils, type Group, type SkinnedMesh } from 'three'
import type { Theme } from '@/theme/context'
import type { DeviceTier } from '@/hooks/useDeviceTier'
import {
  DETAIL_BY_TIER,
  MASCOT_SKIN,
  animateDinoRun,
  animateMascot,
  animateTurtleSwim,
  useBind,
  useCreature,
  type Rig,
} from './creatureRig'
import { Eyes, Teeth } from './creatureFittings'
import { SkinMaterial } from './skinMaterial'
import type { AnyCreatureKind } from './mascots'
import type { CameoPlan } from './useCameoDirector'

/**
 * Things that cross the page while you read it.
 *
 * The scroll companion is one turtle keeping you company; these are the rest of
 * the world going about its business in the background — a tyrannosaur running
 * something down and not stopping, or a few turtles gliding past in formation.
 * Neither is interactive and neither hangs around: a cameo enters off one edge
 * and leaves by the other, and nothing is meshed until one is actually due.
 *
 * They ride the companion's canvas, which is the only one that exists the whole
 * way down the page.
 */

const CHASE_TIME = 3.9
const FLOCK_TIME = 4.8

/** Far enough off each edge that nothing pops into existence on screen. */
const OFF = 1.55

/** The formation, as offsets from the leader. */
const FLOCK = [
  { dx: 0, dy: 0, size: 1 },
  { dx: -0.3, dy: 0.15, size: 0.78 },
  { dx: -0.33, dy: -0.16, size: 0.7 },
] as const

/* -------------------------------------------------------------------------- */

interface BodyProps {
  rig: Rig
  species: AnyCreatureKind
  theme: Theme
  bump: number
  texScale: number
  halfHeight: number
  plateMix?: number
  bodyRef: RefObject<Group | null>
}

function Body({ rig, species, theme, bump, texScale, halfHeight, plateMix, bodyRef }: BodyProps) {
  const mesh = useRef<SkinnedMesh>(null)
  const { geometry, root, skeleton } = rig
  useBind(mesh, skeleton)
  return (
    <group ref={bodyRef} scale={0.0001}>
      <skinnedMesh ref={mesh} geometry={geometry} frustumCulled={false}>
        <SkinMaterial
          theme={theme}
          species={species}
          texScale={texScale}
          bump={bump}
          halfHeight={halfHeight}
          plateMix={plateMix}
        />
      </skinnedMesh>
      <primitive object={root} />
      <Eyes rig={rig} theme={theme} />
      {rig.teeth.length > 0 ? <Teeth rig={rig} theme={theme} /> : null}
    </group>
  )
}

/* -------------------------------------------------------------------------- */

interface RunProps {
  plan: CameoPlan
  theme: Theme
  tier: DeviceTier
  bump: number
  onDone: () => void
}

/** A tyrannosaur running something down, straight across and away. */
function Chase({ plan, theme, tier, bump, onDone }: RunProps) {
  const detail = DETAIL_BY_TIER[tier]
  const dinoRig = useCreature('dino', detail)
  const preyRig = useCreature(plan.mascot, detail)
  const dino = useRef<Group>(null)
  const prey = useRef<Group>(null)
  const clock = useRef(0)
  const skin = MASCOT_SKIN[plan.mascot]

  useFrame((state: RootState, dt) => {
    if (!dinoRig || !preyRig) return
    clock.current += Math.min(dt, 0.25)
    const t = clock.current
    const u = t / CHASE_TIME
    if (u >= 1) {
      onDone()
      return
    }

    const { width, height } = state.viewport
    const screen = Math.min(width, height * 1.6)
    const { way, lane } = plan
    // Facing its direction of travel: the models are built nose along +x.
    const yaw = way > 0 ? -0.32 : Math.PI + 0.32

    const p = prey.current
    if (p) {
      animateMascot(preyRig.byName, t, 1)
      const x = MathUtils.lerp(-OFF, OFF, u) * way
      const hop = Math.abs(Math.sin(u * Math.PI * 11)) * 0.05
      p.position.set((x * width) / 2, ((lane + 0.02 + hop) * height) / 2, 0)
      p.scale.setScalar(screen * 0.1)
      p.rotation.set(Math.sin(t * 15) * 0.07, yaw, Math.sin(t * 13) * 0.08)
    }

    const d = dino.current
    if (d) {
      // Three strides a second, and the hips rise twice a stride.
      const bob = animateDinoRun(dinoRig.byName, t * 2.1, 1)
      const x = MathUtils.lerp(-OFF - 0.58, OFF - 0.58, u) * way
      d.position.set((x * width) / 2, ((lane - 0.07) * height) / 2 + bob * screen * 0.17, 0)
      d.scale.setScalar(screen * 0.17)
      // Pitched forward over its stride: the lean is applied in its own frame, so
      // nose-down is the same sign whichever way it happens to be running.
      d.rotation.set(0, yaw, -0.17)
    }
  })

  return (
    <>
      {preyRig ? (
        <Body
          rig={preyRig}
          species={plan.mascot}
          theme={theme}
          bump={bump}
          texScale={skin.texScale}
          halfHeight={skin.halfHeight}
          plateMix={skin.plateMix}
          bodyRef={prey}
        />
      ) : null}
      {dinoRig ? (
        <Body rig={dinoRig} species="dino" theme={theme} bump={bump} texScale={2.6} halfHeight={0.22} bodyRef={dino} />
      ) : null}
    </>
  )
}

/* -------------------------------------------------------------------------- */

interface GliderProps {
  index: number
  plan: CameoPlan
  theme: Theme
  tier: DeviceTier
  bump: number
  onDone?: () => void
}

/**
 * One turtle of a formation. Each keeps its own clock, which stays in step with
 * the others because they share one cached mesh and so all mount on one frame.
 */
function Glider({ index, plan, theme, tier, bump, onDone }: GliderProps) {
  const rig = useCreature('turtle', DETAIL_BY_TIER[tier])
  const group = useRef<Group>(null)
  const clock = useRef(0)
  const spot = FLOCK[index] ?? FLOCK[0]

  useFrame((state: RootState, dt) => {
    const g = group.current
    if (!rig || !g) return
    clock.current += Math.min(dt, 0.25)
    const t = clock.current
    const u = t / FLOCK_TIME
    if (u >= 1) {
      onDone?.()
      return
    }

    const { width, height } = state.viewport
    const screen = Math.min(width, height * 1.6)
    const { way, lane } = plan
    animateTurtleSwim(rig.byName, t, index * 1.9)

    const x = (MathUtils.lerp(-OFF, OFF, u) + spot.dx) * way
    const y = lane + spot.dy + Math.sin(t * 1.15 + index) * 0.035
    g.position.set((x * width) / 2, (y * height) / 2, 0)
    g.scale.setScalar(screen * 0.055 * spot.size)
    g.rotation.set(Math.sin(t * 0.7 + index) * 0.12, way > 0 ? -0.45 : Math.PI + 0.45, Math.sin(t * 0.9 + index) * 0.09)
  })

  if (!rig) return null
  return (
    <Body
      rig={rig}
      species="turtle"
      theme={theme}
      bump={bump}
      texScale={1.7}
      halfHeight={0.17}
      plateMix={0.8}
      bodyRef={group}
    />
  )
}

/** A few turtles gliding past in formation. */
function Flock(props: RunProps) {
  return (
    <>
      {FLOCK.map((_, i) => (
        <Glider key={i} index={i} {...props} onDone={i === 0 ? props.onDone : undefined} />
      ))}
    </>
  )
}

/* -------------------------------------------------------------------------- */

export interface CameoProps {
  plan: CameoPlan
  theme: Theme
  tier: DeviceTier
  onDone: () => void
}

export function Cameo({ plan, theme, tier, onDone }: CameoProps) {
  const bump = tier === 'high' ? 0.03 : tier === 'medium' ? 0.022 : 0
  const props = { plan, theme, tier, bump, onDone }
  return plan.kind === 'chase' ? <Chase {...props} /> : <Flock {...props} />
}

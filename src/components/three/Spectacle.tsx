import { useFrame, type RootState } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { MathUtils, Vector3, type Bone, type Group, type SkinnedMesh } from 'three'
import type { Theme } from '@/theme/context'
import type { DeviceTier } from '@/hooks/useDeviceTier'
import { setSpectacleAct, setSpectacleMascot, useSpectacle, type SpectacleAct } from '@/lib/spectacle'
import { DETAIL_BY_TIER, useBind, useCreature, type Rig } from './creatureRig'
import { Eyes, Teeth } from './creatureFittings'
import { SkinMaterial } from './skinMaterial'
import { clearStage, stage } from './stage'
import { MASCOT_KINDS, type MascotKind } from './mascots'

/**
 * The hero's easter egg, staged in 3D.
 *
 * Double-clicking the name drops the letters and leaves one of the language
 * mascots standing where they were. It wanders towards the only other thing on
 * stage, the tyrannosaur eats it, and what comes out the other end sprouts the
 * name back.
 *
 * Nothing here mounts until a performance starts, so the six animals cost
 * nothing: no mesh is generated until one is actually summoned.
 */

/** Seconds each act runs for, in order. */
const SCRIPT: readonly (readonly [Exclude<SpectacleAct, 'idle'>, number])[] = [
  ['summon', 1.0],
  ['panic', 1.7],
  ['bite', 0.75],
  ['swallow', 1.3],
  ['drop', 1.4],
  ['sprout', 2.4],
]

/** Longest axis of the mascot, in arrangement units — the tyrannosaur is 3.4. */
const PREY_SIZE = 1.05

/** Just past the teeth, in the head bone's own space. */
const MOUTH = new Vector3(0.12, -0.015, 0)

/** Skin tuning per mascot: pattern frequency, countershading, scales vs plates. */
const SKIN: Record<MascotKind, { texScale: number; halfHeight: number; plateMix: number }> = {
  python: { texScale: 5.2, halfHeight: 0.14, plateMix: 0.15 },
  elephant: { texScale: 3.4, halfHeight: 0.3, plateMix: 0.85 },
  gopher: { texScale: 4.6, halfHeight: 0.34, plateMix: 0 },
  crab: { texScale: 3.8, halfHeight: 0.16, plateMix: 0.9 },
  swift: { texScale: 4.8, halfHeight: 0.12, plateMix: 0 },
  camel: { texScale: 3.6, halfHeight: 0.38, plateMix: 0.1 },
}

const easeInOut = (u: number) => u * u * (3 - 2 * u)
const bell = (u: number) => Math.sin(MathUtils.clamp(u, 0, 1) * Math.PI)

/**
 * Whatever the animal has, moved. Each mascot is rigged with only the bones its
 * anatomy needed, so this poses the ones that exist and ignores the rest — one
 * animator for six very different bodies.
 */
function animateMascot(byName: Map<string, Bone>, t: number, fear: number): void {
  const pose = (name: string, x: number, y: number, z: number) => {
    const bone = byName.get(name)
    if (bone) bone.rotation.set(x, y, z)
  }
  const quick = 1 + fear * 2.2

  pose('head', 0, Math.sin(t * 2.1 * quick) * (0.2 + fear * 0.45), Math.sin(t * 1.4) * 0.1)
  pose('tail', 0, Math.sin(t * 2.6 * quick) * (0.18 + fear * 0.3), 0)
  pose('neck', 0, Math.sin(t * 1.7 * quick) * (0.12 + fear * 0.3), Math.sin(t * 1.1) * 0.08)
  // Snake: a wave travelling down the body.
  for (let i = 1; i <= 3; i++) {
    pose(`body${i}`, 0, Math.sin(t * 2.4 * quick - i * 0.8) * (0.1 + fear * 0.22), 0)
  }
  // Bird: wingbeats, which get frantic.
  const beat = Math.sin(t * 6 * quick)
  pose('wingL', beat * (0.25 + fear * 0.7), 0, 0)
  pose('wingR', -beat * (0.25 + fear * 0.7), 0, 0)
  // Crab: claws waving.
  pose('clawL', 0, Math.sin(t * 3.4 * quick) * (0.2 + fear * 0.5), 0)
  pose('clawR', 0, -Math.sin(t * 3.4 * quick + 0.7) * (0.2 + fear * 0.5), 0)
  // Elephant: the trunk curls and uncurls.
  pose('trunk1', 0, 0, Math.sin(t * 1.6) * 0.18 - fear * 0.25)
  pose('trunk2', 0, 0, Math.sin(t * 1.9 + 0.6) * 0.22 - fear * 0.3)
}

/** The headline's centre, cast from the page onto the arrangement's plane. */
function headlinePoint(frame: RootState, out: Vector3): Vector3 {
  const el = typeof document === 'undefined' ? null : document.getElementById('hero-title')
  const view = frame.gl.domElement.getBoundingClientRect()
  const camera = frame.camera
  if (!el || view.width === 0 || view.height === 0) return out.set(-1.1, -0.9, 0)

  const rect = el.getBoundingClientRect()
  const ndcX = ((rect.left + rect.width * 0.42 - view.left) / view.width) * 2 - 1
  const ndcY = -(((rect.top + rect.height * 0.5 - view.top) / view.height) * 2 - 1)
  out.set(ndcX, ndcY, 0.5).unproject(camera)
  out.sub(camera.position)
  // Push along that ray until it crosses the plane the arrangement sits on.
  const toward = Math.abs(out.z) < 1e-4 ? 1 : -camera.position.z / out.z
  return out.multiplyScalar(toward).add(camera.position)
}

/** Roughly where the tyrannosaur's feet are, so the dropping lands on its level. */
function groundLevel(group: Group, tmp: Vector3): number {
  if (!stage.foot) return -1.2
  tmp.setFromMatrixPosition(stage.foot.matrixWorld)
  group.worldToLocal(tmp)
  return tmp.y + 0.04
}

/* -------------------------------------------------------------------------- */

interface ShowProps {
  mascot: MascotKind
  theme: Theme
  tier: DeviceTier
  bump: number
}

function Show({ mascot, theme, tier, bump }: ShowProps) {
  const rig = useCreature(mascot, DETAIL_BY_TIER[tier])
  const group = useRef<Group>(null)
  const prey = useRef<Group>(null)
  const dung = useRef<Group>(null)
  const shoot = useRef<Group>(null)

  const clock = useRef(0)
  const spawn = useRef(new Vector3())
  const placed = useRef(false)
  const ground = useRef(0)
  const from = useRef(0)
  const dropped = useRef(false)

  // Scratch vectors, so a frame allocates nothing.
  const tmp = useMemo(() => ({ a: new Vector3(), b: new Vector3(), mouth: new Vector3() }), [])

  // A performance cut short — the theme flipping, reduced motion switching on —
  // would otherwise leave the tyrannosaur crouched over prey that no longer exists.
  useEffect(() => clearStage, [])

  useFrame((frame: RootState, dt) => {
    const g = group.current
    if (!g) return

    // The letters are already falling; the animal only starts its entrance once
    // its mesh arrives from the worker — a few hundred milliseconds of
    // arithmetic away — and once there is a tyrannosaur to aim it at.
    if (!rig || !stage.head) return
    clock.current += Math.min(dt, 0.25)
    const t = clock.current

    // Where the name was, worked out once. The headline is DOM, so the only way
    // to stand the animal exactly where the words were is to take the element's
    // rect and cast it back through the camera.
    if (!placed.current) {
      placed.current = true
      spawn.current.copy(headlinePoint(frame, tmp.a))
      g.worldToLocal(spawn.current)
    }

    // --- which act, and how far into it --------------------------------------
    let act: SpectacleAct = 'idle'
    let u = 1
    let left = t
    for (const [name, length] of SCRIPT) {
      if (left < length) {
        act = name
        u = left / length
        break
      }
      left -= length
    }
    setSpectacleAct(act)
    if (act === 'idle') {
      clearStage()
      return
    }

    tmp.mouth.copy(MOUTH).applyMatrix4(stage.head.matrixWorld)
    g.worldToLocal(tmp.mouth)

    // --- the animal ----------------------------------------------------------
    const p = prey.current
    if (p) {
      const fear = act === 'panic' ? easeInOut(u) : act === 'bite' ? 1 : 0
      animateMascot(rig.byName, t, fear)

      if (act === 'summon') {
        // Condenses out of the letters rather than being dropped in: it turns
        // into place as it grows, with a small overshoot at the end.
        const s = easeInOut(u)
        p.position.copy(spawn.current)
        p.position.y += (1 - s) * 0.35
        p.scale.setScalar(PREY_SIZE * s * (1 + bell(u) * 0.18))
        p.rotation.set(0, (1 - s) * Math.PI * 1.5 - 0.5, 0)
      } else if (act === 'panic') {
        // It wanders towards the only other thing on stage, with a nervous hop.
        const bait = tmp.a.copy(tmp.mouth)
        bait.x += 0.55
        bait.y -= 0.12
        const s = easeInOut(u)
        p.position.lerpVectors(spawn.current, bait, s)
        p.position.y += Math.abs(Math.sin(t * 6)) * 0.07 * (1 - s * 0.4)
        p.scale.setScalar(PREY_SIZE)
        p.rotation.set(0, -0.5 + Math.sin(t * 3.1) * 0.35, Math.sin(t * 5) * 0.06)
      } else if (act === 'bite') {
        // Drawn in, then gone. The jaws land at 60%, which is where the animal
        // has to disappear — after that the head is only tossing it back.
        const s = easeInOut(Math.min(1, u / 0.6))
        p.position.lerp(tmp.mouth, s * 0.35 + 0.05)
        const shrink = Math.max(0, u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4)
        p.scale.setScalar(PREY_SIZE * shrink * (1 - s * 0.15))
        p.rotation.set(0, -0.5, Math.sin(t * 24) * 0.25 * shrink)
      } else {
        p.scale.setScalar(0)
      }
    }

    // --- what the tyrannosaur is asked to do ---------------------------------
    stage.crouch = act === 'panic' ? easeInOut(Math.min(1, u * 1.4)) : act === 'bite' ? 1 - u * 0.6 : 0
    stage.lunge = act === 'bite' ? bell(u) : 0
    // The jaws shut halfway through the lunge and stay shut into the swallow.
    stage.snap =
      act === 'bite'
        ? MathUtils.smoothstep(u, 0.3, 0.55)
        : act === 'swallow'
          ? 1 - easeInOut(Math.min(1, u * 2))
          : 0
    stage.toss = act === 'swallow' ? bell(u) : 0
    stage.gulp = act === 'swallow' ? MathUtils.clamp(u * 1.5, 0, 1) : 0
    stage.shake = act === 'bite' ? Math.max(0, 1 - Math.abs(u - 0.55) * 8) : 0

    // --- the dropping --------------------------------------------------------
    const d = dung.current
    if (d) {
      if (act === 'drop') {
        // Placed once, on a flag rather than inside a slice of the act: a window
        // a few hundredths wide is missed outright on a device drawing 3 fps, and
        // the dropping then falls from the origin — which is the middle of the
        // tyrannosaur, so the shoot grew out of its back.
        if (stage.vent && !dropped.current) {
          dropped.current = true
          tmp.b.set(-0.03, -0.05, 0).applyMatrix4(stage.vent.matrixWorld)
          g.worldToLocal(tmp.b)
          d.position.copy(tmp.b)
          from.current = tmp.b.y
          ground.current = groundLevel(g, tmp.a)
        }
        // Falls under something like gravity, then squashes on impact.
        const fall = Math.min(1, u / 0.55)
        d.position.y = MathUtils.lerp(from.current, ground.current, fall * fall)
        const squash = u > 0.55 ? bell((u - 0.55) / 0.45) : 0
        d.scale.set(0.22 * (1 + squash * 0.35), 0.22 * (1 - squash * 0.4), 0.22 * (1 + squash * 0.35))
        d.rotation.y = t * 1.2
      } else if (act === 'sprout') {
        // Sinks away as the shoot takes over.
        d.scale.setScalar(0.22 * (1 - easeInOut(Math.min(1, u / 0.5))))
      } else {
        d.scale.setScalar(0)
      }
    }

    // --- the shoot -----------------------------------------------------------
    const sh = shoot.current
    if (sh) {
      if (act === 'sprout') {
        const grow = easeInOut(Math.min(1, u / 0.7))
        sh.position.copy(d ? d.position : spawn.current)
        const fade = u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1
        sh.scale.set(grow * fade, grow * (0.6 + grow * 0.4) * fade, grow * fade)
        sh.rotation.y = -0.4 + Math.sin(t * 1.4) * 0.12
      } else {
        sh.scale.setScalar(0)
      }
    }
  })

  return (
    <group ref={group}>
      {rig ? <PreyBody rig={rig} mascot={mascot} theme={theme} bump={bump} bodyRef={prey} /> : null}
      <Dung groupRef={dung} theme={theme} />
      <Shoot groupRef={shoot} theme={theme} />
    </group>
  )
}

/* -------------------------------------------------------------------------- */

interface PreyBodyProps {
  rig: Rig
  mascot: MascotKind
  theme: Theme
  bump: number
  bodyRef: RefObject<Group | null>
}

function PreyBody({ rig, mascot, theme, bump, bodyRef }: PreyBodyProps) {
  const mesh = useRef<SkinnedMesh>(null)
  const { geometry, root, skeleton } = rig
  useBind(mesh, skeleton)
  const skin = SKIN[mascot]

  return (
    <group ref={bodyRef} scale={0.0001}>
      <skinnedMesh ref={mesh} geometry={geometry} frustumCulled={false}>
        <SkinMaterial
          theme={theme}
          species={mascot}
          texScale={skin.texScale}
          bump={bump}
          halfHeight={skin.halfHeight}
          plateMix={skin.plateMix}
        />
      </skinnedMesh>
      <primitive object={root} />
      <Eyes rig={rig} theme={theme} />
      {rig.teeth.length > 0 ? <Teeth rig={rig} theme={theme} /> : null}
    </group>
  )
}

/** Three stacked lumps. Small, dark, and on screen for a second and a half. */
function Dung({ groupRef, theme }: { groupRef: RefObject<Group | null>; theme: Theme }) {
  const colour = theme === 'dark' ? '#4a3c2c' : '#3b2f22'
  return (
    <group ref={groupRef} scale={0.0001}>
      {(
        [
          [0, -0.55, 0.62],
          [0.08, 0.05, 0.78],
          [-0.05, 0.62, 0.52],
        ] as const
      ).map(([x, y, s], i) => (
        <mesh key={i} position={[x, y, 0]} scale={[s, s * 0.78, s]}>
          <icosahedronGeometry args={[0.5, 1]} />
          <meshStandardMaterial color={colour} roughness={0.95} metalness={0} flatShading />
        </mesh>
      ))}
    </group>
  )
}

/** A stem and two leaves — the name grows out of this. */
function Shoot({ groupRef, theme }: { groupRef: RefObject<Group | null>; theme: Theme }) {
  const stem = theme === 'dark' ? '#6f8f4a' : '#587439'
  const leaf = theme === 'dark' ? '#87ab58' : '#6b8c43'
  return (
    <group ref={groupRef} scale={0.0001}>
      <mesh position={[0, 0.34, 0]}>
        <cylinderGeometry args={[0.022, 0.05, 0.68, 7]} />
        <meshStandardMaterial color={stem} roughness={0.8} metalness={0} />
      </mesh>
      {([1, -1] as const).map((side) => (
        <mesh key={side} position={[side * 0.14, 0.52, 0]} rotation={[0, 0, side * -0.7]} scale={[0.22, 0.06, 0.13]}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial color={leaf} roughness={0.75} metalness={0} />
        </mesh>
      ))}
    </group>
  )
}

/* -------------------------------------------------------------------------- */

export interface SpectacleProps {
  theme: Theme
  tier: DeviceTier
  bump: number
}

/**
 * Never the animal that turned up last time: two rounds of the same creature in
 * a row reads as a bug rather than a surprise.
 */
let lastCast: MascotKind | null = null

function cast(): MascotKind {
  const choices = MASCOT_KINDS.filter((k) => k !== lastCast)
  const pick = choices[Math.floor(Math.random() * choices.length)] ?? MASCOT_KINDS[0]!
  lastCast = pick
  return pick
}

/** Mounts the performance only while one is running. */
export function Spectacle({ theme, tier, bump }: SpectacleProps) {
  const { act, mascot, run } = useSpectacle()
  const waiting = act !== 'idle' && !mascot

  useEffect(() => {
    if (waiting) setSpectacleMascot(cast())
  }, [waiting])

  if (act === 'idle' || !mascot) return null
  return <Show key={run} mascot={mascot} theme={theme} tier={tier} bump={bump} />
}

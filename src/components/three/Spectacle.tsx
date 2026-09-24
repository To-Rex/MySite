import { useFrame, type RootState } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import {
  Color,
  DoubleSide,
  MathUtils,
  MeshStandardMaterial,
  Vector3,
  type Bone,
  type Group,
  type SkinnedMesh,
} from 'three'
import type { Theme } from '@/theme/context'
import type { DeviceTier } from '@/hooks/useDeviceTier'
import { setSpectacleAct, setSpectacleMascot, useSpectacle, type SpectacleAct } from '@/lib/spectacle'
import { DETAIL_BY_TIER, useBind, useCreature, type Rig } from './creatureRig'
import { Eyes, Teeth } from './creatureFittings'
import { SkinMaterial } from './skinMaterial'
import { clearStage, stage } from './stage'
import { MASCOT_KINDS, type MascotKind } from './mascots'

/**
 * The hero's easter egg: a hunt, staged in 3D.
 *
 * Double-clicking the name drops the letters and leaves one of the language
 * mascots standing where they were. It sees the tyrannosaur, bolts, and is run
 * down and killed. The tyrannosaur leaves something behind and walks off stage;
 * a tree grows out of it, fruits, drops the fruit, and the name comes out of the
 * split fruit as the tyrannosaur walks back to where it started.
 *
 * Nothing here mounts until a performance starts, so the six animals cost a
 * normal visit nothing: no mesh is generated until one is actually summoned.
 */

/** Seconds each act runs for, in order. */
const SCRIPT: readonly (readonly [Exclude<SpectacleAct, 'idle'>, number])[] = [
  ['summon', 1.0],
  ['stalk', 1.3],
  ['chase', 3.2],
  ['catch', 1.8],
  ['swallow', 1.2],
  ['drop', 1.3],
  ['leave', 2.2],
  ['grow', 2.6],
  ['ripen', 1.7],
  ['fall', 0.9],
  ['crack', 1.8],
  ['return', 2.6],
]

/** Longest axis of the mascot, in arrangement units — the tyrannosaur is 3.4. */
const PREY_SIZE = 1.05

/** Just past the teeth, in the head bone's own space. */
const MOUTH = new Vector3(0.12, -0.015, 0)

/**
 * The tyrannosaur's resting heading, mirrored from `HeroScene`. Turning to face
 * its prey means adding enough yaw to point its nose down −x; going the negative
 * way round is the shorter turn from where it stands.
 */
const DINO_YAW = -0.42
const FACE_PREY = -(Math.PI + DINO_YAW)

/** How far off the right-hand side of the stage it walks before the tree grows. */
const EXIT_X = 5.8

const TREE_SCALE = 1.0
/** Where the fruit hangs, in the tree's own units. */
const FRUIT_BRANCH = new Vector3(0.3, 1.04, 0.07)
const FRUIT_SIZE = 0.17

const UNRIPE = new Color('#6f8f4a')
const RIPE = new Color('#c0692b')

/** Leaf clusters, in the tree's own units: x, y, z, radius. */
const CANOPY: readonly (readonly [number, number, number, number])[] = [
  [0, 1.26, 0, 0.36],
  [0.29, 1.08, 0.09, 0.25],
  [-0.27, 1.12, -0.07, 0.23],
  [0.05, 1.47, -0.06, 0.21],
]

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
const easeOut = (u: number) => 1 - (1 - u) * (1 - u)
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
  const quick = 1 + fear * 3

  pose('head', 0, Math.sin(t * 2.1 * quick) * (0.2 + fear * 0.5), Math.sin(t * 1.4) * 0.1)
  pose('tail', 0, Math.sin(t * 2.6 * quick) * (0.18 + fear * 0.4), 0)
  pose('neck', 0, Math.sin(t * 1.7 * quick) * (0.12 + fear * 0.35), Math.sin(t * 1.1) * 0.08)
  // Snake: a wave travelling down the body.
  for (let i = 1; i <= 3; i++) {
    pose(`body${i}`, 0, Math.sin(t * 2.4 * quick - i * 0.8) * (0.1 + fear * 0.3), 0)
  }
  // Bird: wingbeats, which get frantic.
  const beat = Math.sin(t * 6 * quick)
  pose('wingL', beat * (0.25 + fear * 0.8), 0, 0)
  pose('wingR', -beat * (0.25 + fear * 0.8), 0, 0)
  // Crab: claws waving.
  pose('clawL', 0, Math.sin(t * 3.4 * quick) * (0.2 + fear * 0.6), 0)
  pose('clawR', 0, -Math.sin(t * 3.4 * quick + 0.7) * (0.2 + fear * 0.6), 0)
  // Elephant: the trunk curls and uncurls.
  pose('trunk1', 0, 0, Math.sin(t * 1.6) * 0.18 - fear * 0.3)
  pose('trunk2', 0, 0, Math.sin(t * 1.9 + 0.6) * 0.22 - fear * 0.35)
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

/** Roughly where the tyrannosaur's feet are, so things land on its level. */
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
  const tree = useRef<Group>(null)
  const canopy = useRef<Group>(null)
  const fruit = useRef<Group>(null)
  const fruitL = useRef<Group>(null)
  const fruitR = useRef<Group>(null)

  const clock = useRef(0)
  const placed = useRef(false)
  const dropped = useRef(false)
  const spawn = useRef(new Vector3())
  const catchAt = useRef(new Vector3())
  const treeAt = useRef(new Vector3())
  const ground = useRef(0)
  const dropFrom = useRef(0)
  const fruitFrom = useRef(0)

  // Scratch vectors and a shared fruit skin, so a frame allocates nothing.
  const tmp = useMemo(() => ({ a: new Vector3(), b: new Vector3(), mouth: new Vector3() }), [])
  const skin = useMemo(
    () => new MeshStandardMaterial({ color: UNRIPE.clone(), roughness: 0.42, metalness: 0.04, side: DoubleSide }),
    [],
  )
  useEffect(() => () => skin.dispose(), [skin])

  // A performance cut short — the theme flipping, reduced motion switching on —
  // would otherwise leave the tyrannosaur crouched over prey that no longer exists.
  useEffect(() => clearStage, [])

  useFrame((frame: RootState, dt) => {
    const g = group.current
    if (!g) return

    // The letters are already falling; the animal only starts its entrance once
    // its mesh arrives from the worker — a few hundred milliseconds of
    // arithmetic away — and once there is a tyrannosaur to hunt it.
    if (!rig || !stage.head) return
    const step = Math.min(dt, 0.25)
    clock.current += step
    const t = clock.current

    // Where the name was, worked out once. The headline is DOM, so the only way
    // to stand the animal exactly where the words were is to take the element's
    // rect and cast it back through the camera.
    if (!placed.current) {
      placed.current = true
      spawn.current.copy(headlinePoint(frame, tmp.a))
      g.worldToLocal(spawn.current)
      // It runs away from the tyrannosaur, which stands to the right of it.
      catchAt.current.set(spawn.current.x - 1.15, spawn.current.y - 0.3, spawn.current.z + 0.25)
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

    const after = (name: Exclude<SpectacleAct, 'idle'>) =>
      SCRIPT.findIndex(([n]) => n === act) > SCRIPT.findIndex(([n]) => n === name)

    /* --- the animal --------------------------------------------------------- */
    const p = prey.current
    if (p) {
      const fear = act === 'stalk' ? easeInOut(u) : act === 'chase' || act === 'catch' ? 1 : 0
      animateMascot(rig.byName, t, fear)

      if (act === 'summon') {
        // Condenses out of the letters rather than being dropped in.
        const s = easeInOut(u)
        p.position.copy(spawn.current)
        p.position.y += (1 - s) * 0.35
        p.scale.setScalar(PREY_SIZE * s * (1 + bell(u) * 0.18))
        p.rotation.set(0, (1 - s) * Math.PI * 1.5 - 0.5, 0)
      } else if (act === 'stalk') {
        // It has seen what is behind it, and starts backing away.
        p.position.copy(spawn.current)
        p.position.x -= easeInOut(u) * 0.22
        p.position.y += Math.sin(t * 9) * 0.015 * u
        p.scale.setScalar(PREY_SIZE)
        p.rotation.set(0, MathUtils.lerp(-0.5, Math.PI * 0.86, easeInOut(u)), 0)
      } else if (act === 'chase') {
        // Bolting: a flat-out run with two panicked jinks and bounding strides.
        const s = easeOut(u)
        p.position.lerpVectors(spawn.current, catchAt.current, s)
        p.position.y += Math.abs(Math.sin(u * Math.PI * 6)) * 0.2 * (1 - u * 0.5)
        const jink = Math.sin(u * Math.PI * 3.2) * (1 - u * 0.55)
        p.position.z += jink * 0.4
        p.scale.setScalar(PREY_SIZE)
        p.rotation.set(Math.sin(t * 13) * 0.08, Math.PI * 0.94 + jink * 0.45, Math.sin(t * 11) * 0.1)
      } else if (act === 'catch') {
        // Snatched, then shaken. Riding the mouth exactly is what makes the
        // shake read as the tyrannosaur doing it to the animal.
        const grab = easeInOut(Math.min(1, u / 0.32))
        tmp.a.copy(catchAt.current).lerp(tmp.mouth, grab)
        p.position.copy(tmp.a)
        const shrink = u < 0.72 ? 1 : Math.max(0, 1 - (u - 0.72) / 0.28)
        p.scale.setScalar(PREY_SIZE * shrink)
        p.rotation.set(Math.sin(t * 34) * 0.5 * grab, Math.PI * 0.94, Math.sin(t * 29) * 0.4 * grab)
      } else {
        p.scale.setScalar(0)
      }
    }

    /* --- what the tyrannosaur is asked to do -------------------------------- */
    const chaseEnd = tmp.b.copy(catchAt.current)
    chaseEnd.x += 1.55
    chaseEnd.z -= 0.1

    // The stage squares up as the animal arrives and is released at the very end.
    stage.hold =
      act === 'summon' ? easeInOut(u) : act === 'return' ? 1 - easeInOut(MathUtils.clamp((u - 0.4) / 0.6, 0, 1)) : 1

    if (act === 'summon') {
      stage.crouch = 0
      stage.hurry = 0
    } else if (act === 'stalk') {
      // Turns onto it and drops its head. Nothing else moves yet.
      stage.facing = MathUtils.damp(stage.facing, FACE_PREY, 3.2, step)
      stage.crouch = easeInOut(u)
      stage.hurry = u * 0.3
    } else if (act === 'chase') {
      stage.facing = MathUtils.damp(stage.facing, FACE_PREY, 4, step)
      const s = easeInOut(u)
      stage.travelX = chaseEnd.x * s
      stage.travelY = chaseEnd.y * s * 0.35
      stage.travelZ = chaseEnd.z * s
      stage.crouch = 0.85
      stage.lunge = 0.2 + u * 0.15
      stage.hurry = 1
      // Heavy footfalls: two spikes a second, and they land in the arrangement.
      stage.shake = 0.35 * Math.pow(Math.abs(Math.sin(t * 6.2)), 6)
    } else if (act === 'catch') {
      stage.travelX = chaseEnd.x
      stage.travelY = chaseEnd.y * 0.35
      stage.travelZ = chaseEnd.z
      stage.crouch = 0.85 * (1 - u * 0.5)
      stage.lunge = bell(Math.min(1, u / 0.45))
      stage.snap = MathUtils.smoothstep(u, 0.16, 0.3)
      stage.thrash = u > 0.3 && u < 0.85 ? bell((u - 0.3) / 0.55) : 0
      stage.hurry = 1 - u * 0.7
      stage.shake = Math.max(0, 1 - Math.abs(u - 0.26) * 9) * 0.9 + stage.thrash * 0.25
    } else if (act === 'swallow') {
      stage.crouch = 0.4 * (1 - u)
      stage.lunge = 0
      stage.snap = 1 - easeInOut(Math.min(1, u * 2))
      stage.thrash = 0
      stage.toss = bell(u)
      stage.gulp = MathUtils.clamp(u * 1.5, 0, 1)
      stage.hurry = 0.3 * (1 - u)
      stage.shake = 0
    } else if (act === 'drop') {
      stage.toss = 0
      stage.gulp = 0
      stage.crouch = 0
      // Starts turning back to its usual heading before it walks off.
      stage.facing = MathUtils.damp(stage.facing, 0, 2.2, step)
      stage.hurry = u * 0.4
    } else if (act === 'leave') {
      stage.facing = MathUtils.damp(stage.facing, 0, 3, step)
      stage.travelX = MathUtils.lerp(chaseEnd.x, EXIT_X, easeInOut(u))
      stage.travelY = MathUtils.lerp(chaseEnd.y * 0.35, 0, easeInOut(u))
      stage.travelZ = MathUtils.lerp(chaseEnd.z, 0, easeInOut(u))
      stage.hurry = 0.55
    } else if (act === 'return') {
      stage.facing = 0
      stage.travelX = MathUtils.lerp(EXIT_X, 0, easeInOut(u))
      stage.travelY = 0
      stage.travelZ = 0
      stage.hurry = 0.45 * (1 - easeInOut(u))
    } else {
      // Off stage while the tree does its work.
      stage.travelX = EXIT_X
      stage.travelY = 0
      stage.travelZ = 0
      stage.facing = 0
      stage.hurry = 0
      stage.shake = 0
    }

    /* --- the dropping ------------------------------------------------------- */
    const d = dung.current
    if (d) {
      if (act === 'drop') {
        // Placed once, on a flag rather than inside a slice of the act: a window
        // a few hundredths wide is missed outright on a device drawing 3 fps, and
        // the dropping then falls from the origin — which is the middle of the
        // tyrannosaur, so the tree grew out of its back.
        if (stage.vent && !dropped.current) {
          dropped.current = true
          tmp.a.set(-0.03, -0.05, 0).applyMatrix4(stage.vent.matrixWorld)
          g.worldToLocal(tmp.a)
          d.position.copy(tmp.a)
          dropFrom.current = tmp.a.y
          ground.current = groundLevel(g, tmp.b)
          treeAt.current.set(tmp.a.x, ground.current, tmp.a.z)
        }
        const fall = Math.min(1, u / 0.55)
        d.position.y = MathUtils.lerp(dropFrom.current, ground.current, fall * fall)
        const squash = u > 0.55 ? bell((u - 0.55) / 0.45) : 0
        d.scale.set(0.22 * (1 + squash * 0.35), 0.22 * (1 - squash * 0.4), 0.22 * (1 + squash * 0.35))
        d.rotation.y = t * 1.2
      } else if (act === 'leave') {
        d.scale.setScalar(0.22)
      } else if (act === 'grow') {
        // Taken up by the tree.
        d.scale.setScalar(0.22 * (1 - easeInOut(Math.min(1, u / 0.6))))
      } else if (!after('drop')) {
        d.scale.setScalar(0)
      } else {
        d.scale.setScalar(0)
      }
    }

    /* --- the tree ----------------------------------------------------------- */
    const tr = tree.current
    const cp = canopy.current
    if (tr && cp) {
      if (act === 'grow' || act === 'ripen' || act === 'fall' || act === 'crack' || act === 'return') {
        tr.position.copy(treeAt.current)
        const grow = act === 'grow' ? easeInOut(Math.min(1, u / 0.75)) : 1
        // The trunk goes up first and the crown fills in behind it.
        const leaves = act === 'grow' ? easeInOut(MathUtils.clamp((u - 0.35) / 0.55, 0, 1)) : 1
        const wither = act === 'return' ? easeInOut(MathUtils.clamp((u - 0.25) / 0.6, 0, 1)) : 0
        tr.scale.setScalar(TREE_SCALE * grow * (1 - wither))
        cp.scale.setScalar(leaves * (1 + Math.sin(t * 1.3) * 0.02))
        tr.rotation.y = 0.35 + Math.sin(t * 0.6) * 0.03
        tr.rotation.z = Math.sin(t * 0.9) * 0.012
      } else {
        tr.scale.setScalar(0)
      }
    }

    /* --- the fruit ---------------------------------------------------------- */
    const fr = fruit.current
    if (fr) {
      if (act === 'ripen' || act === 'fall' || act === 'crack') {
        tmp.a.copy(FRUIT_BRANCH).multiplyScalar(TREE_SCALE).add(treeAt.current)
        if (act === 'ripen') {
          const swell = easeInOut(Math.min(1, u / 0.6))
          fr.position.copy(tmp.a)
          fr.position.y -= swell * 0.02
          fr.scale.setScalar(FRUIT_SIZE * swell)
          skin.color.lerpColors(UNRIPE, RIPE, easeInOut(MathUtils.clamp((u - 0.25) / 0.7, 0, 1)))
          fruitFrom.current = fr.position.y
          fr.rotation.set(0, t * 0.5, Math.sin(t * 2) * 0.05 * swell)
        } else if (act === 'fall') {
          fr.position.x = tmp.a.x
          fr.position.z = tmp.a.z
          fr.position.y = MathUtils.lerp(fruitFrom.current, ground.current + FRUIT_SIZE * 0.6, u * u)
          fr.scale.setScalar(FRUIT_SIZE)
          fr.rotation.set(u * 3.4, t * 0.5, 0)
        } else {
          // Splits along its seam, and the name comes out of it.
          fr.position.y = ground.current + FRUIT_SIZE * 0.6
          fr.rotation.set(0, 0.2, 0)
          const open = easeInOut(Math.min(1, u / 0.45))
          // The halves linger open: they are the thing the name comes out of.
          const gone = MathUtils.clamp((u - 0.72) / 0.28, 0, 1)
          fr.scale.setScalar(FRUIT_SIZE * (1 - easeInOut(gone)))
          const l = fruitL.current
          const r = fruitR.current
          if (l && r) {
            l.rotation.z = open * 1.5
            r.rotation.z = -open * 1.5
            l.position.set(-open * 0.35, open * 0.5, 0)
            r.position.set(open * 0.35, open * 0.45, 0)
          }
        }
      } else {
        fr.scale.setScalar(0)
      }
    }
  })

  return (
    <group ref={group}>
      {rig ? <PreyBody rig={rig} mascot={mascot} theme={theme} bump={bump} bodyRef={prey} /> : null}
      <Dung groupRef={dung} theme={theme} />
      <Tree groupRef={tree} canopyRef={canopy} theme={theme} />
      <Fruit groupRef={fruit} leftRef={fruitL} rightRef={fruitR} skin={skin} />
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

/** Three stacked lumps. Small, dark, and on screen for a couple of seconds. */
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

/** Trunk, two branches and a crown of leaf clusters that fills in behind it. */
function Tree({
  groupRef,
  canopyRef,
  theme,
}: {
  groupRef: RefObject<Group | null>
  canopyRef: RefObject<Group | null>
  theme: Theme
}) {
  const bark = theme === 'dark' ? '#5d4834' : '#4a3928'
  const leaf = theme === 'dark' ? '#637a45' : '#4f6435'
  return (
    <group ref={groupRef} scale={0.0001}>
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.045, 0.1, 1, 8]} />
        <meshStandardMaterial color={bark} roughness={0.92} metalness={0} />
      </mesh>
      <mesh position={[0.18, 0.92, 0.04]} rotation={[0, 0, -0.75]}>
        <cylinderGeometry args={[0.024, 0.045, 0.44, 6]} />
        <meshStandardMaterial color={bark} roughness={0.92} metalness={0} />
      </mesh>
      <mesh position={[-0.16, 0.86, -0.05]} rotation={[0, 0, 0.8]}>
        <cylinderGeometry args={[0.022, 0.04, 0.36, 6]} />
        <meshStandardMaterial color={bark} roughness={0.92} metalness={0} />
      </mesh>
      <group ref={canopyRef} scale={0.0001}>
        {CANOPY.map(([x, y, z, r], i) => (
          <mesh key={i} position={[x, y, z]} scale={[r, r * 0.82, r]}>
            <icosahedronGeometry args={[1, 1]} />
            <meshStandardMaterial color={leaf} roughness={0.86} metalness={0} flatShading />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/**
 * Two hemispheres sharing one skin, so ripening is a single colour to animate.
 * Double-sided, which is what makes the halves read as a hollow shell once they
 * swing apart rather than as two flat crescents.
 */
function Fruit({
  groupRef,
  leftRef,
  rightRef,
  skin,
}: {
  groupRef: RefObject<Group | null>
  leftRef: RefObject<Group | null>
  rightRef: RefObject<Group | null>
  skin: MeshStandardMaterial
}) {
  return (
    <group ref={groupRef} scale={0.0001}>
      <group ref={leftRef}>
        <mesh material={skin}>
          <sphereGeometry args={[1, 16, 12, 0, Math.PI]} />
        </mesh>
      </group>
      <group ref={rightRef}>
        <mesh material={skin}>
          <sphereGeometry args={[1, 16, 12, Math.PI, Math.PI]} />
        </mesh>
      </group>
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

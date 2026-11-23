import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { Object3D, PerspectiveCamera } from 'three'
import { gpuClass } from '@/hooks/useDeviceTier'
import { walkProgress } from '@/lib/evolution'
import type { ValleyQuality } from '@/lib/valley'
import type { Theme } from '@/theme/context'
import { createPost, type Post } from './evoPost'
import { WALK_QUALITY, createWalk, type Walk } from './evoWalk'

/**
 * The long walk's canvas: one pinned, full-bleed scene that the page's scroll
 * runs from end to end.
 *
 * The scene itself is `evoWalk.ts` and what hangs off it; this file only gives
 * it a renderer, a frame loop and the number it follows. That number is read
 * here, off the DOM, every frame — not passed down through React — so the
 * camera is exactly where the scroll is on the frame it is drawn.
 */

/** The page's colours in each theme: the walk ends inside a screen that is showing the page. */
const PAPER = {
  dark: ['#070708', '#f4f3f0', '#dcc095'],
  light: ['#f7f5f1', '#121211', '#9a6b2a'],
} as const

/**
 * How the scene judges itself: over this many frames, if most were slower
 * than this, it gives up resolution — pixels are most of what it costs. Twice
 * at most, and not in the first moments after it starts or wakes, when the
 * frames that are slow are slow for other reasons.
 */
const JUDGE = { frames: 80, slow: 0.026, share: 0.6, settle: 2.5, steps: 2 }

export interface EvolutionSceneProps {
  quality: ValleyQuality
  theme: Theme
  /** The tall element whose scroll the walk follows. */
  wrapperRef: RefObject<HTMLElement | null>
  /** Whether to draw at all. A parked canvas costs nothing per frame. */
  active: boolean
}

interface StageProps extends Pick<EvolutionSceneProps, 'quality' | 'theme' | 'wrapperRef'> {
  onSlow: () => void
}

/** How long the walk waits for what is in shot before it is shown anyway, in milliseconds. */
const REVEAL_ANYWAY = 4000

function Stage({ quality, theme, wrapperRef, onSlow }: StageProps) {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const dpr = useThree((state) => state.viewport.dpr)
  const walkRef = useRef<Walk | null>(null)
  const postRef = useRef<Post | null>(null)
  const judge = useRef({ seen: 0, slow: 0, awake: 0 })
  /**
   * Whether the programs the walk started with are built, whether the walk is
   * on show yet, and for how many frames in a row what is in shot has been
   * all there.
   */
  const show = useRef({ compiled: false, revealed: false, readyFrames: 0, reveal: () => {} })

  useEffect(() => {
    const post = WALK_QUALITY[quality].glow ? createPost(4) : null
    const walk = createWalk(quality)
    let gone = false
    let pending = 0
    const queue: (() => void)[] = []
    let turn = 0
    const later = (job: () => void): number =>
      typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(job, { timeout: 400 }) : window.setTimeout(job, 60)
    // One small job at a time, when the page has nothing else to do: each
    // draws one set of the walk once into a corner of the frame, which is all
    // the graphics card needs to have it ready.
    const corner = (): void => {
      if (post) {
        post.target.scissorTest = true
        post.target.scissor.set(0, 0, 8, 8)
        gl.setRenderTarget(post.target)
        gl.render(scene, camera)
        gl.setRenderTarget(null)
        post.target.scissorTest = false
      } else {
        gl.setScissorTest(true)
        gl.setScissor(0, 0, 8, 8)
        gl.render(scene, camera)
        gl.setScissorTest(false)
      }
    }
    const next = (): void => {
      turn = 0
      if (gone) return
      queue.shift()?.()
      if (queue.length > 0) turn = later(next)
    }
    // Everything at first; after that, only what has come in since — not
    // everything again each time something does.
    const warm = (only?: Object3D): void => {
      if (gone) return
      queue.push(...walk.warmups(corner, only))
      if (turn === 0) turn = later(next)
    }
    // A program is built for what it is drawn into, and the glow draws the
    // scene into a frame of its own: compiled for the screen it would only be
    // compiled again, on the frame it was first needed.
    const build = (object: Object3D) => {
      gl.setRenderTarget(post?.target ?? null)
      // Once for each way the walk is lit, or the first frame out of the cave
      // would be spent building everything again for a sky with no fire in it.
      const built: Promise<unknown>[] = []
      walk.rehearse((lighting) => {
        built[lighting] = gl.compileAsync(object, camera, scene).catch(() => undefined)
      })
      gl.setRenderTarget(null)
      pending++
      const all = Promise.all(built).then(() => {
        pending--
      })
      return { built, all }
    }
    // Something that has come in: built, then drawn once out of sight, and
    // only then let into shot (its promise is done when it is built).
    const compile = (object: Object3D) => {
      const { all } = build(object)
      return all.then(() => warm(object))
    }
    // None of that where WebGL is drawn by the CPU. There a program is seconds
    // of the whole machine, and building every one of them ahead — for every
    // lighting, and then drawing each set once more — froze the page for most
    // of a minute on a CI runner, for a reader who had only stopped near the
    // walk and not gone into it. Each is built by the first frame that needs
    // it instead: slow, but only for someone looking at the walk.
    const ahead = gpuClass() !== 'software'
    walk.arrivals.arrived = ahead ? compile : undefined
    walkRef.current = walk
    postRef.current = post
    scene.add(walk.root)
    const shown = show.current
    shown.revealed = false
    shown.readyFrames = 0
    // Everything that exists already, while it is all still switched on:
    // from the first frame the walk hides whatever is out of shot. Nothing is
    // drawn until it is built — a frame drawn sooner waits for each program
    // it uses, on the main thread: with a reader already looking, that was
    // the page stopped for a quarter of a second.
    // The first frame waits only for the lighting it is drawn in — the fire,
    // at the start of the walk — and the other two are built behind it.
    shown.compiled = !ahead
    if (ahead) {
      const rect = wrapperRef.current?.getBoundingClientRect()
      const viewport = gl.domElement.clientHeight || window.innerHeight
      walk.frame(gl, camera as PerspectiveCamera, rect ? walkProgress(rect.top, rect.height, viewport) : 0, 0)
      const { built, all } = build(scene)
      void (built[walk.lightingNow()] ?? all).then(() => {
        shown.compiled = true
      })
      void all.then(() => warm())
    }

    // The city's sets, one to an idle moment, each compiled as it comes.
    const jobs = [...walk.later]
    let building = 0
    const buildNext = (): void => {
      building = 0
      if (gone) return
      const object = jobs.shift()?.()
      if (object && ahead) void compile(object)
      if (jobs.length > 0) building = later(buildNext)
    }
    building = later(buildNext)

    // Not shown until what is in shot is all there: the walk comes up whole,
    // out of the dark of the stage, rather than as a cave its people walk
    // into a moment later. With nobody looking, that is once it is in, built,
    // and drawn once out of sight by the warm-up; with somebody already
    // looking, the frame loop decides (below). And shown after a few seconds
    // whatever is in, for a machine that is slow to mesh is still better
    // looked at than not.
    const host = gl.domElement.closest<HTMLElement>('.evolution-scene')
    shown.reveal = () => {
      if (shown.revealed) return
      shown.revealed = true
      if (host) host.dataset.ready = ''
    }
    const since = performance.now()
    let watching = 0
    const watch = (): void => {
      watching = 0
      if (gone || shown.revealed) return
      const wrapper = wrapperRef.current
      const rect = wrapper?.getBoundingClientRect()
      const viewport = gl.domElement.clientHeight || window.innerHeight
      const p = rect ? walkProgress(rect.top, rect.height, viewport) : 0
      const warmed = shown.compiled && pending === 0 && queue.length === 0 && turn === 0
      if ((warmed && walk.readyAt(p)) || performance.now() - since > REVEAL_ANYWAY) shown.reveal()
      else watching = window.setTimeout(watch, 100)
    }
    watch()
    return () => {
      gone = true
      window.clearTimeout(watching)
      if (building) {
        if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(building)
        window.clearTimeout(building)
      }
      if (host) delete host.dataset.ready
      walk.arrivals.arrived = undefined
      scene.remove(walk.root)
      walk.dispose()
      post?.dispose()
      walkRef.current = null
      postRef.current = null
    }
  }, [gl, scene, camera, quality, wrapperRef])

  useEffect(() => {
    postRef.current?.resize(size.width * dpr, size.height * dpr)
  }, [size.width, size.height, dpr, quality])

  useEffect(() => {
    const [paper, ink, accent] = PAPER[theme]
    walkRef.current?.setPaper(paper, ink, accent)
  }, [theme, quality, scene])

  // At this priority the canvas no longer draws by itself: this is the one
  // place a frame is drawn, after the walk has moved everything in it.
  useFrame((state, delta) => {
    const walk = walkRef.current
    const wrapper = wrapperRef.current
    const shown = show.current
    if (!walk || !wrapper || !shown.compiled) return
    const rect = wrapper.getBoundingClientRect()
    // The stage is as tall as the canvas, which is what the wrapper travels past.
    const viewport = state.gl.domElement.clientHeight || window.innerHeight
    walk.frame(state.gl, state.camera as PerspectiveCamera, walkProgress(rect.top, rect.height, viewport), delta)
    const post = postRef.current
    if (post) post.render(state.gl, state.scene, state.camera, 1)
    else state.gl.render(state.scene, state.camera)

    // Drawn out of sight until what is in shot has been drawn whole a few
    // frames running: the driver makes each program ready on the first frame
    // it is drawn in, and that frame is better spent where nobody sees it.
    // Nor is the scene judged slow on frames nobody saw.
    const j = judge.current
    if (!shown.revealed) {
      shown.readyFrames = walk.readyAt(walk.beat.p) ? shown.readyFrames + 1 : 0
      if (shown.readyFrames >= 3) shown.reveal()
      j.awake = 0
      return
    }

    // A frame after a gap is the canvas waking, not the scene being slow.
    if (delta > 0.2) {
      j.seen = 0
      j.slow = 0
      j.awake = 0
      return
    }
    j.awake += delta
    if (j.awake < JUDGE.settle) return
    j.seen++
    if (delta > JUDGE.slow) j.slow++
    if (j.seen >= JUDGE.frames) {
      if (j.slow > JUDGE.frames * JUDGE.share) onSlow()
      j.seen = 0
      j.slow = 0
    }
  }, 1)
  return null
}

export default function EvolutionScene({ quality, theme, wrapperRef, active }: EvolutionSceneProps) {
  const q = WALK_QUALITY[quality]
  // The resolution the scene settled on, as the canvas's own prop: R3F puts
  // the prop back on every render, so a step down made from inside the scene
  // would last until the next one.
  const [steps, setSteps] = useState(0)
  const onSlow = useCallback(() => setSteps((n) => Math.min(JUDGE.steps, n + 1)), [])
  const scale = 0.8 ** steps
  const dpr = typeof q.dpr === 'number' ? q.dpr * scale : ([q.dpr[0] * scale, q.dpr[1] * scale] as [number, number])
  return (
    <Canvas
      dpr={dpr}
      shadows={q.shadowMap ? 'percentage' : false}
      // The frameloop is a prop and nothing else, the way the hero's is: set
      // from inside the scene it does not survive the canvas's next render.
      frameloop={active ? 'always' : 'never'}
      camera={{ position: [-23, 1, -2], fov: 42, near: 0.3, far: 4200 }}
      gl={{ antialias: !q.glow, alpha: false, powerPreference: 'high-performance', stencil: false }}
      data-quality={steps ? `${quality}:dpr${steps}` : quality}
      // Full-bleed and pinned: R3F's own wrapper would otherwise take the
      // pointer for the whole of the walk.
      style={{ pointerEvents: 'none' }}
    >
      <Stage quality={quality} theme={theme} wrapperRef={wrapperRef} onSlow={onSlow} />
    </Canvas>
  )
}

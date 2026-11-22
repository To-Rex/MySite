import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { Object3D, PerspectiveCamera } from 'three'
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

function Stage({ quality, theme, wrapperRef, onSlow }: StageProps) {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const dpr = useThree((state) => state.viewport.dpr)
  const walkRef = useRef<Walk | null>(null)
  const postRef = useRef<Post | null>(null)
  const judge = useRef({ seen: 0, slow: 0, awake: 0 })

  useEffect(() => {
    const post = WALK_QUALITY[quality].glow ? createPost(4) : null
    const walk = createWalk(quality)
    // A program is built for what it is drawn into, and the glow draws the
    // scene into a frame of its own: compiled for the screen it would only be
    // compiled again, on the frame it was first needed.
    const compile = (object: Object3D) => {
      gl.setRenderTarget(post?.target ?? null)
      void gl.compileAsync(object, camera, scene).catch(() => undefined)
      gl.setRenderTarget(null)
    }
    walk.arrivals.arrived = compile
    walkRef.current = walk
    postRef.current = post
    scene.add(walk.root)
    // Everything that exists already, while it is all still switched on:
    // from the first frame the walk hides whatever is out of shot.
    compile(scene)
    return () => {
      walk.arrivals.arrived = undefined
      scene.remove(walk.root)
      walk.dispose()
      post?.dispose()
      walkRef.current = null
      postRef.current = null
    }
  }, [gl, scene, camera, quality])

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
    if (!walk || !wrapper) return
    const rect = wrapper.getBoundingClientRect()
    // The stage is as tall as the canvas, which is what the wrapper travels past.
    const viewport = state.gl.domElement.clientHeight || window.innerHeight
    walk.frame(state.gl, state.camera as PerspectiveCamera, walkProgress(rect.top, rect.height, viewport), delta)
    const post = postRef.current
    if (post) post.render(state.gl, state.scene, state.camera, 1)
    else state.gl.render(state.scene, state.camera)

    // A frame after a gap is the canvas waking, not the scene being slow.
    const j = judge.current
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

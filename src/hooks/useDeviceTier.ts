import { useMemo } from 'react'
import { useIsTouch } from './useMediaQuery'

export type DeviceTier = 'high' | 'medium' | 'low'

interface NavigatorExtras extends Navigator {
  deviceMemory?: number
  connection?: { saveData?: boolean; effectiveType?: string }
}

let webglSupport: boolean | null = null
/** What the card called itself, read off the same context that answered the question above. */
let rendererName = ''

export function supportsWebGL(): boolean {
  if (webglSupport !== null) return webglSupport
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    webglSupport = !!gl
    // One context for both questions: making a second is not free, least of
    // all on the software renderers this is partly here to catch.
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    if (gl && info) rendererName = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
  } catch {
    webglSupport = false
  }
  return webglSupport
}

/**
 * A coarse capability estimate used to scale 3D quality. Conservative on purpose:
 * it is cheaper to render slightly less than to drop frames.
 */
export function estimateDeviceTier(isTouch: boolean): DeviceTier {
  if (typeof navigator === 'undefined') return 'medium'
  const nav = navigator as NavigatorExtras
  const cores = nav.hardwareConcurrency ?? 4
  const memory = nav.deviceMemory ?? 4
  if (nav.connection?.saveData) return 'low'
  if (!supportsWebGL()) return 'low'
  if (cores <= 2 || memory <= 2) return 'low'
  if (isTouch) return cores >= 8 && memory >= 6 ? 'medium' : 'low'
  if (cores >= 8 && memory >= 8) return 'high'
  return 'medium'
}

export function useDeviceTier(): DeviceTier {
  const isTouch = useIsTouch()
  return useMemo(() => estimateDeviceTier(isTouch), [isTouch])
}

/** 3D quality knobs derived from the device tier. */
export function qualityFor(tier: DeviceTier) {
  switch (tier) {
    case 'high':
      return { dpr: [1, 2] as [number, number], detail: 5, particles: 140, lines: true, env: 256 }
    case 'medium':
      return { dpr: [1, 1.5] as [number, number], detail: 4, particles: 70, lines: true, env: 128 }
    default:
      return { dpr: [1, 1] as [number, number], detail: 3, particles: 0, lines: false, env: 64 }
  }
}

/**
 * What the graphics card is, as far as the browser will say. The tier above is
 * a guess from the CPU and says nothing about the GPU; this reads the renderer
 * string, which Chrome and Edge give in full, and which is the difference
 * between an Apple M-series or a discrete card and the integrated graphics most
 * laptops have. Safari and Firefox mostly decline to say, and get `unknown`.
 */
export type GpuClass = 'strong' | 'modest' | 'unknown'

let gpuCache: GpuClass | null = null

const STRONG = /Apple M\d|RTX|GTX ?(9[6-9]0|1[0-9]{3}|16\d0)|Radeon (RX|Pro) ?([5-7]\d{3}|[5-9]\d{2}[XM]?)|Radeon RX|Arc(\(TM\))? A\d/i
const MODEST = /Intel|UHD|Iris|Mali|Adreno|PowerVR|SwiftShader|llvmpipe|Software|Basic Render|Apple GPU|Vega \d\b|Radeon\(TM\) Graphics/i

/** A renderer string, sorted. Strong is tested first: Intel's Arc cards say "Intel". */
export function classifyRenderer(renderer: string): GpuClass {
  if (STRONG.test(renderer)) return 'strong'
  if (MODEST.test(renderer)) return 'modest'
  return 'unknown'
}

export function gpuClass(): GpuClass {
  gpuCache ??= supportsWebGL() ? classifyRenderer(rendererName) : 'unknown'
  return gpuCache
}


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
/** Whether the card decodes ASTC textures, which only Apple's own graphics do on an Apple device. */
let astc = false

export function supportsWebGL(): boolean {
  if (webglSupport !== null) return webglSupport
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    webglSupport = !!gl
    // One context for all the questions: making a second is not free, least of
    // all on the software renderers this is partly here to catch.
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    if (gl && info) rendererName = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
    astc = !!gl?.getExtension('WEBGL_compressed_texture_astc')
  } catch {
    webglSupport = false
  }
  return webglSupport
}

/**
 * Apple's own graphics, and on what: an iPhone or iPad (`mobile`) or a Mac.
 *
 * Safari will not name the card — every Apple device says "Apple GPU" — nor
 * give the memory, so every iPhone came out on the lowest tier: no grass, half
 * a coat on a mammoth, no relief on the tyrannosaur's skin, all of it drawn at
 * a third of the screen's resolution. What gives Apple's own graphics away is
 * ASTC: they decode it, and the Intel and AMD cards of older Macs do not. An
 * iPad says it is a Mac unless asked how many fingers it takes.
 */
export type ApplePlatform = 'mobile' | 'mac' | null

export function appleGraphics(renderer: string, astcTextures: boolean, userAgent: string, touchPoints: number): ApplePlatform {
  if (!astcTextures || !/\bApple\b/.test(renderer)) return null
  // Every browser on an iPad is WebKit, which says 605; Chrome on a Mac pretending to be a phone says 537.
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1 && /AppleWebKit\/605/.test(userAgent))) return 'mobile'
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'mac'
  return null
}

/**
 * The major version of iOS a browser runs on, 0 where it is not iOS. Safari
 * froze the system's version in its user agent at 18 and puts its own (which is
 * the system's) after `Version/`; the other iOS browsers give only the system's.
 */
export function iosVersion(userAgent: string): number {
  const system = /OS (\d+)[_.]\d+(?:[_.]\d+)? like Mac OS X/.exec(userAgent)
  const safari = /Version\/(\d+)/.exec(userAgent)
  return Math.max(system ? Number(system[1]) : 0, safari ? Number(safari[1]) : 0)
}

/** The oldest iOS whose devices all have at least an A12: the iPhone XS and XR, and every iPad since 2018. */
const IOS_WITH_A12 = 17

export interface DeviceFacts {
  touch: boolean
  cores?: number
  memory?: number
  saveData?: boolean
  webgl: boolean
  apple: ApplePlatform
  ios: number
}

/**
 * A coarse capability estimate used to scale 3D quality. Conservative on purpose:
 * it is cheaper to render slightly less than to drop frames.
 */
export function tierFor(facts: DeviceFacts): DeviceTier {
  if (facts.saveData || !facts.webgl) return 'low'
  // An iPhone or iPad tells neither its memory nor what it is. One new enough
  // for iOS 17 has an A12 or later, whose graphics carry the middle tier with
  // room to spare, and the scenes judge their own frames and give up
  // resolution if they must; older ones keep the lowest.
  if (facts.apple === 'mobile') return facts.ios >= IOS_WITH_A12 ? 'medium' : 'low'
  const cores = facts.cores ?? 4
  // Every Mac with Apple's own graphics has 8 GB or more; Safari just never says.
  const memory = facts.memory ?? (facts.apple === 'mac' ? 8 : 4)
  if (cores <= 2 || memory <= 2) return 'low'
  if (facts.touch) return cores >= 8 && memory >= 6 ? 'medium' : 'low'
  if (cores >= 8 && memory >= 8) return 'high'
  return 'medium'
}

/** Apple's own graphics in this browser, if they are (see `appleGraphics`). */
export function appleGpu(): ApplePlatform {
  if (typeof navigator === 'undefined' || !supportsWebGL()) return null
  return appleGraphics(rendererName, astc, navigator.userAgent, navigator.maxTouchPoints ?? 0)
}

export function estimateDeviceTier(isTouch: boolean): DeviceTier {
  if (typeof navigator === 'undefined') return 'medium'
  const nav = navigator as NavigatorExtras
  const webgl = supportsWebGL()
  return tierFor({
    touch: isTouch,
    cores: nav.hardwareConcurrency,
    memory: nav.deviceMemory,
    saveData: nav.connection?.saveData,
    webgl,
    apple: webgl ? appleGpu() : null,
    ios: iosVersion(nav.userAgent),
  })
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
 *
 * `software` is no card at all: WebGL drawn by the CPU, which is what a
 * blocklisted driver, a virtual machine or a CI runner gets. The valley ran at
 * under one frame a second there, at the quality the CPU had earned it.
 */
export type GpuClass = 'strong' | 'modest' | 'software' | 'unknown'

let gpuCache: GpuClass | null = null

const STRONG = /Apple M\d|RTX|GTX ?(9[6-9]0|1[0-9]{3}|16\d0)|Radeon (RX|Pro) ?([5-7]\d{3}|[5-9]\d{2}[XM]?)|Radeon RX|Arc(\(TM\))? A\d/i
const SOFTWARE = /SwiftShader|llvmpipe|softpipe|Software|Basic Render|Mesa OffScreen/i
const MODEST = /Intel|UHD|Iris|Mali|Adreno|PowerVR|Apple GPU|Vega \d\b|Radeon\(TM\) Graphics/i

/**
 * A renderer string, sorted. Strong before modest: Intel's Arc cards say
 * "Intel". A Mac with Apple's own graphics is strong whatever its browser calls
 * the card: an M-series in Safari is the same M-series it is in Chrome.
 */
export function classifyRenderer(renderer: string, apple: ApplePlatform = null): GpuClass {
  if (SOFTWARE.test(renderer)) return 'software'
  if (STRONG.test(renderer) || apple === 'mac') return 'strong'
  if (MODEST.test(renderer)) return 'modest'
  return 'unknown'
}

export function gpuClass(): GpuClass {
  gpuCache ??= supportsWebGL() ? classifyRenderer(rendererName, appleGpu()) : 'unknown'
  return gpuCache
}


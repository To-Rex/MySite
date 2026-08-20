import { useMemo } from 'react'
import { useIsTouch } from './useMediaQuery'

export type DeviceTier = 'high' | 'medium' | 'low'

interface NavigatorExtras extends Navigator {
  deviceMemory?: number
  connection?: { saveData?: boolean; effectiveType?: string }
}

let webglSupport: boolean | null = null

export function supportsWebGL(): boolean {
  if (webglSupport !== null) return webglSupport
  try {
    const canvas = document.createElement('canvas')
    webglSupport = !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
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

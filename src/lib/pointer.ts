/**
 * A single shared pointer tracker. The cursor, the hero sculpture and the
 * technology universe all read from here instead of each attaching listeners.
 * Values are mutable and read inside animation frames — no React re-renders.
 */
export interface PointerState {
  /** Pixels from the viewport's top-left. */
  x: number
  y: number
  /** Normalized −1..1 (center = 0), y grows upwards (3D convention). */
  nx: number
  ny: number
  /** True once the pointer has moved at least once. */
  active: boolean
  /** True while the pointer is inside the window. */
  inside: boolean
  /** Coarse pointer (touch) events are ignored to keep 3D calm on mobile. */
  isTouch: boolean
}

export const pointer: PointerState = {
  x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0,
  y: typeof window !== 'undefined' ? window.innerHeight / 2 : 0,
  nx: 0,
  ny: 0,
  active: false,
  inside: true,
  isTouch: false,
}

let installed = false

export function installPointerTracking(): () => void {
  if (installed || typeof window === 'undefined') return () => {}
  installed = true

  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      pointer.isTouch = true
      return
    }
    pointer.x = e.clientX
    pointer.y = e.clientY
    pointer.nx = (e.clientX / window.innerWidth) * 2 - 1
    pointer.ny = -((e.clientY / window.innerHeight) * 2 - 1)
    pointer.active = true
    pointer.inside = true
  }
  const onLeave = () => {
    pointer.inside = false
  }
  const onEnter = () => {
    pointer.inside = true
  }

  window.addEventListener('pointermove', onMove, { passive: true })
  document.documentElement.addEventListener('mouseleave', onLeave)
  document.documentElement.addEventListener('mouseenter', onEnter)

  return () => {
    installed = false
    window.removeEventListener('pointermove', onMove)
    document.documentElement.removeEventListener('mouseleave', onLeave)
    document.documentElement.removeEventListener('mouseenter', onEnter)
  }
}

import { useSyncExternalStore } from 'react'
// Type-only, and deliberately so: the headline imports this store, the headline
// is not lazily loaded, and a runtime import would drag six animals' worth of
// anatomy into the entry bundle for a feature most visitors never trigger.
import type { MascotKind } from '@/components/three/mascots'

/**
 * The hero's easter egg, shared between the headline and the 3D scene.
 *
 * Double-clicking the name summons one of the language mascots where the words
 * were, the tyrannosaur hunts it down, and what is left of it grows back into
 * the name. The 3D scene owns the timeline — it is the only thing here with a
 * frame clock — and publishes each act through this store; the headline just
 * watches which act is running and shows or hides itself.
 *
 * Kept as a module store rather than context because the scene writes to it from
 * inside an animation frame, where a React state update per frame would be
 * absurd. Only act changes notify, so the headline re-renders six times a run.
 */

export type SpectacleAct =
  | 'idle'
  /** The words fall away and the animal materialises in their place. */
  | 'summon'
  /** It wanders, oblivious, towards the only other thing on stage. */
  | 'panic'
  /** The lunge and the snap. */
  | 'bite'
  /** A head-toss and a lump travelling down the throat. */
  | 'swallow'
  /** What comes out the other end, and lands. */
  | 'drop'
  /** A shoot rises from it, and the name grows back. */
  | 'sprout'

export interface SpectacleState {
  act: SpectacleAct
  mascot: MascotKind | null
  /** Incremented per performance, so a repeat run remounts the animal cleanly. */
  run: number
}

let state: SpectacleState = { act: 'idle', mascot: null, run: 0 }
const listeners = new Set<() => void>()

const emit = () => {
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Read inside animation frames; identity changes only when an act changes. */
export const getSpectacle = () => state

/** Subscribes the headline to act changes. */
export function useSpectacle(): SpectacleState {
  return useSyncExternalStore(subscribe, getSpectacle, getSpectacle)
}

/**
 * Begins a performance, unless one is already running. Which animal turns up is
 * decided by the scene, which is the side that knows what animals exist.
 */
export function startSpectacle(): boolean {
  if (state.act !== 'idle') return false
  state = { act: 'summon', mascot: null, run: state.run + 1 }
  emit()
  return true
}

/** Casts the performance, once the scene has drawn a name out of the hat. */
export function setSpectacleMascot(mascot: MascotKind): void {
  if (state.mascot === mascot) return
  state = { ...state, mascot }
  emit()
}

/** Called by the scene as the timeline advances. */
export function setSpectacleAct(act: SpectacleAct): void {
  if (state.act === act) return
  state = act === 'idle' ? { ...state, act, mascot: state.mascot } : { ...state, act }
  emit()
}

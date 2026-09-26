import { useSyncExternalStore } from 'react'

/**
 * The extinction cinematic, shared between the nav, the headline and the scene.
 *
 * Clicking the name in the nav opens a valley where the headline was: a herd
 * grazing under a late sun, an asteroid coming down through it, and the dark
 * afterwards — then everything back exactly as it was.
 *
 * Same shape as the hero's easter-egg store, and for the same reason: the scene
 * owns the timeline because it is the only thing with a frame clock, and only
 * act changes notify, so the rest of the page re-renders a handful of times per
 * showing rather than sixty times a second.
 */

export type ValleyAct =
  | 'idle'
  /** The page gives way to a valley. */
  | 'open'
  /** It is alive: a herd, and flyers over the ridge. */
  | 'graze'
  /** Something bright, coming down. */
  | 'streak'
  /** It lands. */
  | 'impact'
  /** Nothing survives it. */
  | 'die'
  /** Ash, and then no light at all. */
  | 'dark'
  /** Morning, and the name growing back. */
  | 'return'

export interface ValleyState {
  act: ValleyAct
  /** Incremented per showing, so a repeat remounts the scene cleanly. */
  run: number
}

let state: ValleyState = { act: 'idle', run: 0 }
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

export const getValley = () => state

export function useValley(): ValleyState {
  return useSyncExternalStore(subscribe, getValley, getValley)
}

/** Begins a showing, unless one is already running. */
export function startValley(): boolean {
  if (state.act !== 'idle') return false
  state = { act: 'open', run: state.run + 1 }
  emit()
  return true
}

/** Called by the scene as the timeline advances. */
export function setValleyAct(act: ValleyAct): void {
  if (state.act === act) return
  state = { ...state, act }
  emit()
}

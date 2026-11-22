import { useSyncExternalStore } from 'react'

/**
 * The extinction cinematic, shared between the nav, the headline and the scene.
 *
 * Clicking the name in the nav opens a valley where the headline was: a herd
 * grazing under a late sun, an asteroid coming down through it, the crater it
 * leaves and the valley burning to ash — then everything back exactly as it was.
 *
 * Same shape as the hero's easter-egg store, and for the same reason: the scene
 * owns the timeline because it is the only thing with a frame clock, and only
 * act changes notify, so the rest of the page re-renders a handful of times per
 * showing rather than sixty times a second.
 */

export type ValleyAct =
  | 'idle'
  /**
   * Mounted and compiling. The page is untouched and the hero keeps moving
   * while the valley's shaders build off the main thread; nothing is shown
   * until the first frame is ready to draw.
   */
  | 'load'
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
  /** Smoke over the valley as it burns, and only the fire to see by. */
  | 'dark'
  /** Morning over the ash and the crater, and the name growing back. */
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
  state = { act: 'load', run: state.run + 1 }
  emit()
  return true
}

/** Called by the scene as the timeline advances. */
export function setValleyAct(act: ValleyAct): void {
  if (state.act === act) return
  state = { ...state, act }
  emit()
}

/**
 * How much the cinematic does, from the device tier and the graphics card.
 * `ultra` is for a desktop with a card that can take it: twice the resolution,
 * soft shadows at 4096, glow, and two or three times the fire, smoke and sparks.
 * The scene still measures itself during the opening and steps down if it has
 * guessed wrong, so a generous guess costs a second of mist, not the show.
 */
export type ValleyQuality = 'low' | 'medium' | 'high' | 'ultra'

export function valleyQuality(tier: 'high' | 'medium' | 'low', gpu: 'strong' | 'modest' | 'software' | 'unknown', touch: boolean): ValleyQuality {
  if (tier === 'low' || gpu === 'software') return 'low'
  if (gpu === 'strong' && !touch) return tier === 'high' ? 'ultra' : 'high'
  return tier
}


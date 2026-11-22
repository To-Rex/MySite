import { useSyncExternalStore } from 'react'
import { clamp01, smoothstep } from './scroll'

/**
 * The long walk: the stretch of the page, straight after the hero, that is one
 * pinned 3D scene driven by the scroll — people leaving a cave, a hunt, the
 * land settled, a city, and somebody at a screen.
 *
 * This is the part of it that needs neither three.js nor the scene: which era
 * a given point of the walk belongs to, how far through the walk the page is,
 * and the handful of facts the rest of the page has to know (is the stage on
 * screen, is it worth building yet). The gate (`sections/Evolution.tsx`) writes
 * here from one scroll listener; the scene reads the scroll for itself, every
 * frame, and never goes through React for it.
 */

export const ERAS = ['fire', 'hunt', 'field', 'city', 'now'] as const
export type Era = (typeof ERAS)[number]

/** Where each era begins, as a share of the walk. The last one runs to the end. */
export const ERA_FROM: Record<Era, number> = { fire: 0, hunt: 0.2, field: 0.47, city: 0.645, now: 0.905 }

/** The era a point of the walk belongs to. */
export function eraAt(progress: number): Era {
  let era: Era = 'fire'
  for (const name of ERAS) if (progress >= ERA_FROM[name]) era = name
  return era
}

/** Where an era ends: where the next begins, or the end of the walk. */
export function eraUntil(era: Era): number {
  const next = ERAS[ERAS.indexOf(era) + 1]
  return next ? ERA_FROM[next] : 1
}

/**
 * How visible an era's caption is at a point of the walk, 0 to 1.
 *
 * Each fades in just after its era starts and out before the next, so two are
 * never on screen together and the hand-over itself — the mouth of the cave,
 * the years going by — is left to the picture. The last one stays up until the
 * scene is nearly gone.
 */
export function captionAt(era: Era, progress: number): number {
  const from = ERA_FROM[era]
  const until = eraUntil(era)
  const span = until - from
  const rise = smoothstep(from + span * 0.1, from + span * 0.26, progress)
  const fall = era === 'now' ? 1 - smoothstep(0.972, 0.992, progress) : 1 - smoothstep(until - span * 0.3, until - span * 0.12, progress)
  return clamp01(Math.min(rise, fall))
}

/**
 * How far through the walk the page is: 0 with the stage just pinned, 1 as it
 * lets go. `top` and `height` are the tall wrapper's, `viewport` the window's.
 */
export function walkProgress(top: number, height: number, viewport: number): number {
  const travel = height - viewport
  return travel > 0 ? clamp01(-top / travel) : 0
}

/** The page offset that puts the walk at `progress`, for a wrapper that starts at `wrapperTop`. */
export function walkScrollFor(progress: number, wrapperTop: number, height: number, viewport: number): number {
  return wrapperTop + clamp01(progress) * Math.max(0, height - viewport)
}

/**
 * How many screens of scrolling the walk takes. A phone gets a shorter one: a
 * thumb covers less ground per gesture than a wheel does, and the same number
 * of screens there is a great deal of swiping.
 */
export function walkScreens(narrow: boolean): number {
  return narrow ? 7.5 : 9
}

// ------------------------------------------------------------------- store

export interface EvolutionState {
  /** Close enough that the scene should exist. Once true it stays true. */
  near: boolean
  /** Any part of the stage is on screen: the scene draws, the companion steps aside. */
  onScreen: boolean
  /** The stage is pinned and covers the window. */
  pinned: boolean
  era: Era
}

let state: EvolutionState = { near: false, onScreen: false, pinned: false, era: 'fire' }
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const getEvolution = () => state

export function useEvolution(): EvolutionState {
  return useSyncExternalStore(subscribe, getEvolution, getEvolution)
}

/** Called by the gate as the page scrolls. Notifies only when something a component reads has changed. */
export function setEvolution(next: Partial<EvolutionState>): void {
  const merged = { ...state, ...next, near: state.near || next.near === true }
  if (merged.near === state.near && merged.onScreen === state.onScreen && merged.pinned === state.pinned && merged.era === state.era) return
  state = merged
  for (const listener of listeners) listener()
}

/** For tests: back to a page that has not been scrolled. */
export function resetEvolution(): void {
  state = { near: false, onScreen: false, pinned: false, era: 'fire' }
  for (const listener of listeners) listener()
}

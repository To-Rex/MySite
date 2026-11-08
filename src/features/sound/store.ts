import { useSyncExternalStore } from 'react'
import { storage } from '@/lib/storage'
import type { Cue, SoundEngine } from './engine'

/**
 * Whether the 404 page is making noise, and the way in for everything that wants
 * it to. Small and free of the engine, which arrives in its own chunk: the scene
 * can call `cue` from a frame callback whether or not any of it has loaded.
 *
 * Browsers will not start audio before the visitor has done something, so sound
 * starts `locked` and the first click anywhere on the page opens it. The
 * AudioContext is created here, synchronously, because it has to be made inside
 * that click, and a dynamic import would come back too late to count.
 */

export type SoundStatus = 'unavailable' | 'locked' | 'on' | 'off'

const KEY = 'dh.sound'

/** How long after the page opens the voices start rendering, unless a click needs them sooner. */
const WARM_AFTER = 1500

type AudioContextClass = typeof AudioContext

let status: SoundStatus = 'unavailable'
let context: AudioContext | null = null
let engine: SoundEngine | null = null
let loading: Promise<SoundEngine> | null = null

const listeners = new Set<() => void>()

function setStatus(next: SoundStatus): void {
  if (status === next) return
  status = next
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getStatus = () => status

export function useSoundStatus(): SoundStatus {
  return useSyncExternalStore(subscribe, getStatus, getStatus)
}

function contextClass(): AudioContextClass | undefined {
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext
}

/** The engine, loading it the first time. Starts the voices rendering. */
function loadEngine(): Promise<SoundEngine> {
  loading ??= import('./engine').then(({ createEngine }) => {
    engine = createEngine()
    return engine
  })
  return loading
}

const onVisibility = () => {
  if (!context || status !== 'on') return
  // The scene stops when the tab is hidden; a volcano carrying on by itself would be odd.
  void (document.hidden ? context.suspend() : context.resume())
}

/**
 * Says the page is able to make sound, and warms up. The voices are rendered
 * ahead of the first click, so that it can be answered at once.
 */
export function offerSound(): void {
  if (status !== 'unavailable' || !contextClass()) return
  setStatus(storage.get(KEY) === 'off' ? 'off' : 'locked')
  document.addEventListener('visibilitychange', onVisibility)
  // The scene gets the first moments of the page to itself.
  window.setTimeout(() => void loadEngine(), WARM_AFTER)
}

/** Resumes the context from inside a gesture, the only place it is allowed to happen. */
function wake(active: AudioContext): void {
  void active.resume()
  // Older iOS only counts the context as unlocked once something has been played on it.
  const silence = active.createBufferSource()
  silence.buffer = active.createBuffer(1, 1, 22050)
  silence.connect(active.destination)
  silence.start()
}

function open(): void {
  const Class = contextClass()
  if (!Class) return
  context ??= new Class({ latencyHint: 'interactive' })
  wake(context)
  setStatus('on')
  const opened = context
  void loadEngine().then((loaded) => {
    loaded.attach(opened)
    loaded.muted(false)
  })
}

/** For the first click anywhere: starts the sound unless the visitor has turned it off. */
export function unlockSound(): void {
  if (status === 'locked') open()
  // A browser may refuse the first attempt, so every later click gets to try again.
  else if (status === 'on' && context?.state === 'suspended' && !document.hidden) wake(context)
}

/** The button. Remembers an "off" for next time. */
export function toggleSound(): void {
  if (status === 'unavailable') return
  if (status === 'on') {
    storage.set(KEY, 'off')
    engine?.muted(true)
    setStatus('off')
    // Nothing is making sound, so nothing need be running; the fade finishes first.
    const opened = context
    window.setTimeout(() => {
      if (status === 'off') void opened?.suspend()
    }, 400)
    return
  }
  storage.remove(KEY)
  open()
}

export function cue(next: Cue): void {
  if (status === 'on') engine?.cue(next)
}

export function grindSound(level: number, pan: number): void {
  if (status === 'on') engine?.grind(level, pan)
}

/** Back to how a fresh page starts. Only tests have a use for this. */
export function resetSoundForTests(): void {
  status = 'unavailable'
  context = null
  engine = null
  loading = null
  listeners.clear()
}

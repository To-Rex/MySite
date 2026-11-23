import { useEffect, useState } from 'react'
import { BufferAttribute, BufferGeometry } from 'three'
import { gpuClass } from '@/hooks/useDeviceTier'
import type { CreatureDetail, CreaturePayload } from './creatures'
import { createAnything, type AnyCreatureKind, type AnyKind } from './mascots'
import type { CreatureRequest, CreatureResponse } from './creatures.worker'

/**
 * Builds creature meshes in workers and caches the results.
 *
 * Generation is a few hundred milliseconds of arithmetic, so it must not run on
 * the main thread; the hero simply renders nothing until its geometry arrives,
 * which lands well inside the preloader's own runtime. There are a few workers
 * and one queue, in order of how soon each mesh is wanted. If workers are
 * unavailable the same code runs synchronously rather than failing.
 */

export interface CreatureGeometry {
  geometry: BufferGeometry
  bones: CreaturePayload['bones']
  eyeBone: string
  eyes: CreaturePayload['eyes']
  teeth: CreaturePayload['teeth']
  /** The longest axis in metres, for the figures that are built to a real size. */
  size?: number
  /** The fur and hair of a figure, for the scene to make cards of (`evoCoat.ts`). */
  coat?: CreaturePayload['coat']
  sweeps?: CreaturePayload['sweeps']
}

const cache = new Map<string, CreatureGeometry>()
const pending = new Map<string, Promise<CreatureGeometry>>()

function toGeometry(payload: CreaturePayload): CreatureGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(payload.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(payload.normals, 3))
  geometry.setAttribute('aoValue', new BufferAttribute(payload.ao, 1))
  geometry.setAttribute('skinIndex', new BufferAttribute(payload.skinIndices, 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(payload.skinWeights, 4))
  if (payload.regions) geometry.setAttribute('regions', new BufferAttribute(payload.regions, 4))
  if (payload.regions2) geometry.setAttribute('regions2', new BufferAttribute(payload.regions2, 4))
  if (payload.paint) geometry.setAttribute('paint', new BufferAttribute(payload.paint, 4))
  geometry.setIndex(new BufferAttribute(payload.indices, 1))
  geometry.computeBoundingSphere()
  return { geometry, bones: payload.bones, eyeBone: payload.eyeBone, eyes: payload.eyes, teeth: payload.teeth, size: payload.size, coat: payload.coat, sweeps: payload.sweeps }
}

/** Longest a mesh may take once a worker has started on it, before the main thread takes it on. */
const PATIENCE = 4000

/**
 * How soon a mesh is wanted, lowest first. What the page shows first goes
 * first: the hero's own creatures, then the start of the long walk, then the
 * rest of it, and last whatever is being built for a showing nobody has asked
 * for yet.
 */
export const PRIORITY = { now: 0, soon: 1, later: 2, someday: 3 } as const
export type Priority = (typeof PRIORITY)[keyof typeof PRIORITY]

export interface RequestOptions {
  /**
   * How long a worker is given once it has started on this one. Time spent
   * waiting in the queue does not count: a mesh that is late only because
   * others went first is not stuck, and taking it back onto the main thread
   * would stop the page for nothing.
   */
  patience?: number
  priority?: Priority
}

/**
 * A few workers, not one. Meshing a creature is a second of arithmetic on
 * one core, and the walk alone asks for four of them; one after another they
 * were the first people of the walk arriving three seconds after its cave.
 * As many as half the machine's cores, never fewer than two and never more
 * than three: more than that and they take the cores the page is drawn with.
 *
 * One, where WebGL is drawn by the CPU. There the cores are what draws the
 * page, nothing of the walk is built ahead to be in a hurry for, and a second
 * worker meshing the hero's creatures alongside the first on every page load
 * was enough to put the browser tests on a CI runner past their time.
 */
let pool = 0
function poolSize(): number {
  if (pool > 0) return pool
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2
  pool = gpuClass() === 'software' ? 1 : Math.min(3, Math.max(2, Math.floor(cores / 2)))
  return pool
}

interface Job {
  id: number
  key: string
  kind: AnyKind
  detail: CreatureDetail
  priority: Priority
  patience: number
  /** The order it was asked in, so that among equals the first asked goes first. */
  order: number
  settle: (response: CreatureResponse) => void
}

const queue: Job[] = []
const idle: Worker[] = []
const busy = new Map<Worker, { job: Job; timer: ReturnType<typeof setTimeout> }>()
let spawned = 0
let workerFailed = false
let nextId = 1

/**
 * Gives up on the workers and hands every request still waiting on them back.
 *
 * Marking the workers dead without settling what they were carrying is the bug
 * this exists for: those promises never resolve, so whatever was waiting on the
 * geometry — most visibly the scroll companion — simply never appears, with no
 * error anywhere to explain it.
 */
function abandonWorkers(): void {
  workerFailed = true
  for (const [worker, { job, timer }] of busy) {
    clearTimeout(timer)
    worker.terminate()
    job.settle({ id: job.id, ok: false, error: 'creature worker unavailable' })
  }
  busy.clear()
  for (const worker of idle.splice(0)) worker.terminate()
  for (const job of queue.splice(0)) job.settle({ id: job.id, ok: false, error: 'creature worker unavailable' })
}

function spawn(): Worker | null {
  if (workerFailed || spawned >= poolSize()) return null
  try {
    const worker = new Worker(new URL('./creatures.worker.ts', import.meta.url), { type: 'module' })
    spawned++
    worker.onmessage = (event: MessageEvent<CreatureResponse>) => {
      const running = busy.get(worker)
      if (!running || running.job.id !== event.data.id) return
      clearTimeout(running.timer)
      busy.delete(worker)
      idle.push(worker)
      running.job.settle(event.data)
      pump()
    }
    worker.onerror = abandonWorkers
    worker.onmessageerror = abandonWorkers
    return worker
  } catch {
    workerFailed = true
    return null
  }
}

/** Hands the most wanted jobs to whichever workers are free, making more up to the pool's size. */
function pump(): void {
  while (queue.length > 0) {
    const worker = idle.pop() ?? spawn()
    if (!worker) break
    queue.sort((a, b) => a.priority - b.priority || a.order - b.order)
    const job = queue.shift()!
    // A reply that never comes at all — a worker wedged behind something, a
    // message lost — is caught here rather than left to hang forever. That
    // worker is let go; the rest of the queue goes to the others.
    const timer = setTimeout(() => {
      if (busy.get(worker)?.job !== job) return
      busy.delete(worker)
      worker.terminate()
      spawned--
      job.settle({ id: job.id, ok: false, error: 'creature worker took too long' })
      pump()
    }, job.patience)
    busy.set(worker, { job, timer })
    const message: CreatureRequest = { id: job.id, kind: job.kind, detail: job.detail }
    worker.postMessage(message)
  }
  // No worker could be had at all: what is left is built here.
  if (workerFailed && queue.length > 0) for (const job of queue.splice(0)) job.settle({ id: job.id, ok: false, error: 'creature worker unavailable' })
}

function request(kind: AnyKind, detail: CreatureDetail, options: RequestOptions = {}): Promise<CreatureGeometry> {
  const key = `${kind}:${detail}`
  const cached = cache.get(key)
  if (cached) return Promise.resolve(cached)
  const priority = options.priority ?? PRIORITY.now
  const already = pending.get(key)
  if (already) {
    // Asked again, and sooner: it moves up the queue if it has not started yet.
    const waiting = queue.find((job) => job.key === key)
    if (waiting && priority < waiting.priority) waiting.priority = priority
    return already
  }

  const promise = new Promise<CreatureGeometry>((resolve) => {
    const settle = (response: CreatureResponse) => {
      if (response.ok) resolve(toGeometry(response))
      // A failed worker run falls back to generating on the main thread: a brief
      // stall is still better than a hero with no creature in it.
      else resolve(toGeometry(createAnything(kind, detail)))
    }
    if (workerFailed) {
      resolve(toGeometry(createAnything(kind, detail)))
      return
    }
    queue.push({ id: nextId++, key, kind, detail, priority, patience: options.patience ?? PATIENCE, order: nextId, settle })
    pump()
  }).then((result) => {
    cache.set(key, result)
    pending.delete(key)
    return result
  })

  pending.set(key, promise)
  return promise
}

/**
 * The shared geometry for anything the worker can build, as a promise: for a
 * scene that is put together by hand rather than out of components.
 *
 * `patience` is how long a worker is given once it has started on it; the
 * default suits a creature the page is waiting to show, and something that
 * takes a second or two to mesh is better waited for than built on the main
 * thread in the middle of a scroll. `priority` is how soon it is wanted
 * (`PRIORITY`): asked for again sooner, it moves up.
 */
export const requestCreature = (kind: AnyKind, detail: CreatureDetail, options?: RequestOptions): Promise<CreatureGeometry> => request(kind, detail, options)

/**
 * Meshes a list of creatures ahead of time, one after another.
 *
 * Sequential, and at the lowest priority unless told otherwise: a caller that
 * queues five species at once would sit in front of whatever the page actually
 * needs on screen right now. Failures are the cache's problem, not the
 * caller's — this is a warm-up, and everything it warms is requested properly
 * later anyway.
 */
export async function prewarmCreatures(
  kinds: readonly AnyKind[],
  detail: CreatureDetail,
  gap = 400,
  priority: Priority = PRIORITY.someday,
): Promise<void> {
  for (const kind of kinds) {
    try {
      await request(kind, detail, { priority })
    } catch {
      /* the real request will fall back on the main thread */
    }
    // A gap between each, so anything the page needs on screen right now gets
    // the worker instead of queueing behind the whole warm-up.
    await new Promise((done) => setTimeout(done, gap))
  }
}

/**
 * Returns the shared geometry for a creature, or null until it is ready.
 * Geometry is owned by the module cache and shared between instances, so it is
 * deliberately never disposed here.
 */
export function useCreatureGeometry(kind: AnyCreatureKind, detail: CreatureDetail): CreatureGeometry | null {
  const key = `${kind}:${detail}`
  // Keyed state, so switching quality tiers reads as "not ready yet" during
  // render instead of needing a synchronous reset inside the effect.
  const [entry, setEntry] = useState<{ key: string; value: CreatureGeometry } | null>(() => {
    const ready = cache.get(key)
    return ready ? { key, value: ready } : null
  })

  useEffect(() => {
    let alive = true
    request(kind, detail).then((value) => {
      if (alive) setEntry({ key: `${kind}:${detail}`, value })
    })
    return () => {
      alive = false
    }
  }, [kind, detail])

  if (entry && entry.key === key) return entry.value
  return cache.get(key) ?? null
}

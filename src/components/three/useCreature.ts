import { useEffect, useState } from 'react'
import { BufferAttribute, BufferGeometry } from 'three'
import type { CreatureDetail, CreaturePayload } from './creatures'
import { createAnyCreature, type AnyCreatureKind } from './mascots'
import type { CreatureRequest, CreatureResponse } from './creatures.worker'

/**
 * Builds creature meshes in a worker and caches the results.
 *
 * Generation is a few hundred milliseconds of arithmetic, so it must not run on
 * the main thread; the hero simply renders nothing until its geometry arrives,
 * which lands well inside the preloader's own runtime. If workers are
 * unavailable the same code runs synchronously rather than failing.
 */

export interface CreatureGeometry {
  geometry: BufferGeometry
  bones: CreaturePayload['bones']
  eyeBone: string
  eyes: CreaturePayload['eyes']
  teeth: CreaturePayload['teeth']
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
  geometry.setIndex(new BufferAttribute(payload.indices, 1))
  geometry.computeBoundingSphere()
  return { geometry, bones: payload.bones, eyeBone: payload.eyeBone, eyes: payload.eyes, teeth: payload.teeth }
}

let worker: Worker | null = null
let workerFailed = false
let nextId = 1
const inflight = new Map<number, (response: CreatureResponse) => void>()

/** Longest a request may sit with the worker before the main thread takes it on. */
const PATIENCE = 4000

/**
 * Gives up on the worker and hands every request still waiting on it back.
 *
 * Marking the worker dead without settling what it was carrying is the bug this
 * exists for: those promises never resolve, so whatever was waiting on the
 * geometry — most visibly the scroll companion — simply never appears, with no
 * error anywhere to explain it.
 */
function abandonWorker(): void {
  workerFailed = true
  worker = null
  for (const [id, settle] of inflight) settle({ id, ok: false, error: 'creature worker unavailable' })
  inflight.clear()
}

function getWorker(): Worker | null {
  if (workerFailed) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('./creatures.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<CreatureResponse>) => {
      inflight.get(event.data.id)?.(event.data)
      inflight.delete(event.data.id)
    }
    worker.onerror = abandonWorker
    worker.onmessageerror = abandonWorker
  } catch {
    workerFailed = true
    worker = null
  }
  return worker
}

function request(kind: AnyCreatureKind, detail: CreatureDetail): Promise<CreatureGeometry> {
  const key = `${kind}:${detail}`
  const cached = cache.get(key)
  if (cached) return Promise.resolve(cached)
  const already = pending.get(key)
  if (already) return already

  const promise = new Promise<CreatureGeometry>((resolve) => {
    const active = getWorker()
    if (!active) {
      resolve(toGeometry(createAnyCreature(kind, detail)))
      return
    }
    const id = nextId++
    // And a reply that never comes at all — a worker wedged behind something, a
    // message lost — is caught here rather than left to hang forever.
    const patience = setTimeout(() => {
      if (!inflight.delete(id)) return
      resolve(toGeometry(createAnyCreature(kind, detail)))
    }, PATIENCE)
    inflight.set(id, (response) => {
      clearTimeout(patience)
      if (response.ok) resolve(toGeometry(response))
      // A failed worker run falls back to generating on the main thread: a brief
      // stall is still better than a hero with no creature in it.
      else resolve(toGeometry(createAnyCreature(kind, detail)))
    })
    const message: CreatureRequest = { id, kind, detail }
    active.postMessage(message)
  }).then((result) => {
    cache.set(key, result)
    pending.delete(key)
    return result
  })

  pending.set(key, promise)
  return promise
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

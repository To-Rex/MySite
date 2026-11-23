import type { CreatureDetail, CreaturePayload } from './creatures'
import { COAT_BUFFERS } from './evoCoat'
import { createAnything, type AnyKind } from './mascots'
import { meshVersion, openMeshCache } from './meshCache'

/**
 * Meshing a creature costs a few hundred milliseconds of pure arithmetic. Doing
 * it here keeps that off the main thread entirely, so the intro animation never
 * drops a frame while the hero is being built.
 *
 * `creatures.ts` and `sdf.ts` are deliberately three.js-free, which is what lets
 * this worker stay a few kilobytes instead of bundling a second copy of three.
 *
 * What it makes it also keeps, between visits (`meshCache.ts`): a mesh asked
 * for again on a later visit is read back rather than made again.
 */

export interface CreatureRequest {
  id: number
  kind: AnyKind
  detail: CreatureDetail
}

export type CreatureResponse =
  | ({ id: number; ok: true } & CreaturePayload)
  | { id: number; ok: false; error: string }

/**
 * Minimal shape of the dedicated worker scope. Declared locally because the app
 * compiles against the DOM lib, where `self` is typed as a Window.
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<CreatureRequest>) => void) | null
  postMessage(message: CreatureResponse, transfer?: Transferable[]): void
}

const ctx = self as unknown as WorkerScope

// Opened as the worker starts, so it is ready by the time the first mesh is asked for.
const kept = openMeshCache(meshVersion(self.location.href))

/** Every buffer of a payload, to hand over rather than copy. */
function buffersOf(payload: CreaturePayload): Transferable[] {
  const buffers: ArrayBufferLike[] = [
    payload.positions.buffer,
    payload.normals.buffer,
    payload.indices.buffer,
    payload.ao.buffer,
    payload.skinIndices.buffer,
    payload.skinWeights.buffer,
  ]
  if (payload.regions) buffers.push(payload.regions.buffer)
  if (payload.regions2) buffers.push(payload.regions2.buffer)
  if (payload.paint) buffers.push(payload.paint.buffer)
  if (payload.coat) for (const name of COAT_BUFFERS) buffers.push(payload.coat[name].buffer)
  return buffers as Transferable[]
}

ctx.onmessage = (event) => {
  const { id, kind, detail } = event.data
  void kept.get(kind, detail).then((found) => {
    try {
      const payload = found ?? createAnything(kind, detail)
      // Kept before it is handed over: the database copies it as it is put.
      if (!found) kept.put(kind, detail, payload)
      ctx.postMessage({ id, ok: true, ...payload }, buffersOf(payload))
    } catch (error) {
      ctx.postMessage({ id, ok: false, error: String(error) })
    }
  })
}

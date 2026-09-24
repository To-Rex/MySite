import type { CreatureDetail, CreaturePayload } from './creatures'
import { createAnyCreature, type AnyCreatureKind } from './mascots'

/**
 * Meshing a creature costs a few hundred milliseconds of pure arithmetic. Doing
 * it here keeps that off the main thread entirely, so the intro animation never
 * drops a frame while the hero is being built.
 *
 * `creatures.ts` and `sdf.ts` are deliberately three.js-free, which is what lets
 * this worker stay a few kilobytes instead of bundling a second copy of three.
 */

export interface CreatureRequest {
  id: number
  kind: AnyCreatureKind
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

ctx.onmessage = (event) => {
  const { id, kind, detail } = event.data
  try {
    const payload = createAnyCreature(kind, detail)
    // Hand the buffers over rather than copying them.
    ctx.postMessage({ id, ok: true, ...payload }, [
      payload.positions.buffer,
      payload.normals.buffer,
      payload.indices.buffer,
      payload.ao.buffer,
      payload.skinIndices.buffer,
      payload.skinWeights.buffer,
    ] as Transferable[])
  } catch (error) {
    ctx.postMessage({ id, ok: false, error: String(error) })
  }
}

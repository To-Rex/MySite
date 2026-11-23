import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreaturePayload } from '@/components/three/creatures'

/**
 * The meshing workers (`useCreature.ts`): a few of them, one queue in order of
 * how soon each mesh is wanted, and a worker's patience counted from when it
 * starts on a mesh, not from when the mesh was asked for.
 *
 * The workers here are stand-ins that answer when told to, and the main
 * thread's own mesher is a stand-in too: what is tested is who gets what when.
 */

/** The least a payload can be and still be made into a geometry. */
const payload = (): CreaturePayload => ({
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  ao: new Float32Array(3),
  skinIndices: new Uint16Array(12),
  skinWeights: new Float32Array(12),
  bones: [],
  eyeBone: 'head',
  eyes: [],
  teeth: [],
})

const builtHere = vi.fn(() => payload())
vi.mock('@/components/three/mascots', () => ({ createAnything: (...args: unknown[]) => builtHere(...(args as [])) }))

interface Asked {
  id: number
  kind: string
  detail: string
}

class FakeWorker {
  static made: FakeWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  asked: Asked[] = []
  terminated = false
  constructor() {
    FakeWorker.made.push(this)
  }
  postMessage(message: Asked) {
    this.asked.push(message)
  }
  terminate() {
    this.terminated = true
  }
  /** Answers the last thing it was asked for. */
  answer() {
    const last = this.asked[this.asked.length - 1]!
    this.onmessage?.({ data: { id: last.id, ok: true, ...payload() } } as MessageEvent)
  }
  fail() {
    this.onerror?.()
  }
}

/** What each worker is working on now: its kind, by the order the workers were made in. */
const working = () => FakeWorker.made.filter((w) => !w.terminated).map((w) => w.asked[w.asked.length - 1]?.kind)

async function load(cores: number) {
  vi.resetModules()
  FakeWorker.made = []
  builtHere.mockClear()
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('navigator', { hardwareConcurrency: cores })
  return import('@/components/three/useCreature')
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the meshing workers', () => {
  it('are half the cores, never fewer than two nor more than three', async () => {
    for (const [cores, pool] of [
      [1, 2],
      [2, 2],
      [4, 2],
      [6, 3],
      [8, 3],
      [32, 3],
    ] as const) {
      const { requestCreature } = await load(cores)
      for (const kind of ['dino', 'turtle', 'crag', 'early', 'mammoth'] as const) void requestCreature(kind, 'low')
      expect(FakeWorker.made.length, `${cores} cores`).toBe(pool)
    }
  })

  it('take what is wanted soonest first, and among equals what was asked first', async () => {
    const { requestCreature, PRIORITY } = await load(4)
    // Two workers: the first two asked are started at once, whatever they are.
    void requestCreature('crag', 'low', { priority: PRIORITY.someday })
    void requestCreature('early', 'low', { priority: PRIORITY.later })
    void requestCreature('mammoth', 'low', { priority: PRIORITY.later })
    void requestCreature('modern', 'low', { priority: PRIORITY.soon })
    void requestCreature('dino', 'low', { priority: PRIORITY.now })
    void requestCreature('turtle', 'low', { priority: PRIORITY.soon })
    expect(working()).toEqual(['crag', 'early'])
    // As each comes free it takes the most wanted of what is waiting.
    FakeWorker.made[0]!.answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(working()).toEqual(['dino', 'early'])
    FakeWorker.made[1]!.answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(working()).toEqual(['dino', 'modern'])
    FakeWorker.made[0]!.answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(working()).toEqual(['turtle', 'modern'])
    FakeWorker.made[1]!.answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(working()).toEqual(['turtle', 'mammoth'])
  })

  it('move a mesh up the queue when it is asked for again, sooner', async () => {
    const { requestCreature, PRIORITY } = await load(4)
    void requestCreature('crag', 'low', { priority: PRIORITY.later })
    void requestCreature('early', 'low', { priority: PRIORITY.later })
    void requestCreature('mammoth', 'low', { priority: PRIORITY.someday })
    void requestCreature('modern', 'low', { priority: PRIORITY.later })
    const again = requestCreature('mammoth', 'low', { priority: PRIORITY.now })
    FakeWorker.made[0]!.answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(working()[0]).toBe('mammoth')
    // And the two asks are one mesh, made once.
    FakeWorker.made[0]!.answer()
    const mesh = await again
    expect(await requestCreature('mammoth', 'low')).toBe(mesh)
    expect(builtHere).not.toHaveBeenCalled()
  })

  it('count a worker’s patience from when it starts, not from when the mesh was asked for', async () => {
    const { requestCreature } = await load(4)
    const first = requestCreature('crag', 'low', { patience: 1000 })
    const second = requestCreature('early', 'low', { patience: 1000 })
    const waiting = requestCreature('mammoth', 'low', { patience: 1000 })
    let done = false
    void waiting.then(() => {
      done = true
    })
    // Long past its patience while it waits its turn: still waiting, not built here.
    await vi.advanceTimersByTimeAsync(900)
    FakeWorker.made[0]!.answer()
    FakeWorker.made[1]!.answer()
    await Promise.all([first, second])
    await vi.advanceTimersByTimeAsync(900)
    expect(done).toBe(false)
    expect(builtHere).not.toHaveBeenCalled()
    // Its own second of patience gone, it is built on the main thread and that worker let go.
    await vi.advanceTimersByTimeAsync(200)
    await waiting
    expect(builtHere).toHaveBeenCalledTimes(1)
    expect(FakeWorker.made.filter((w) => w.terminated)).toHaveLength(1)
  })

  it('hand everything back to be built here when a worker fails', async () => {
    const { requestCreature } = await load(4)
    const asked = (['crag', 'early', 'mammoth', 'modern'] as const).map((kind) => requestCreature(kind, 'low'))
    FakeWorker.made[0]!.fail()
    const meshes = await Promise.all(asked)
    expect(meshes.every((m) => m.geometry.getAttribute('position').count === 3)).toBe(true)
    expect(builtHere).toHaveBeenCalledTimes(4)
    // And everything after is built here too, with no worker made for it.
    await requestCreature('dino', 'low')
    expect(builtHere).toHaveBeenCalledTimes(5)
  })
})

import { describe, expect, it } from 'vitest'
import type { CreaturePayload } from '@/components/three/creatures'
import { meshVersion, openMeshCache } from '@/components/three/meshCache'

/**
 * The meshes the worker keeps between visits (`meshCache.ts`): read back the
 * same as they were made, kept under the worker's own version and nothing
 * else, and never in the way of a mesh being made when the database is not
 * there, refuses or does not answer.
 *
 * The database is a stand-in with just enough of IndexedDB's shape: one
 * store, each event a tick after it is asked for, and a value copied the
 * moment it is put, as the real one does.
 */

const payload = (seed = 1): CreaturePayload => ({
  positions: new Float32Array([0, 0, 0, seed, 0, 0, 0, seed, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  ao: new Float32Array([0.5, 0.25, 1]),
  skinIndices: new Uint16Array(12).fill(seed),
  skinWeights: new Float32Array(12).fill(0.25),
  bones: [{ name: 'root', parent: null, at: [0, 0, 0] }] as unknown as CreaturePayload['bones'],
  eyeBone: 'head',
  eyes: [],
  teeth: [],
  regions: new Float32Array([1, 0, 0, 0]),
  size: 1.7,
})

type Handler = ((event: { preventDefault(): void }) => void) | null
const later = (fn: () => void) => setTimeout(fn, 0)
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

function fakeIndexedDB(mode: 'ok' | 'hang' | 'refuse' = 'ok') {
  const rows = new Map<string, unknown>()
  let created = false
  const request = () => ({ result: undefined as unknown, onsuccess: null as Handler, onerror: null as Handler })
  const event = { preventDefault() {} }
  const transaction = () => {
    let open = 0
    const tx = {
      oncomplete: null as (() => void) | null,
      onerror: null as Handler,
      objectStore: () => store,
    }
    const done = () => {
      if (--open === 0) later(() => tx.oncomplete?.())
    }
    const store = {
      get(key: string) {
        const r = request()
        open++
        later(() => {
          r.result = rows.has(key) ? structuredClone(rows.get(key)) : undefined
          r.onsuccess?.(event)
          done()
        })
        return r
      },
      put(value: unknown, key: string) {
        // Copied now, as IndexedDB does.
        const copy = structuredClone(value)
        const r = request()
        open++
        later(() => {
          rows.set(key, copy)
          r.onsuccess?.(event)
          done()
        })
        return r
      },
      delete(key: string) {
        rows.delete(key)
      },
      openKeyCursor() {
        const r = request() as ReturnType<typeof request> & { result: { key: string; continue(): void } | null }
        const keys = [...rows.keys()]
        let at = 0
        open++
        const step = () =>
          later(() => {
            r.result = at < keys.length ? { key: keys[at++]!, continue: step } : null
            r.onsuccess?.(event)
            if (!r.result) done()
          })
        step()
        return r
      },
    }
    return tx
  }
  const db = {
    objectStoreNames: { contains: () => created },
    createObjectStore: () => {
      created = true
    },
    transaction,
    close() {},
    onversionchange: null,
  }
  const factory = {
    open() {
      const r = { ...request(), onupgradeneeded: null as (() => void) | null, onblocked: null as (() => void) | null }
      if (mode === 'hang') return r
      later(() => {
        if (mode === 'refuse') return r.onerror?.(event)
        r.result = db
        if (!created) r.onupgradeneeded?.()
        r.onsuccess?.(event)
      })
      return r
    },
  }
  return { factory: factory as unknown as IDBFactory, rows }
}

describe('the version a worker keeps its meshes under', () => {
  it('is the hash in the name of a built worker', () => {
    expect(meshVersion('https://torexdev.uz/assets/creatures.worker-Bu5dpfxX.js')).toBe('Bu5dpfxX')
    expect(meshVersion('https://torexdev.uz/assets/creatures.worker-Bu5d_f-X.js?v=1#x')).toBe('Bu5d_f-X')
  })

  it('is none for the dev server, which keeps nothing', () => {
    expect(meshVersion('http://localhost:5173/src/components/three/creatures.worker.ts?worker_file&type=module')).toBeNull()
    expect(openMeshCache(null, 50, fakeIndexedDB().factory).put).toBeTypeOf('function')
  })
})

describe('the mesh cache', () => {
  it('gives back what it kept, the same to the last bit', async () => {
    const { factory } = fakeIndexedDB()
    const cache = openMeshCache('v1', 200, factory)
    expect(await cache.get('early', 'high')).toBeUndefined()
    const made = payload(3)
    cache.put('early', 'high', made)
    await tick()
    const read = await cache.get('early', 'high')
    expect(read).toEqual(payload(3))
    expect(read!.positions).toBeInstanceOf(Float32Array)
    expect(read!.indices).toBeInstanceOf(Uint32Array)
    expect(read!.skinIndices).toBeInstanceOf(Uint16Array)
    // Another kind or another detail is another mesh.
    expect(await cache.get('early', 'low')).toBeUndefined()
    expect(await cache.get('crag', 'high')).toBeUndefined()
  })

  it('has its own copy the moment it is given one, so the buffers can be handed on', async () => {
    const { factory } = fakeIndexedDB()
    const cache = openMeshCache('v1', 200, factory)
    await cache.get('early', 'high')
    const made = payload(2)
    cache.put('early', 'high', made)
    // Handed over to the page, as the worker does: these buffers are gone from here.
    structuredClone(made, { transfer: [made.positions.buffer, made.normals.buffer, made.indices.buffer] })
    expect(made.positions.length).toBe(0)
    await tick()
    expect(await cache.get('early', 'high')).toEqual(payload(2))
  })

  it('reads nothing kept by another version, and clears it out once it keeps its own', async () => {
    const { factory, rows } = fakeIndexedDB()
    const old = openMeshCache('v1', 200, factory)
    await old.get('early', 'high')
    old.put('early', 'high', payload(1))
    await tick()
    expect([...rows.keys()]).toEqual(['v1|early|high'])

    const now = openMeshCache('v2', 200, factory)
    expect(await now.get('early', 'high')).toBeUndefined()
    now.put('early', 'high', payload(4))
    await tick()
    await tick()
    expect([...rows.keys()]).toEqual(['v2|early|high'])
    expect(await now.get('early', 'high')).toEqual(payload(4))
  })

  it('treats a record it cannot draw with as nothing kept', async () => {
    const { factory, rows } = fakeIndexedDB()
    const cache = openMeshCache('v1', 200, factory)
    await cache.get('early', 'high')
    rows.set('v1|early|high', { positions: new Float32Array(3), normals: new Float32Array(6) })
    expect(await cache.get('early', 'high')).toBeUndefined()
    rows.set('v1|early|high', 'garbage')
    expect(await cache.get('early', 'high')).toBeUndefined()
  })

  it('is out of the way where there is no database, or it refuses, or it never answers', async () => {
    const none = openMeshCache('v1', 50, undefined)
    expect(await none.get('early', 'high')).toBeUndefined()
    expect(() => none.put('early', 'high', payload())).not.toThrow()

    const refused = openMeshCache('v1', 50, fakeIndexedDB('refuse').factory)
    expect(await refused.get('early', 'high')).toBeUndefined()
    expect(() => refused.put('early', 'high', payload())).not.toThrow()

    const silent = openMeshCache('v1', 30, fakeIndexedDB('hang').factory)
    const started = performance.now()
    expect(await silent.get('early', 'high')).toBeUndefined()
    expect(performance.now() - started).toBeLessThan(500)
    expect(() => silent.put('early', 'high', payload())).not.toThrow()
  })
})

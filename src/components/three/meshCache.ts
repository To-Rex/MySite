import type { CreatureDetail, CreaturePayload } from './creatures'

/**
 * The meshes the worker has made, kept between visits.
 *
 * A creature is up to two seconds of arithmetic on one core, more on a
 * phone, and the start of the long walk alone asks for four of them. The
 * same arithmetic gives the same mesh every time: what comes out depends on
 * nothing but the kind, the detail and the code that meshes it. So the
 * worker keeps what it makes in the browser's own database, and the next
 * visit reads it back instead of making it again — the same mesh to the last
 * bit, in tens of milliseconds instead of seconds of a core.
 *
 * The code is the version. The worker's own address carries a hash of
 * everything it is built from, so any change to the meshing is a new address,
 * and what was kept under an older one is cleared out the first time the new
 * one keeps anything. A page served without such a hash (the dev server)
 * keeps nothing.
 *
 * None of it can stop a mesh being made. Where there is no database, or it
 * refuses, or it is full, or it does not answer in time, it is as if nothing
 * had been kept, and the worker meshes as it always has.
 */

const NAME = 'dh-meshes'
const STORE = 'meshes'

export interface MeshCache {
  /** What was kept for this one, or nothing — and never later than `wait` to say so. */
  get(kind: string, detail: CreatureDetail): Promise<CreaturePayload | undefined>
  /**
   * Keeps it. The database copies it before this returns, so its buffers can
   * be handed on straight after. Does nothing until the database is open.
   */
  put(kind: string, detail: CreatureDetail, payload: CreaturePayload): void
}

const NONE: MeshCache = {
  get: () => Promise.resolve(undefined),
  put: () => undefined,
}

/**
 * The version a worker at `url` keeps its meshes under: the hash a production
 * build puts in the file's name, or null where there is none.
 */
export function meshVersion(url: string): string | null {
  const name = url.split(/[?#]/)[0]!.split('/').pop() ?? ''
  const hash = /-([A-Za-z0-9_-]{8,})\.js$/.exec(name)?.[1]
  return hash ?? null
}

/** Enough of a payload to draw with: anything else read back is treated as nothing kept. */
function whole(value: unknown): value is CreaturePayload {
  const p = value as Partial<CreaturePayload> | undefined
  return (
    !!p &&
    p.positions instanceof Float32Array &&
    p.positions.length > 0 &&
    p.normals instanceof Float32Array &&
    p.normals.length === p.positions.length &&
    p.indices instanceof Uint32Array &&
    p.indices.length > 0 &&
    p.ao instanceof Float32Array &&
    p.skinIndices instanceof Uint16Array &&
    p.skinWeights instanceof Float32Array &&
    Array.isArray(p.bones) &&
    typeof p.eyeBone === 'string' &&
    Array.isArray(p.eyes) &&
    Array.isArray(p.teeth)
  )
}

export function openMeshCache(version: string | null, wait = 1500, idb: IDBFactory | undefined = globalThis.indexedDB): MeshCache {
  if (!version || !idb) return NONE
  let db: IDBDatabase | null = null
  let failed = false
  const opened = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = idb.open(NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
      }
      request.onsuccess = () => {
        db = request.result
        // Another tab with a newer build wants the database: this one lets go.
        db.onversionchange = () => {
          db?.close()
          db = null
          failed = true
        }
        resolve(db)
      }
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  }).then((value) => {
    if (!value) failed = true
    return value
  })
  const key = (kind: string, detail: CreatureDetail) => `${version}|${kind}|${detail}`
  let swept = false
  /** Everything kept under any other version goes. */
  const sweep = (): void => {
    if (swept || !db) return
    swept = true
    try {
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
      const cursor = store.openKeyCursor()
      cursor.onsuccess = () => {
        const at = cursor.result
        if (!at) return
        if (!String(at.key).startsWith(`${version}|`)) store.delete(at.key)
        at.continue()
      }
    } catch {
      /* the next visit sweeps */
    }
  }
  return {
    get(kind, detail) {
      return new Promise((resolve) => {
        let done = false
        const answer = (value: CreaturePayload | undefined): void => {
          if (done) return
          done = true
          clearTimeout(timer)
          resolve(value)
        }
        const timer = setTimeout(() => answer(undefined), wait)
        void opened.then((open) => {
          if (!open || failed || !db) return answer(undefined)
          try {
            const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key(kind, detail))
            request.onsuccess = () => answer(whole(request.result) ? request.result : undefined)
            request.onerror = () => answer(undefined)
          } catch {
            answer(undefined)
          }
        })
      })
    },
    put(kind, detail, payload) {
      if (failed || !db) return
      try {
        const transaction = db.transaction(STORE, 'readwrite')
        transaction.oncomplete = sweep
        // Full, or refused: nothing is kept, and nothing else changes.
        transaction.onerror = (event) => event.preventDefault()
        transaction.objectStore(STORE).put(payload, key(kind, detail))
      } catch {
        /* not kept */
      }
    },
  }
}

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { CAR_MODELS, CC_BY, MODEL_ROLES } from '@/content/carModels'
import { VEHICLE_KINDS } from '@/components/three/evoCarShapes'

/**
 * The car models other people made: what is in `public/models/cars/` is what
 * the credits list, no more and no less; each file is what the walk expects of
 * it (README → The traffic); and none of it is heavy. The walk loads each file
 * once, in idle time; the whole street's worth stays within what a page can
 * spend on something seen for a few seconds.
 */
const DIR = join(process.cwd(), 'public/models/cars')
const files = (() => {
  try {
    return readdirSync(DIR).filter((name) => name.endsWith('.glb.gz'))
  } catch {
    return []
  }
})()

/** At most this much for one car, and for all of them. */
const ONE = 450 * 1024
const ALL = 2.2 * 1024 * 1024
/** Triangles: a body and its wheel close up, and far off. */
const NEAR = 10500
const FAR = 2700
/** What a file may not need to be read: anything a decoder has to be fetched for. */
const DECODED = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression', 'KHR_texture_basisu']
/** What it may need: three reads all of these itself. */
const READ = ['KHR_mesh_quantization', 'EXT_texture_webp', 'KHR_texture_transform']

interface Gltf {
  extensionsUsed?: string[]
  extensionsRequired?: string[]
  scenes: { nodes?: number[]; extras?: Record<string, unknown> }[]
  nodes: { name?: string; mesh?: number; children?: number[] }[]
  meshes: { primitives: { indices?: number; material?: number; attributes: Record<string, number> }[] }[]
  accessors: { count: number }[]
  materials?: { name?: string; extras?: { role?: unknown } }[]
  images?: { mimeType?: string; bufferView?: number; uri?: string }[]
  bufferViews?: { byteOffset?: number; byteLength: number }[]
}

/** The JSON of a gzipped binary glTF, and its binary chunk. */
function read(file: string): { gltf: Gltf; bin: Buffer } {
  const zipped = readFileSync(join(DIR, file))
  expect([zipped[0], zipped[1]], file).toEqual([0x1f, 0x8b])
  const data = gunzipSync(zipped)
  expect(data.toString('ascii', 0, 4), file).toBe('glTF')
  expect(data.readUInt32LE(4), file).toBe(2)
  const jsonLength = data.readUInt32LE(12)
  expect(data.toString('ascii', 16, 20), file).toBe('JSON')
  const gltf = JSON.parse(data.toString('utf8', 20, 20 + jsonLength)) as Gltf
  const at = 20 + jsonLength
  const bin = at + 8 <= data.length ? data.subarray(at + 8, at + 8 + data.readUInt32LE(at)) : Buffer.alloc(0)
  return { gltf, bin }
}

/** How wide and tall a WebP image is, from its header. */
function webpSize(image: Buffer): [number, number] {
  expect(image.toString('ascii', 0, 4)).toBe('RIFF')
  expect(image.toString('ascii', 8, 12)).toBe('WEBP')
  const chunk = image.toString('ascii', 12, 16)
  if (chunk === 'VP8X') return [1 + image.readUIntLE(24, 3), 1 + image.readUIntLE(27, 3)]
  if (chunk === 'VP8L') {
    const bits = image.readUInt32LE(21)
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)]
  }
  return [image.readUInt16LE(26) & 0x3fff, image.readUInt16LE(28) & 0x3fff]
}

/** A named node's triangles, its own and its children's. */
function triangles(gltf: Gltf, name: string): number {
  const count = (index: number): number => {
    const node = gltf.nodes[index]!
    let sum = 0
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh]!.primitives) {
        sum += (primitive.indices !== undefined ? gltf.accessors[primitive.indices]!.count : gltf.accessors[primitive.attributes.POSITION!]!.count) / 3
      }
    }
    for (const child of node.children ?? []) sum += count(child)
    return sum
  }
  const index = gltf.nodes.findIndex((node) => node.name === name)
  return index < 0 ? -1 : count(index)
}

const numbers = (value: unknown, length: number): boolean => Array.isArray(value) && value.length === length && value.every((v) => typeof v === 'number' && Number.isFinite(v))

describe('the car models', () => {
  it('are each credited, each credit has its file, and each is a car the walk has', () => {
    const credited = CAR_MODELS.map((model) => model.file.replace('/models/cars/', ''))
    expect([...files].sort()).toEqual([...credited].sort())
    for (const model of CAR_MODELS) {
      expect(model.file).toMatch(/^\/models\/cars\/[a-z0-9-]+\.glb\.gz$/)
      expect(VEHICLE_KINDS).toContain(model.kind)
      expect(model.title.length).toBeGreaterThan(0)
      expect(model.author.length).toBeGreaterThan(0)
      expect(model.url).toMatch(/^https:\/\/sketchfab\.com\/3d-models\//)
      expect(model.licence).toBe('CC BY 4.0')
    }
    expect(CC_BY).toBe('https://creativecommons.org/licenses/by/4.0/')
    // One model to a kind, or to each of its faces.
    const keys = CAR_MODELS.map((model) => `${model.kind}:${model.variant ?? '-'}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const model of CAR_MODELS) {
      if (model.variant === undefined) expect(keys.filter((key) => key.startsWith(`${model.kind}:`))).toHaveLength(1)
    }
  })

  it('are small: a few hundred kilobytes each, and about two megabytes in all', () => {
    let total = 0
    for (const name of files) {
      const size = statSync(join(DIR, name)).size
      expect(size, name).toBeLessThan(ONE)
      total += size
    }
    expect(total).toBeLessThan(ALL)
  })

  it('are what the walk expects of them, and say whose they are', () => {
    for (const model of CAR_MODELS) {
      const file = model.file.replace('/models/cars/', '')
      const { gltf, bin } = read(file)
      // Nothing that needs a decoder: the page may run no WebAssembly. Only what three reads itself.
      for (const used of [...(gltf.extensionsUsed ?? []), ...(gltf.extensionsRequired ?? [])]) {
        expect(DECODED, `${file} ${used}`).not.toContain(used)
        expect(READ, `${file} ${used}`).toContain(used)
      }
      // A body and a wheel, close up and far off, within what they may cost.
      const near = triangles(gltf, 'body') + triangles(gltf, 'wheel')
      const far = triangles(gltf, 'body_far') + triangles(gltf, 'wheel_far')
      for (const name of ['body', 'wheel', 'body_far', 'wheel_far']) expect(triangles(gltf, name), `${file} ${name}`).toBeGreaterThan(0)
      expect(near, `${file} near`).toBeLessThan(NEAR)
      expect(far, `${file} far`).toBeLessThan(FAR)
      // Every material says what it is.
      for (const material of gltf.materials ?? []) {
        const role = material.extras?.role
        expect(typeof role === 'string' ? (MODEL_ROLES as readonly string[]).includes(role) : MODEL_ROLES.some((each) => (material.name ?? '').startsWith(each)), `${file} ${material.name}`).toBe(true)
      }
      // Pictures in it are WebP, and no bigger than 512 pixels a side.
      for (const image of gltf.images ?? []) {
        expect(image.mimeType, file).toBe('image/webp')
        const view = gltf.bufferViews![image.bufferView!]!
        const [w, h] = webpSize(bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength))
        expect(Math.max(w, h), file).toBeLessThanOrEqual(512)
      }
      // What it says about itself: its measurements, its hubs, its plates, and its credit, which is the footer's.
      const extras = gltf.scenes[0]!.extras ?? {}
      expect(extras.kind, file).toBe(file.replace('.glb.gz', ''))
      for (const key of ['length', 'width', 'height', 'wheelbase', 'wheelRadius']) expect(typeof extras[key], `${file} ${key}`).toBe('number')
      const wheels = extras.wheels as unknown[]
      expect(wheels, file).toHaveLength(4)
      for (const hub of wheels) expect(numbers(hub, 3), file).toBe(true)
      // The plates: where the model's were, centred, facing out of each end (or not yet said, and found by the walk).
      const plates = extras.plates as { front?: unknown; rear?: unknown } | null
      if (plates !== null) {
        expect(numbers(plates.front, 5) && numbers(plates.rear, 5), file).toBe(true)
        const front = plates.front as number[]
        const rear = plates.rear as number[]
        expect(front[0]!, file).toBeGreaterThan(0)
        expect(rear[0]!, file).toBeLessThan(0)
      }
      const credit = extras.credit as { title?: string; author?: string; url?: string; license?: string }
      expect(credit.title, file).toBe(model.title)
      expect(credit.author, file).toBe(model.author)
      expect(credit.url, file).toBe(model.url)
      expect(credit.license?.replace(/-/g, ' '), file).toMatch(/BY 4\.0/)
    }
  })
})

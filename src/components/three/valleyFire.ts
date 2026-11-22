import { BufferAttribute, BufferGeometry, MathUtils, Sphere, Vector3 } from 'three'
import type { ValleyQuality } from '@/lib/valley'
import { CRATER, LAKE, craterAt, fellAt, groundAt, hash2, inCrater, slopeAt, type Spot } from './valleyLand'
import { spotsFor, type Kind } from './valleyForest'

/**
 * Where the valley burns: every flame and every column of smoke, placed once.
 *
 * Nothing here moves on the CPU. Each sprite is put where it stands — on a
 * burning crown, on a fern, on the meadow — with a size, how long it burns
 * and a seed, and the card works out the rest every frame from the fire's
 * own clock (`makeFlameMaterial`, `makeFireSmokeMaterial`): when the fire
 * reaches the spot, how far it has burnt, how it flickers, where its smoke has
 * risen to. So the flames on a tree catch when the ground under it does, and
 * a forest burning across a whole valley costs no more on the main thread
 * than one that is not.
 */

interface FireLevel {
  /** Flames on the open ground. */
  ground: number
  /** Flames on each conifer's crown (up to three). */
  crown: number
  /** One fern in this many burns with a flame of its own; 0 for none. */
  fern: number
  /** Puffs of smoke over all of it. */
  puffs: number
}

const FIRE_LEVEL: Record<ValleyQuality, FireLevel> = {
  low: { ground: 0, crown: 1, fern: 0, puffs: 0 },
  medium: { ground: 360, crown: 2, fern: 3, puffs: 220 },
  high: { ground: 800, crown: 3, fern: 2, puffs: 420 },
  ultra: { ground: 1200, crown: 3, fern: 1, puffs: 680 },
}

/**
 * Flames on each kind of plant, in its own units: how high up, how far out
 * from the trunk, how tall the flame, and how long after the fire reaches
 * the ground under it the flame catches — it climbs, so the crown goes last.
 * A crown fire is the whole crown alight and flames twice its height, not a
 * candle on a stick: three flames stacked up the trunk read as exactly that.
 */
const ON_PLANT: Record<
  Kind,
  { at: readonly number[]; out: readonly number[]; size: readonly number[]; delay: readonly number[]; life: number }
> = {
  umbrella: { at: [12, 14.5, 16.4], out: [4.2, 3.2, 1.2], size: [9, 10, 8], delay: [0.25, 0.45, 0.65], life: 3.4 },
  tiered: { at: [4, 7.5, 11], out: [2.6, 1.8, 0.6], size: [7, 8, 6], delay: [0.15, 0.35, 0.55], life: 3 },
  treeFern: { at: [3.4], out: [0.8], size: [4.8], delay: [0.1], life: 2.2 },
  fern: { at: [0.5], out: [0.2], size: [2.2], delay: [0.05], life: 1.5 },
}

/** The forest only knows three levels. */
const forestTier = (quality: ValleyQuality) => (quality === 'ultra' ? 'high' : quality)

const UP = new Vector3()

/**
 * Where a point that stood `height` up a plant, `reach` out from its trunk
 * towards `angle`, is once the blast has put the plant down: tipped over,
 * away from the crater, and sunk a little, as the instances are in
 * `valleyFlora.tsx`.
 */
function onPlant(spot: Spot, height: number, out: Vector3, reach = 0, angle = 0): Vector3 {
  const h = height * spot.scale
  const ox = Math.cos(angle) * reach * spot.scale
  const oz = Math.sin(angle) * reach * spot.scale
  const fell = fellAt(spot.x, spot.z)
  if (!fell) return out.set(spot.x + ox, spot.y + h, spot.z + oz)
  UP.set(fell.dx * Math.sin(fell.tilt), Math.cos(fell.tilt), fell.dz * Math.sin(fell.tilt))
  return out.set(spot.x + ox + UP.x * h, spot.y - 0.45 + UP.y * h, spot.z + oz + UP.z * h)
}

/** Whether open ground at a point has anything on it to burn, and is not in the lake or the crater. */
function burnable(x: number, z: number): boolean {
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 1.15) return false
  if (Math.hypot(x - CRATER.x, z - CRATER.z) < CRATER.r * 1.7) return false
  return slopeAt(x, z) < 0.32 && groundAt(x, z) < 30
}

/** The ground at a point once the crater has formed, and the patch over it lifted, as the shaders have it. */
function floorAt(x: number, z: number): number {
  const q = Math.hypot(x - CRATER.x, z - CRATER.z) / CRATER.r
  return groundAt(x, z) + craterAt(x, z) + (q < CRATER.reach ? 0.08 : 0)
}

/** Open ground in front of the camera, in a deterministic order, nearer a little more often. */
function* groundSpots(seed: number): Generator<[number, number]> {
  for (let i = 0; i < 200_000; i++) {
    const x = MathUtils.lerp(-130, 150, hash2(i, seed))
    const z = MathUtils.lerp(6, -235, Math.pow(hash2(i, seed + 1), 1.2))
    // Inside what the lens takes in from where it stands, with a margin.
    if (Math.abs(Math.atan2(x, 16 - z)) > 0.8) continue
    if (burnable(x, z)) yield [x, z]
  }
}

interface Field {
  position: number[]
  extra: number[]
}

const push = (field: Field, p: Vector3, extra: readonly [number, number, number, number]) => {
  field.position.push(p.x, p.y, p.z)
  field.extra.push(...extra)
}

function toPoints(field: Field, name: string, lift: number): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(field.position), 3))
  g.setAttribute(name, new BufferAttribute(new Float32Array(field.extra), 4))
  g.computeBoundingSphere()
  // The card moves them up from where they stand — the smoke a long way.
  const sphere = g.boundingSphere ?? new Sphere(new Vector3(0, 0, -100), 300)
  sphere.radius += lift
  g.boundingSphere = sphere
  return g
}

const P = new Vector3()

/** Every flame in the valley: on the crowns, on the ferns, across the meadow. */
export function buildFlames(quality: ValleyQuality): BufferGeometry {
  const level = FIRE_LEVEL[quality]
  const tier = forestTier(quality)
  const field: Field = { position: [], extra: [] }
  let seed = 0
  const kinds: Kind[] = ['umbrella', 'tiered', 'treeFern', 'fern']
  for (const kind of kinds) {
    const plant = ON_PLANT[kind]
    const spots = spotsFor(tier, kind)
    spots.forEach((spot, i) => {
      if (kind === 'fern' && (level.fern === 0 || i % level.fern !== 0)) return
      if (inCrater(spot.x, spot.z)) return
      const count = kind === 'umbrella' || kind === 'tiered' ? Math.min(level.crown, plant.at.length) : plant.at.length
      for (let k = 0; k < count; k++) {
        const r = hash2(i * 7 + k, 811 + seed)
        // The upper flames first when there are fewer of them: a crown fire
        // is mostly at the crown.
        const which = plant.at.length - 1 - k
        onPlant(spot, plant.at[which] ?? 0, P, plant.out[which] ?? 0, hash2(i * 7 + k, 815 + seed) * Math.PI * 2)
        push(field, P, [
          (plant.size[which] ?? 4) * spot.scale * (0.8 + 0.4 * r),
          plant.life * (0.8 + 0.4 * hash2(i, 812 + seed)),
          hash2(i * 7 + k, 813 + seed),
          (plant.delay[which] ?? 0) + hash2(i, 814 + seed) * 0.3,
        ])
      }
    })
    seed += 10
  }
  let n = 0
  for (const [x, z] of groundSpots(901)) {
    if (n++ >= level.ground) break
    P.set(x, floorAt(x, z), z)
    // A grass fire's flames are knee- to head-high, a carpet of them, not tents.
    push(field, P, [0.7 + Math.pow(hash2(n, 902), 1.6) * 1.9, 0.9 + hash2(n, 903) * 0.9, hash2(n, 904), hash2(n, 905) * 0.25])
  }
  return toPoints(field, 'aFlame', 30)
}

/** Smoke over everything that burns: from the crowns, and off the meadow. */
export function buildFireSmoke(quality: ValleyQuality): BufferGeometry {
  const level = FIRE_LEVEL[quality]
  const tier = forestTier(quality)
  const field: Field = { position: [], extra: [] }
  const trees = Math.round(level.puffs * 0.45)
  const kinds = ['umbrella', 'tiered', 'treeFern'] as const
  const sites = kinds.flatMap((kind) => spotsFor(tier, kind).flatMap((spot) => (inCrater(spot.x, spot.z) ? [] : [{ kind, spot }])))
  for (let i = 0; i < trees && sites.length > 0; i++) {
    const { kind, spot } = sites[i % sites.length]!
    const top = ON_PLANT[kind].at[ON_PLANT[kind].at.length - 1] ?? 4
    onPlant(spot, top, P)
    const big = kind === 'treeFern' ? 0.65 : 1
    push(field, P, [hash2(i, 921), 0.35 + hash2(i, 922) * 0.8, (8 + hash2(i, 923) * 6) * big, (34 + hash2(i, 924) * 22) * big])
  }
  let n = 0
  for (const [x, z] of groundSpots(931)) {
    if (n++ >= level.puffs - trees) break
    P.set(x, floorAt(x, z), z)
    push(field, P, [hash2(n, 932), 0.3 + hash2(n, 933) * 0.9, 6 + hash2(n, 934) * 6, 24 + hash2(n, 935) * 20])
  }
  return toPoints(field, 'aPuff', 80)
}

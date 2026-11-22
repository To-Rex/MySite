import type { Technology } from '@/content/technologies'
import { clamp01, finite, smoothstep } from '@/lib/scroll'

/**
 * The flight through the technology universe, as numbers: where the camera is
 * as the section passes through the screen, and what the constellation does
 * around it. Free of three.js so the tests can fly it without a renderer.
 *
 * Coming up the page the camera starts far out, low and off to one side,
 * with the technologies flung wide; they gather into their sphere as it
 * closes in. While the stage is wholly on screen it holds exactly the shot
 * the section was composed around, so nothing moves under a reader who has
 * stopped to point at something. Leaving, it pushes in through the cloud and
 * rises over it, the labels fading so they do not swell across the lens.
 */

export interface Point3 {
  x: number
  y: number
  z: number
}

/** Deterministic, evenly spread positions on a slightly flattened sphere. */
export function layoutNodes(items: readonly Pick<Technology, 'core'>[], radius: number, compact: boolean): Point3[] {
  const n = items.length
  const golden = Math.PI * (3 - Math.sqrt(5))
  return items.map((item, i) => {
    const y = n > 1 ? 1 - (i / (n - 1)) * 2 : 0 // 1 → -1
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i + 0.6
    const spread = item.core ? radius * 0.72 : radius
    return {
      x: Math.cos(theta) * r * spread * (compact ? 0.82 : 1),
      y: y * spread * 0.78,
      z: Math.sin(theta) * r * spread * 0.7,
    }
  })
}

/** The sphere's resting radius, and how far the camera rests from it. */
export const UNIVERSE = {
  radius: { wide: 2.7, compact: 2.05 },
  rest: { wide: 7.6, compact: 9 },
} as const

export interface Flight {
  /** From the core, in world units. */
  distance: number
  /** Around the vertical axis, in radians; 0 is the composed shot. */
  azimuth: number
  /** Above (+) or below (−) the core, in radians. */
  elevation: number
  /** The sphere's radius as a multiple of its resting one. */
  spread: number
  /** How visible the labels are, 0–1. */
  labels: number
  /** How far the constellation has turned with the scroll, in radians. */
  turn: number
}

export const FLIGHT_KEYS = ['distance', 'azimuth', 'elevation', 'spread', 'labels', 'turn'] as const satisfies readonly (keyof Flight)[]

/** The composed shot holds between these two points of the stage's passage. */
export const HOLD = { from: 0.4, to: 0.6 } as const

/**
 * How far the stage has come through the screen: 0 as its top edge enters at
 * the bottom, 1 as its bottom edge leaves at the top, ½ when it is centred.
 */
export function stageProgress(top: number, height: number, viewport: number): number {
  const span = finite(viewport) + finite(height)
  return span > 0 ? clamp01((finite(viewport) - finite(top)) / span) : 0.5
}

export function universeFlight(progress: number, rest: number): Flight {
  const p = clamp01(finite(progress, 0.5))
  const inbound = 1 - smoothstep(0, HOLD.from, p)
  const outbound = smoothstep(HOLD.to, 1, p)
  return {
    distance: rest * (1 + inbound * 1.1 - outbound * 0.42),
    azimuth: -0.8 * inbound + 0.62 * outbound,
    elevation: -0.3 * inbound + 0.5 * outbound,
    spread: 1 + inbound * 0.9 + outbound * 0.12,
    labels: smoothstep(0.2, 0.36, p) * (1 - smoothstep(0.64, 0.8, p)),
    turn: (p - 0.5) * 1.1,
  }
}

/** Where the camera stands for a flight, looking at the core. */
export function cameraPosition(flight: Flight): Point3 {
  const flat = flight.distance * Math.cos(flight.elevation)
  return {
    x: flat * Math.sin(flight.azimuth),
    y: flight.distance * Math.sin(flight.elevation),
    z: flat * Math.cos(flight.azimuth),
  }
}

/**
 * The nearest the camera comes to a node for a flight, whichever way the
 * constellation has turned: it spins about the vertical axis, so each node
 * sweeps a circle, and the closest approach is to that circle.
 */
export function closestApproach(flight: Flight, nodes: readonly Point3[]): number {
  const eye = cameraPosition(flight)
  const eyeRing = Math.hypot(eye.x, eye.z)
  let nearest = Infinity
  for (const node of nodes) {
    const ring = Math.hypot(node.x, node.z) * flight.spread
    nearest = Math.min(nearest, Math.hypot(eyeRing - ring, eye.y - node.y * flight.spread))
  }
  return nearest
}

import { useSyncExternalStore } from 'react'

/**
 * The 404 page's show, shared between the words and the scene.
 *
 * Same shape as the hero's easter-egg store and the valley's: the scene owns the
 * timeline because it is the only thing with a frame clock, and only act changes
 * notify, so the page re-renders a handful of times rather than sixty a second.
 * Free of three.js, because the page that reads it has to load without it.
 */

export type NotFoundAct =
  /** Nothing has landed yet. */
  | 'load'
  /** The meteor has hit and the number is coming up out of the crater. */
  | 'impact'
  /** The opening is over and everything answers. */
  | 'alive'

/** Seconds on the scene's own clock. */
export const OPENING = {
  /** The first meteor comes into frame. */
  meteor: 0.3,
  /** It lands. */
  impact: 1.3,
  /** The columns start to fly. */
  rise: 1.42,
  /** The earliest the tyrannosaur may start walking, if it has been meshed. */
  walk: 2.2,
  /** After it stops, before it opens its mouth. */
  windUp: 0.45,
  /** Everything has landed; the visitor can start calling meteors down. */
  alive: 4.3,
} as const

let act: NotFoundAct = 'load'
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getAct = () => act

export function useNotFoundAct(): NotFoundAct {
  return useSyncExternalStore(subscribe, getAct, getAct)
}

/** Called by the scene as the timeline advances. */
export function setNotFoundAct(next: NotFoundAct): void {
  if (act === next) return
  act = next
  for (const listener of listeners) listener()
}

export type NotFoundCommand = { kind: 'roar' } | { kind: 'strike'; nx: number; ny: number }

const commands: NotFoundCommand[] = []

/** The most that may wait for a frame; a held-down key should not queue a siege. */
const MOST_QUEUED = 4

function send(command: NotFoundCommand): void {
  if (act === 'alive' && commands.length < MOST_QUEUED) commands.push(command)
}

/** Asks the tyrannosaur to roar. Ignored until the opening is over. */
export const callRoar = (): void => send({ kind: 'roar' })

/** Calls a meteor down on a point of the screen, −1..1 with y up. */
export const callStrike = (nx: number, ny: number): void => send({ kind: 'strike', nx, ny })

/** Everything asked for since the last frame. */
export const drainCommands = (): NotFoundCommand[] => commands.splice(0)

/** The camera the layout below is worked out for. */
export const CAMERA = { fov: 30, z: 11.5, y: 0.35, lookY: 0.15 } as const

/** How tall the tyrannosaur stands for each unit of its length, seen from where it stands. */
const ANIMAL_HEIGHT = 0.44

/** Height of the view at z = 0, in world units. */
export const VIEW_HEIGHT = 2 * CAMERA.z * Math.tan((CAMERA.fov / 2) * (Math.PI / 180))

export interface StageLayout {
  /** World position of the centre of the number. */
  stageX: number
  stageY: number
  /** Scale of the number. */
  stageScale: number
  /** The ground plane. */
  groundY: number
  /** Where the tyrannosaur ends up, and how big it is. */
  rexX: number
  rexZ: number
  rexScale: number
  /** How far off-screen it starts walking from. */
  rexFrom: number
  /** Width over height of the window. */
  aspect: number
  /** Where the words sit, in screen 0..1: centre x, y and radius x, y. */
  quiet: readonly [number, number, number, number]
}

/**
 * Where everything goes for a given window.
 *
 * Three shapes, because the words take different parts of each: a wide window
 * has the number above and the words below-left with the animal to their right;
 * a phone stacks number, animal, words; a phone on its side has no height for
 * that, so the words take the left and the number moves right.
 */
export function stageLayout(width: number, height: number, numberWidth: number): StageLayout {
  const aspect = width / Math.max(1, height)
  const viewW = VIEW_HEIGHT * aspect

  if (aspect < 1) {
    // Number across the top, animal under it, words below that.
    const stageScale = Math.min(0.8, (viewW * 0.92) / numberWidth)
    const stageY = VIEW_HEIGHT * 0.285
    const groundY = VIEW_HEIGHT * 0.03
    // It stands in the gap between the ground and the bottom of the number.
    const room = stageY - stageScale * 1.5 - groundY
    const rexScale = Math.min(4.2, viewW * 0.84, room / ANIMAL_HEIGHT)
    return {
      stageX: 0,
      stageY,
      stageScale,
      groundY,
      rexX: viewW * 0.02,
      rexZ: 1.4,
      rexScale,
      rexFrom: viewW * 0.47 + rexScale * 0.56,
      aspect,
      quiet: [0.5, -0.05, 1.5, 0.6],
    }
  }

  if (height < 540) {
    // The whole height is the number's; the words sit on its left.
    const stageScale = Math.min(0.62, (viewW * 0.5) / numberWidth)
    const rexScale = Math.min(3.6, viewW * 0.26)
    return {
      stageX: viewW * 0.22,
      stageY: VIEW_HEIGHT * 0.17,
      stageScale,
      groundY: -VIEW_HEIGHT * 0.34,
      rexX: viewW * 0.27,
      rexZ: 1.6,
      rexScale,
      rexFrom: viewW * 0.44 + rexScale * 0.56,
      aspect,
      quiet: [0, 0.2, 0.62, 1.3],
    }
  }

  const stageScale = Math.min(0.87, (viewW * 0.84) / numberWidth)
  const rexScale = Math.min(3.8, viewW * 0.39)
  return {
    stageX: 0,
    stageY: VIEW_HEIGHT * 0.165,
    stageScale,
    groundY: -VIEW_HEIGHT * 0.245,
    rexX: viewW * 0.25,
    rexZ: 2,
    rexScale,
    rexFrom: viewW * 0.44 + rexScale * 0.56,
    aspect,
    quiet: [0.02, 0.02, 0.66, 0.78],
  }
}

/** The number's position in the page's own column-space, from a point in the world. */
export function toStage(x: number, y: number, layout: StageLayout): [number, number] {
  return [(x - layout.stageX) / layout.stageScale, (y - layout.stageY) / layout.stageScale]
}

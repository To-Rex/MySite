import type { Bone } from 'three'

/**
 * What the two halves of the hero's easter egg say to each other.
 *
 * The tyrannosaur is animated in `HeroScene` and the episode is staged in
 * `Spectacle`, so the hunt has to cross a file boundary. It crosses as numbers,
 * not as poses: the spectacle says *how much* to crouch, run, lunge, thrash and
 * swallow, and where to walk; the idle animation stays the single owner of the
 * skeleton. That is what lets a hunt blend in and out of a walk cycle instead of
 * fighting it for the same bones.
 *
 * A module singleton rather than context or props, for the same reason the
 * pointer is one: it is written and read inside animation frames, where a React
 * update per frame would be absurd — and there is only ever one hero on a page.
 */
export interface Stage {
  /** Published by the tyrannosaur once its rig exists. */
  head: Bone | null
  vent: Bone | null
  foot: Bone | null

  /** 0..1 weights the tyrannosaur blends over its idle. */
  crouch: number
  lunge: number
  snap: number
  toss: number
  /** The kill: a fast, violent head shake with the prey in its jaws. */
  thrash: number
  /** How far the swallowed lump has travelled down the throat, 0..1. */
  gulp: number

  /** Where it has walked to, in arrangement units, relative to its resting spot. */
  travelX: number
  travelY: number
  travelZ: number
  /** Extra yaw on top of its resting heading — π turns it around. */
  facing: number
  /** 0 = its usual amble, 1 = a full run. Shortens the stride and lengthens it. */
  hurry: number

  /** A jolt for the whole arrangement: heavy footfalls, and the jaws closing. */
  shake: number

  /**
   * 0..1: how much the arrangement should hold still for the episode.
   *
   * The sculpture is on a slow turntable and follows the pointer, so left alone
   * "walk off to the right" means whatever +x happens to point at this minute —
   * after a few quiet minutes on the page that is into the screen, and the
   * tyrannosaur simply shrinks into the distance instead of leaving. Holding it
   * square to the camera also gives the hunt a stage to happen on.
   */
  hold: number
}

export const stage: Stage = {
  head: null,
  vent: null,
  foot: null,
  crouch: 0,
  lunge: 0,
  snap: 0,
  toss: 0,
  thrash: 0,
  gulp: 0,
  travelX: 0,
  travelY: 0,
  travelZ: 0,
  facing: 0,
  hurry: 0,
  shake: 0,
  hold: 0,
}

/** Puts the tyrannosaur back in charge of its own pose, exactly where it began. */
export function clearStage(): void {
  stage.crouch = 0
  stage.lunge = 0
  stage.snap = 0
  stage.toss = 0
  stage.thrash = 0
  stage.gulp = 0
  stage.travelX = 0
  stage.travelY = 0
  stage.travelZ = 0
  stage.facing = 0
  stage.hurry = 0
  stage.shake = 0
  stage.hold = 0
}

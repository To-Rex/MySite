import type { Bone } from 'three'

/**
 * What the two halves of the hero's easter egg say to each other.
 *
 * The tyrannosaur is animated in `HeroScene` and the performance is staged in
 * `Spectacle`, so the attack has to cross a file boundary. It crosses as
 * numbers, not as poses: the spectacle says *how much* to crouch, lunge, snap
 * and swallow, and the idle animation stays the single owner of the skeleton.
 * That is what lets an attack blend in and out of a walk cycle instead of
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
  /** How far the swallowed lump has travelled down the throat, 0..1. */
  gulp: number
  /** A brief jolt for the whole arrangement as the jaws close. */
  shake: number
}

export const stage: Stage = {
  head: null,
  vent: null,
  foot: null,
  crouch: 0,
  lunge: 0,
  snap: 0,
  toss: 0,
  gulp: 0,
  shake: 0,
}

/** Puts the tyrannosaur back in charge of its own pose. */
export function clearStage(): void {
  stage.crouch = 0
  stage.lunge = 0
  stage.snap = 0
  stage.toss = 0
  stage.gulp = 0
  stage.shake = 0
}

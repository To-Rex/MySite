import { prewarmCreatures } from './useCreature'
import { VALLEY_DETAIL, VALLEY_SPECIES } from './valleyCast'

/**
 * Builds the valley's cast before anyone asks for it.
 *
 * Imported dynamically by `Valley.tsx` a few seconds after load, so the gate
 * itself stays three-free and the work lands when the page is already idle.
 */
export function warmValley(): void {
  void prewarmCreatures(VALLEY_SPECIES, VALLEY_DETAIL)
}

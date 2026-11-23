import type { ValleyQuality } from '@/lib/valley'
import type { CreatureDetail } from './creatures'

/**
 * How finely the long walk's people and animals are meshed, at each level of
 * quality. A table of its own, with nothing in it but this, so that what asks
 * for those meshes before the walk itself is built (`evoPrefetch.ts`) does not
 * have to bring the whole walk along to find out what to ask for.
 */
export const WALK_DETAIL: Record<ValleyQuality, { people: CreatureDetail; beasts: CreatureDetail }> = {
  low: { people: 'low', beasts: 'low' },
  medium: { people: 'low', beasts: 'low' },
  high: { people: 'medium', beasts: 'medium' },
  ultra: { people: 'high', beasts: 'high' },
}

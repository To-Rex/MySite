import type { TechGroupId, TechId } from '@/i18n/types'

export interface Technology {
  id: TechId
  name: string
  group: TechGroupId
  url: string
  /** Visual weight 0..1 — drives node size in the universe. */
  weight: number
  /** Core technologies sit closer to the center. */
  core?: boolean
}

export const technologies: readonly Technology[] = [
  { id: 'flutter', name: 'Flutter', group: 'mobile', url: 'https://flutter.dev', weight: 1, core: true },
  { id: 'dart', name: 'Dart', group: 'mobile', url: 'https://dart.dev', weight: 0.8, core: true },
  { id: 'python', name: 'Python', group: 'backend', url: 'https://www.python.org', weight: 0.85 },
  { id: 'fastapi', name: 'FastAPI', group: 'backend', url: 'https://fastapi.tiangolo.com', weight: 0.65 },
  { id: 'postgresql', name: 'PostgreSQL', group: 'backend', url: 'https://www.postgresql.org', weight: 0.7 },
  { id: 'react', name: 'React', group: 'web', url: 'https://react.dev', weight: 0.75 },
  { id: 'typescript', name: 'TypeScript', group: 'web', url: 'https://www.typescriptlang.org', weight: 0.7 },
  { id: 'git', name: 'Git', group: 'tools', url: 'https://git-scm.com', weight: 0.55 },
  { id: 'github', name: 'GitHub', group: 'tools', url: 'https://github.com/To-Rex', weight: 0.6 },
] as const

export const techGroups: readonly TechGroupId[] = ['mobile', 'backend', 'web', 'tools']

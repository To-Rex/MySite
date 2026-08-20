import type { Dictionary } from '@/i18n/types'

/** Section anchors in page order. Navigation items are the subset shown in the nav. */
export const SECTION_IDS = {
  home: 'home',
  about: 'about',
  philosophy: 'philosophy',
  skills: 'skills',
  building: 'building',
  projects: 'projects',
  github: 'github',
  presence: 'presence',
  contact: 'contact',
} as const

export type SectionId = (typeof SECTION_IDS)[keyof typeof SECTION_IDS]

export const NAV_ITEMS: readonly { id: SectionId; key: keyof Dictionary['nav'] }[] = [
  { id: 'home', key: 'home' },
  { id: 'about', key: 'about' },
  { id: 'philosophy', key: 'philosophy' },
  { id: 'skills', key: 'skills' },
  { id: 'projects', key: 'projects' },
  { id: 'contact', key: 'contact' },
]

export const NAV_SECTION_IDS: readonly string[] = NAV_ITEMS.map((i) => i.id)

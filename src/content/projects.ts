import type { ProjectCategory, ProjectId, ProjectStatus } from '@/i18n/types'

/**
 * Project data model. Copy (tagline/description) lives in the i18n dictionaries
 * under `projects.items[id]` so it can be translated; everything language-neutral
 * lives here. Fields are intentionally optional — nothing is invented. Fill in
 * real links, media, technologies and status as they become available.
 */
export interface Project {
  id: ProjectId
  title: string
  category: ProjectCategory
  status?: ProjectStatus
  technologies: readonly string[]
  year?: number
  links: {
    github?: string
    demo?: string
  }
  media?: {
    image?: string
    video?: string
    alt?: string
  }
  /** Palette for the generated cover when no media is provided. */
  tone: ProjectTone
  featured?: boolean
}

export type ProjectTone = 'graphite' | 'bronze' | 'slate' | 'sand' | 'ink' | 'stone' | 'ash'

export const projects: readonly Project[] = [
  { id: 'mx-agent', title: 'MX Agent', category: 'mobile', technologies: [], links: {}, tone: 'graphite', featured: true },
  { id: 'mx-delivery', title: 'MX Delivery', category: 'mobile', technologies: [], links: {}, tone: 'bronze' },
  { id: 'mx-supervisor', title: 'MX Supervisor', category: 'mobile', technologies: [], links: {}, tone: 'slate' },
  { id: 'mx-nasiya', title: 'MX Nasiya', category: 'mobile', technologies: [], links: {}, tone: 'sand' },
  { id: 'xms-hotel', title: 'XMS Hotel Management Platform', category: 'platform', technologies: [], links: {}, tone: 'ink', featured: true },
  { id: 'xavsiz-shahar', title: 'Xavsiz Shahar', category: 'platform', technologies: [], links: {}, tone: 'stone' },
  { id: 'torex-local-storage', title: 'Torex Local Storage', category: 'library', technologies: [], links: {}, tone: 'ash' },
]

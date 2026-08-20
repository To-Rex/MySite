import { site } from '@/config/site'

export type SocialId = 'github' | 'instagram' | 'telegram'

export interface SocialLink {
  id: SocialId
  url: string
  handle: string
}

export const socials: readonly SocialLink[] = [
  { id: 'github', url: site.social.github, handle: site.handles.github },
  { id: 'instagram', url: site.social.instagram, handle: site.handles.instagram },
  { id: 'telegram', url: site.social.telegram, handle: site.handles.telegram },
]

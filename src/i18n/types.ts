export const LANGUAGES = ['uz', 'en', 'de', 'ru'] as const
export type Language = (typeof LANGUAGES)[number]
export const DEFAULT_LANGUAGE: Language = 'uz'

export type TechId =
  | 'flutter'
  | 'dart'
  | 'python'
  | 'fastapi'
  | 'postgresql'
  | 'react'
  | 'typescript'
  | 'git'
  | 'github'

export type TechGroupId = 'mobile' | 'backend' | 'web' | 'tools'

export type ProjectId =
  | 'mx-agent'
  | 'mx-delivery'
  | 'mx-supervisor'
  | 'mx-nasiya'
  | 'xms-hotel'
  | 'xavsiz-shahar'
  | 'torex-local-storage'

export type ProjectStatus = 'live' | 'in-progress' | 'concept' | 'archived'
export type ProjectCategory = 'mobile' | 'platform' | 'library' | 'tool' | 'web' | 'other'

export type BuildingId = 'mobile' | 'offline' | 'devtools' | 'backend' | 'ai' | 'storage'

export interface ProjectCopy {
  tagline: string
  /** Full description — leave empty string if not yet known (UI shows a pending note). */
  description: string
}

/**
 * Every language implements this shape. The type is the contract that guarantees
 * no string is left untranslated.
 */
export interface Dictionary {
  meta: {
    title: string
    description: string
    ogTitle: string
    ogDescription: string
    keywords: string[]
    jobTitle: string
  }
  common: {
    name: string
    role: string
    statement: string
    location: string
    profession: string
    skipToContent: string
    menu: string
    close: string
    back: string
    loading: string
    comingSoon: string
    newTab: string
    scroll: string
    year: string
  }
  a11y: {
    mainNav: string
    toggleThemeToLight: string
    toggleThemeToDark: string
    languageSwitcher: string
    openMenu: string
    closeMenu: string
    heroSculpture: string
    techUniverse: string
    socialLinks: string
    contributionGraph: string
    githubAvatar: string
    projectVisual: string
    copyEmail: string
    closeDialog: string
    backToTop: string
  }
  nav: {
    home: string
    about: string
    philosophy: string
    skills: string
    projects: string
    contact: string
  }
  loader: {
    greeting: string
    sub: string
  }
  hero: {
    eyebrow: string
    firstName: string
    lastName: string
    role: string
    statement: string
    ctaProjects: string
    ctaContact: string
    scrollHint: string
    metaLocation: string
    metaProfession: string
    metaSince: string
  }
  about: {
    label: string
    title: string
    paragraphs: string[]
    facts: {
      born: { label: string; value: string }
      profession: { label: string; value: string }
      education: { label: string; value: string }
      location: { label: string; value: string }
    }
    principlesTitle: string
    principles: { title: string; text: string }[]
    marquee: string[]
  }
  philosophy: {
    label: string
    words: string[]
    closing: string
    note: string
  }
  skills: {
    label: string
    title: string
    subtitle: string
    hintDesktop: string
    hintTouch: string
    core: string
    groups: Record<TechGroupId, string>
    items: Record<TechId, { role: string; description: string }>
  }
  building: {
    label: string
    title: string
    subtitle: string
    status: string
    items: Record<BuildingId, { title: string; text: string }>
  }
  projects: {
    label: string
    title: string
    subtitle: string
    open: string
    github: string
    demo: string
    techLabel: string
    statusLabel: string
    categoryLabel: string
    descriptionPending: string
    placeholderNote: string
    statuses: Record<ProjectStatus, string>
    categories: Record<ProjectCategory, string>
    items: Record<ProjectId, ProjectCopy>
  }
  github: {
    label: string
    title: string
    subtitle: string
    loading: string
    error: string
    viewProfile: string
    stats: {
      repos: string
      followers: string
      stars: string
      contributions: string
      since: string
    }
    languagesTitle: string
    languagesNote: string
    recentTitle: string
    contributionsTitle: string
    contributionsTotal: string
    updated: string
    fork: string
    noDescription: string
    lessMore: [string, string]
  }
  presence: {
    label: string
    title: string
    subtitle: string
    platforms: {
      github: { name: string; text: string }
      instagram: { name: string; text: string }
      telegram: { name: string; text: string }
    }
  }
  contact: {
    label: string
    title: string
    subtitle: string
    emailLabel: string
    copy: string
    copied: string
    channels: {
      telegram: string
      instagram: string
      github: string
      email: string
    }
    closing: string
  }
  footer: {
    rights: string
    tagline: string
    top: string
    nav: string
    connect: string
    preferences: string
  }
  theme: {
    label: string
    dark: string
    light: string
  }
  language: {
    label: string
    names: Record<Language, string>
  }
  cursor: {
    open: string
    view: string
    drag: string
    explore: string
  }
}

/**
 * Central site configuration. Everything that identifies Dilshodjon as a brand
 * (names, handles, URLs) lives here so nothing is hard-coded across components.
 */
export const site = {
  /** Public production URL — override with VITE_SITE_URL at build time. */
  url: (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '') ?? 'https://torexdev.uz',
  name: 'Dilshodjon Haydarov',
  firstName: 'Dilshodjon',
  lastName: 'Haydarov',
  handle: 'To-Rex',
  monogram: 'DH',
  email: 'torex.amaki@gmail.com',
  birthDate: '2003-03-31',
  github: {
    user: 'To-Rex',
    url: 'https://github.com/To-Rex',
  },
  social: {
    github: 'https://github.com/To-Rex',
    instagram: 'https://www.instagram.com/torex.dev/',
    // Not the Instagram handle with a different host: Telegram usernames cannot
    // contain a dot, and a t.me link takes the bare name, with no "@".
    telegram: 'https://t.me/torex_dev',
  },
  handles: {
    github: '@To-Rex',
    instagram: '@torex.dev',
    telegram: '@torex_dev',
  },
  /** Brand accent used in structured data / OG (kept in sync with CSS tokens). */
  themeColor: { dark: '#070708', light: '#f7f5f1' },
} as const

export type SocialKey = keyof typeof site.social

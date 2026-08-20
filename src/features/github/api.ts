import { sessionCache } from '@/lib/storage'
import { site } from '@/config/site'

export interface GithubProfile {
  login: string
  name: string | null
  avatar_url: string
  html_url: string
  bio: string | null
  public_repos: number
  followers: number
  following: number
  created_at: string
  location: string | null
  blog: string | null
}

export interface GithubRepo {
  id: number
  name: string
  full_name: string
  html_url: string
  description: string | null
  language: string | null
  stargazers_count: number
  forks_count: number
  fork: boolean
  archived: boolean
  pushed_at: string
  updated_at: string
  homepage: string | null
  topics?: string[]
}

export interface ContributionDay {
  date: string
  count: number
  level: 0 | 1 | 2 | 3 | 4
}

export interface Contributions {
  total: number
  days: ContributionDay[]
}

const API = 'https://api.github.com'
const CONTRIB_API = 'https://github-contributions-api.jogruber.de/v4'
const TTL = 60 * 60 * 1000 // 1 hour
const USER = site.github.user

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

async function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = sessionCache.get<T>(key, TTL)
  if (hit) return hit
  const data = await loader()
  sessionCache.set(key, data)
  return data
}

export function fetchProfile(signal?: AbortSignal) {
  return cached<GithubProfile>(`gh.profile.${USER}`, () => getJson(`${API}/users/${USER}`, signal))
}

/** Up to 200 most recently pushed repositories (two pages, unauthenticated). */
export function fetchRepos(signal?: AbortSignal) {
  return cached<GithubRepo[]>(`gh.repos.${USER}`, async () => {
    const pages = await Promise.all(
      [1, 2].map((page) =>
        getJson<GithubRepo[]>(`${API}/users/${USER}/repos?per_page=100&sort=pushed&type=owner&page=${page}`, signal).catch(
          (err: unknown) => {
            if (page === 1) throw err
            return [] as GithubRepo[]
          },
        ),
      ),
    )
    return pages.flat()
  })
}

interface ContribResponse {
  total: Record<string, number>
  contributions: ContributionDay[]
}

/** Last 12 months of daily contributions via a public mirror of the GitHub graph. */
export function fetchContributions(signal?: AbortSignal) {
  return cached<Contributions>(`gh.contrib.${USER}`, async () => {
    const data = await getJson<ContribResponse>(`${CONTRIB_API}/${USER}?y=last`, signal)
    return { total: data.total.lastYear ?? Object.values(data.total)[0] ?? 0, days: data.contributions }
  })
}

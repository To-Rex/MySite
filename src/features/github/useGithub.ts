import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchContributions, fetchProfile, fetchRepos, type Contributions, type GithubProfile, type GithubRepo } from './api'

export type GithubStatus = 'idle' | 'ready' | 'error'

export interface LanguageShare {
  name: string
  count: number
  share: number
}

export interface GithubData {
  status: GithubStatus
  profile: GithubProfile | null
  repos: GithubRepo[]
  contributions: Contributions | null
  languages: LanguageShare[]
  totalStars: number
  recent: GithubRepo[]
}

/**
 * Loads public GitHub data when `enabled` becomes true (i.e. the section is near
 * the viewport). Every source is independent: a failing one never hides the others.
 * `idle` doubles as the loading state — skeletons show until data (or an error) lands.
 */
export function useGithub(enabled: boolean): GithubData {
  const [status, setStatus] = useState<GithubStatus>('idle')
  const [profile, setProfile] = useState<GithubProfile | null>(null)
  const [repos, setRepos] = useState<GithubRepo[]>([])
  const [contributions, setContributions] = useState<Contributions | null>(null)
  const settled = useRef(false)

  useEffect(() => {
    if (!enabled || settled.current) return
    const controller = new AbortController()
    Promise.allSettled([fetchProfile(controller.signal), fetchRepos(controller.signal), fetchContributions(controller.signal)]).then(
      ([p, r, c]) => {
        if (controller.signal.aborted) return
        settled.current = true
        if (p.status === 'fulfilled') setProfile(p.value)
        if (r.status === 'fulfilled') setRepos(r.value)
        if (c.status === 'fulfilled') setContributions(c.value)
        const anyOk = p.status === 'fulfilled' || r.status === 'fulfilled' || c.status === 'fulfilled'
        setStatus(anyOk ? 'ready' : 'error')
      },
    )
    return () => controller.abort()
  }, [enabled])

  const derived = useMemo(() => {
    const own = repos.filter((r) => !r.fork)
    const counts = new Map<string, number>()
    for (const r of own) if (r.language) counts.set(r.language, (counts.get(r.language) ?? 0) + 1)
    const counted = [...counts.values()].reduce((a, b) => a + b, 0)
    const languages: LanguageShare[] = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({ name, count, share: counted ? count / counted : 0 }))
    const totalStars = repos.reduce((sum, r) => sum + r.stargazers_count, 0)
    const recent = [...own].sort((a, b) => +new Date(b.pushed_at) - +new Date(a.pushed_at)).slice(0, 6)
    return { languages, totalStars, recent }
  }, [repos])

  return { status, profile, repos, contributions, ...derived }
}

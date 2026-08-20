import { useRef } from 'react'
import { useI18n } from '@/i18n/context'
import { site } from '@/config/site'
import { SECTION_IDS } from '@/config/sections'
import { useInViewport } from '@/hooks/useInViewport'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useGithub } from '@/features/github/useGithub'
import { ContributionGraph } from '@/features/github/ContributionGraph'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { Reveal } from '@/components/ui/Reveal'
import { LinkButton } from '@/components/ui/Button'
import { ArrowUpRight, Fork, GitHub, Star } from '@/components/ui/Icons'
import { formatCompact, formatRelative } from '@/lib/format'
import { cn } from '@/lib/cn'

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-xl', className)} aria-hidden />
}

export function GithubActivity() {
  const { t, locale } = useI18n()
  const ref = useRef<HTMLElement>(null)
  const near = useInViewport(ref, '600px')
  const isMobile = useIsMobile()
  const gh = useGithub(near)
  const loading = gh.status === 'idle'

  const stats = [
    { label: t.github.stats.repos, value: gh.profile ? formatCompact(gh.profile.public_repos, locale) : null },
    { label: t.github.stats.followers, value: gh.profile ? formatCompact(gh.profile.followers, locale) : null },
    { label: t.github.stats.stars, value: gh.repos.length ? formatCompact(gh.totalStars, locale) : null },
    { label: t.github.stats.contributions, value: gh.contributions ? formatCompact(gh.contributions.total, locale) : null },
    { label: t.github.stats.since, value: gh.profile ? String(new Date(gh.profile.created_at).getFullYear()) : null },
  ]

  return (
    <section id={SECTION_IDS.github} ref={ref} aria-labelledby="github-title" className="section-y relative">
      <div className="container-x">
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <SectionHeading label={t.github.label} title={t.github.title} subtitle={t.github.subtitle} titleId="github-title" />
          <Reveal delay={0.2} className="self-start md:self-auto">
            <LinkButton href={site.github.url} external variant="outline" arrow>
              <span className="inline-flex items-center gap-2">
                <GitHub size={16} />
                {t.github.viewProfile}
              </span>
            </LinkButton>
          </Reveal>
        </div>

        {gh.status === 'error' ? (
          <Reveal className="mt-14 rounded-[2rem] border border-border p-8 text-fg-2">
            <p>{t.github.error}</p>
          </Reveal>
        ) : (
          <>
            {/* Identity + stats */}
            <Reveal className="mt-14 grid gap-px overflow-hidden rounded-[2rem] border border-border bg-border sm:grid-cols-2 lg:grid-cols-6">
              <div className="flex items-center gap-4 bg-bg p-6 sm:col-span-2 lg:col-span-1 lg:flex-col lg:items-start">
                {loading && !gh.profile ? (
                  <Skeleton className="h-14 w-14 rounded-full" />
                ) : gh.profile ? (
                  <img
                    src={gh.profile.avatar_url}
                    alt={t.a11y.githubAvatar}
                    width={56}
                    height={56}
                    loading="lazy"
                    decoding="async"
                    className="h-14 w-14 rounded-full ring-1 ring-border"
                  />
                ) : null}
                <div>
                  <p className="text-base font-semibold">{site.handles.github}</p>
                  <p className="font-mono text-[0.66rem] tracking-[0.14em] text-fg-3 uppercase">github.com</p>
                </div>
              </div>
              {stats.map((s) => (
                <div key={s.label} className="bg-bg p-6">
                  {s.value === null ? (
                    <Skeleton className="h-9 w-20" />
                  ) : (
                    <p className="text-[2rem] leading-none font-bold tracking-[-0.03em] tabular-nums">{s.value}</p>
                  )}
                  <p className="mt-3 text-[0.78rem] leading-snug text-fg-2">{s.label}</p>
                </div>
              ))}
            </Reveal>

            <div className="mt-6 grid gap-6 lg:grid-cols-12">
              {/* Contributions */}
              <Reveal delay={0.05} className="rounded-[2rem] border border-border p-6 md:p-8 lg:col-span-8">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="text-lg font-semibold tracking-[-0.01em]">{t.github.contributionsTitle}</h3>
                  {gh.contributions && (
                    <p className="text-sm text-fg-2">
                      <span className="font-semibold text-fg tabular-nums">{formatCompact(gh.contributions.total, locale)}</span> {t.github.contributionsTotal}
                    </p>
                  )}
                </div>
                <div className="mt-6">
                  {gh.contributions ? (
                    <ContributionGraph days={gh.contributions.days} weeks={isMobile ? 26 : 53} />
                  ) : (
                    <Skeleton className="h-32 w-full" />
                  )}
                </div>
              </Reveal>

              {/* Languages */}
              <Reveal delay={0.1} className="rounded-[2rem] border border-border p-6 md:p-8 lg:col-span-4">
                <h3 className="text-lg font-semibold tracking-[-0.01em]">{t.github.languagesTitle}</h3>
                <p className="mt-1 text-[0.78rem] text-fg-3">{t.github.languagesNote}</p>
                <ul className="mt-6 flex flex-col gap-4">
                  {gh.languages.length
                    ? gh.languages.map((l, i) => (
                        <li key={l.name}>
                          <div className="flex items-baseline justify-between text-sm">
                            <span className="font-medium">{l.name}</span>
                            <span className="text-fg-3 tabular-nums">{Math.round(l.share * 100)}%</span>
                          </div>
                          <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
                            <div
                              className={cn('lang-bar h-full rounded-full', i === 0 ? 'bg-accent' : 'bg-fg-2')}
                              style={{ width: `${Math.max(4, l.share * 100)}%`, transitionDelay: `${i * 90}ms` }}
                            />
                          </div>
                        </li>
                      ))
                    : Array.from({ length: 5 }).map((_, i) => (
                        <li key={i}>
                          <Skeleton className="h-7 w-full" />
                        </li>
                      ))}
                </ul>
              </Reveal>
            </div>

            {/* Recent repositories */}
            <Reveal delay={0.1} className="mt-6 overflow-hidden rounded-[2rem] border border-border">
              <div className="flex items-baseline justify-between border-b border-border px-6 py-5 md:px-8">
                <h3 className="text-lg font-semibold tracking-[-0.01em]">{t.github.recentTitle}</h3>
              </div>
              <ul className="divide-y divide-border">
                {gh.recent.length
                  ? gh.recent.map((r) => (
                      <li key={r.id}>
                        <a
                          href={r.html_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-cursor="link"
                          className="group grid gap-2 px-6 py-5 transition-colors hover:bg-surface md:grid-cols-12 md:items-center md:gap-6 md:px-8"
                        >
                          <div className="md:col-span-5">
                            <p className="flex items-center gap-2 font-medium">
                              {r.name}
                              <ArrowUpRight size={14} className="text-fg-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                            </p>
                            <p className="mt-1 line-clamp-1 text-sm text-fg-2">{r.description ?? t.github.noDescription}</p>
                          </div>
                          <div className="flex items-center gap-5 text-sm text-fg-2 md:col-span-7 md:justify-end">
                            {r.language && (
                              <span className="inline-flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
                                {r.language}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1.5 tabular-nums">
                              <Star size={13} /> {r.stargazers_count}
                            </span>
                            <span className="inline-flex items-center gap-1.5 tabular-nums">
                              <Fork size={13} /> {r.forks_count}
                            </span>
                            <span className="hidden font-mono text-[0.68rem] tracking-[0.1em] text-fg-3 uppercase sm:inline">
                              {formatRelative(r.pushed_at, locale)}
                            </span>
                          </div>
                        </a>
                      </li>
                    ))
                  : Array.from({ length: 4 }).map((_, i) => (
                      <li key={i} className="px-6 py-5 md:px-8">
                        <Skeleton className="h-10 w-full" />
                      </li>
                    ))}
              </ul>
            </Reveal>
          </>
        )}
      </div>
    </section>
  )
}

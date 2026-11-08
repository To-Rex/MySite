import { motion } from 'motion/react'
import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { site } from '@/config/site'
import { useI18n, isLanguage } from '@/i18n/context'
import { supportsWebGL } from '@/hooks/useDeviceTier'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { NotFoundStage } from '@/components/three/NotFoundStage'
import { Button, LinkButton } from '@/components/ui/Button'
import { SplitText } from '@/components/ui/SplitText'
import { callRoar, callStrike, useNotFoundAct } from '@/lib/notFound'
import { EASE } from '@/lib/motion'

/** How long the words wait for the first meteor before coming up without it. */
const PATIENCE = 2600

/** The address that was asked for, or nothing if it is this page's own. */
function requestedPath(): string {
  const raw = window.location.pathname
  if (raw === '/404' || raw === '/404.html') return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export function NotFound() {
  const { t, switching } = useI18n()
  const reduced = useReducedMotion()
  const act = useNotFoundAct()
  const webgl = supportsWebGL()
  const [patient, setPatient] = useState(true)

  useEffect(() => {
    const giveUp = window.setTimeout(() => setPatient(false), PATIENCE)
    return () => window.clearTimeout(giveUp)
  }, [])

  // There is no <Seo> here: this page is never indexed, so it only needs a
  // title and description that match the language being read.
  useEffect(() => {
    document.title = t.notFound.metaTitle
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.notFound.metaDescription)
  }, [t])

  const { path, home, canGoBack } = useMemo(() => {
    const query = new URLSearchParams(window.location.search).get('lang')
    return {
      path: requestedPath(),
      // A link shared in a language keeps that language on the way out.
      home: isLanguage(query) ? `/?lang=${query}` : '/',
      canGoBack: window.history.length > 1,
    }
  }, [])

  const started = act !== 'load'
  const revealed = !webgl || reduced || started || !patient
  const interactive = webgl && !reduced && act === 'alive'

  const reveal = (delay: number) => ({
    initial: reduced ? false : { opacity: 0, y: 16 },
    animate: revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 },
    transition: { duration: 0.8, ease: EASE, delay },
  })

  // A click, not a pointer-down: on a short phone the page scrolls, and starting a
  // scroll should not bring a meteor down.
  const onStagePress = (event: MouseEvent<HTMLElement>) => {
    if (!interactive || (event.target as Element).closest('a, button')) return
    callStrike((event.clientX / window.innerWidth) * 2 - 1, -((event.clientY / window.innerHeight) * 2 - 1))
  }

  return (
    <>
      <div className="not-found-sky fixed inset-0" aria-hidden />
      <NotFoundStage />
      <div aria-hidden className="not-found-number" data-gone={webgl && started} lang="zxx">
        404
      </div>
      <div className="not-found-scrim" aria-hidden />

      <header className="container-x fixed inset-x-0 top-0 z-20 flex items-center justify-between gap-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <a href={home} aria-label={site.name} data-cursor="link" className="glass inline-flex h-11 items-center gap-3 rounded-full px-1.5 sm:pr-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-fg font-mono text-[0.7rem] font-bold tracking-[0.08em] text-bg">{site.monogram}</span>
          <span className="hidden text-sm font-semibold tracking-[-0.01em] whitespace-nowrap sm:block">{site.name}</span>
        </a>
        <div className="flex items-center gap-2">
          <div className="glass flex h-11 items-center rounded-full px-1">
            <LanguageSwitcher />
          </div>
          <ThemeToggle className="glass h-11 w-11" />
        </div>
      </header>

      <main id="main" className="lang-fade relative z-10" data-switching={switching} onClick={onStagePress}>
        <div className="container-x flex min-h-[100svh] flex-col justify-end pt-[53svh] pb-[clamp(1.25rem,3.6vh,2.5rem)] sm:pt-[44svh] short:mx-0 short:max-w-[52%] short:pt-20 short:pb-4">
          <motion.p {...reveal(0.05)} className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[0.7rem] tracking-[0.16em] text-fg-2 uppercase">
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
              {t.notFound.code}
            </span>
            {path && (
              <code className="max-w-[min(26rem,70vw)] truncate rounded-full border border-border bg-surface px-3 py-1 tracking-[0.04em] normal-case" title={path} aria-label={`${t.notFound.pathLabel}: ${path}`}>
                {path}
              </code>
            )}
          </motion.p>

          <h1 className="display-tight mt-4 max-w-[13ch] text-[clamp(2.4rem,5.3vw,4.7rem)] short:text-[clamp(1.8rem,9vh,2.8rem)]">
            <SplitText text={t.notFound.title} trigger="manual" show={revealed} delay={0.1} stagger={0.05} duration={0.95} />
          </h1>

          <motion.p {...reveal(0.32)} className="mt-4 max-w-[46ch] text-[1rem] leading-snug text-fg-2 md:text-[1.12rem] short:hidden">
            {t.notFound.text}
          </motion.p>

          <motion.div {...reveal(0.46)} className="mt-6 flex flex-wrap items-center gap-3 short:mt-3">
            <LinkButton href={home} size="lg" arrow>
              {t.notFound.home}
            </LinkButton>
            {canGoBack && (
              <Button size="lg" variant="outline" onClick={() => window.history.back()}>
                {t.common.back}
              </Button>
            )}
            {interactive && (
              <Button size="lg" variant="ghost" onClick={callRoar}>
                {t.notFound.roar}
              </Button>
            )}
          </motion.div>

          {interactive && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1.2, ease: EASE }}
              className="mt-5 font-mono text-[0.66rem] tracking-[0.16em] text-fg-3 uppercase short:hidden"
            >
              {t.notFound.hint}
            </motion.p>
          )}
        </div>
      </main>
    </>
  )
}

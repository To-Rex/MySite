import { ReactLenis } from 'lenis/react'
import { useCallback, useEffect, useState } from 'react'
import { ThemeProvider } from '@/theme/ThemeProvider'
import { I18nProvider } from '@/i18n/I18nProvider'
import { useI18n } from '@/i18n/context'
import { IntroContext } from './intro'
import { installPointerTracking } from '@/lib/pointer'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { Seo } from '@/components/seo/Seo'
import { Navigation } from '@/components/layout/Navigation'
import { Footer } from '@/components/layout/Footer'
import { CustomCursor } from '@/components/cursor/CustomCursor'
import { Preloader } from '@/components/loader/Preloader'
import { Companion } from '@/components/three/Companion'
import { Valley } from '@/components/three/Valley'
import { Hero } from '@/sections/Hero'
import { About } from '@/sections/About'
import { Philosophy } from '@/sections/Philosophy'
import { TechUniverse } from '@/sections/TechUniverse'
import { Building } from '@/sections/Building'
import { Projects } from '@/sections/projects/Projects'
import { GithubActivity } from '@/sections/GithubActivity'
import { Presence } from '@/sections/Presence'
import { Contact } from '@/sections/Contact'

function Shell() {
  const { t, switching } = useI18n()
  const reduced = useReducedMotion()
  const [introDone, setIntroDone] = useState(false)
  const release = useCallback(() => setIntroDone(true), [])

  useEffect(() => installPointerTracking(), [])

  return (
    <IntroContext.Provider value={introDone}>
      <Seo />
      <ReactLenis root options={{ lerp: 0.09, smoothWheel: !reduced, syncTouch: false, autoRaf: true }}>
        <a href="#main" className="sr-only-focusable fixed top-4 left-4 z-[2000] rounded-full bg-fg px-4 py-2 text-sm font-medium text-bg">
          {t.common.skipToContent}
        </a>
        <Navigation />
        <main id="main" className="lang-fade" data-switching={switching}>
          <Hero />
          <About />
          <Philosophy />
          <TechUniverse />
          <Building />
          <Projects />
          <GithubActivity />
          <Presence />
          <Contact />
        </main>
        <Footer />
      </ReactLenis>
      <CustomCursor />
      <Companion />
      <Valley />
      <div className="grain" aria-hidden />
      <Preloader onRelease={release} />
    </IntroContext.Provider>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <Shell />
      </I18nProvider>
    </ThemeProvider>
  )
}

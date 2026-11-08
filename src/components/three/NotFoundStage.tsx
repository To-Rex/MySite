import { Component, Suspense, lazy, type ReactNode } from 'react'
import { useDeviceTier, supportsWebGL } from '@/hooks/useDeviceTier'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useI18n } from '@/i18n/context'
import { useTheme } from '@/theme/context'

/**
 * Decides *whether* the 404 page gets its 3D. Like `Companion` and `Valley`,
 * this file has to stay free of three.js: the words of the page should be on
 * screen long before the renderer has finished downloading, and on a browser
 * with no WebGL they are all there is.
 */
const NotFoundScene = lazy(() => import('./NotFoundScene'))

/**
 * A context the driver refuses, or a chunk that has gone since this page was
 * served, must not take the words down with it. This page is what a visitor
 * sees when something has already gone wrong; it should not be able to fail too.
 */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override render() {
    return this.state.failed ? null : this.props.children
  }
}

export function NotFoundStage() {
  const { theme } = useTheme()
  const { t } = useI18n()
  const tier = useDeviceTier()
  const reduced = useReducedMotion()
  if (!supportsWebGL()) return null
  return (
    <div className="fixed inset-0" role="img" aria-label={t.notFound.sceneLabel}>
      <SceneBoundary>
        <Suspense fallback={null}>
          <NotFoundScene theme={theme} tier={tier} reducedMotion={reduced} />
        </Suspense>
      </SceneBoundary>
    </div>
  )
}

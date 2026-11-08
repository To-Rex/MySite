import { useEffect } from 'react'
import { ThemeProvider } from '@/theme/ThemeProvider'
import { I18nProvider } from '@/i18n/I18nProvider'
import { installPointerTracking } from '@/lib/pointer'
import { CustomCursor } from '@/components/cursor/CustomCursor'
import { NotFound } from '@/sections/NotFound'

/**
 * The shell of the 404 page, which is a page of its own rather than a route in
 * the app: Netlify hands out `dist/404.html` for any path it has no file for,
 * and a visitor who has mistyped an address should not download the whole site
 * to be told so.
 */
function Shell() {
  useEffect(() => installPointerTracking(), [])

  return (
    <>
      <NotFound />
      <CustomCursor />
      <div className="grain" aria-hidden />
    </>
  )
}

export default function NotFoundApp() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <Shell />
      </I18nProvider>
    </ThemeProvider>
  )
}

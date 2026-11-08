import { respell } from '@/i18n/newLatin'

// Intl has no data for Uzbek in the new Latin alphabet and answers in the old
// one; `respell` is a no-op for every other locale.

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
]

/** "3 days ago" style relative time, localized via Intl. */
export function formatRelative(date: string | Date, locale: string): string {
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    let duration = (new Date(date).getTime() - Date.now()) / 1000
    for (const division of DIVISIONS) {
      if (Math.abs(duration) < division.amount) return respell(locale, rtf.format(Math.round(duration), division.unit))
      duration /= division.amount
    }
    return ''
  } catch {
    return new Date(date).toLocaleDateString()
  }
}

/** Compact number (1.2k) localized via Intl. */
export function formatCompact(value: number, locale: string): string {
  try {
    return respell(locale, new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value))
  } catch {
    return String(value)
  }
}

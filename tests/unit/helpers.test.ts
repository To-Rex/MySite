// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCALE_TAGS } from '@/i18n/context'
import { LANGUAGES } from '@/i18n/types'
import { cn } from '@/lib/cn'
import { formatCompact, formatRelative } from '@/lib/format'
import { sessionCache, storage } from '@/lib/storage'

describe('cn', () => {
  it('joins what is truthy and drops what is not', () => {
    expect(cn('a', false, null, undefined, '', 'b', 0, 3)).toBe('a b 3')
  })

  it('flattens nested lists and skips ones that come out empty', () => {
    expect(cn('a', ['b', [false, 'c']], [null, []])).toBe('a b c')
  })
})

describe('format', () => {
  afterEach(() => vi.useRealTimers())

  it('formats relative time across units', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
    expect(formatRelative('2026-06-15T11:59:30Z', 'en')).toBe('30 seconds ago')
    expect(formatRelative('2026-06-15T09:00:00Z', 'en')).toBe('3 hours ago')
    expect(formatRelative('2026-06-14T12:00:00Z', 'en')).toBe('yesterday')
    expect(formatRelative('2026-06-01T12:00:00Z', 'en')).toBe('2 weeks ago')
    expect(formatRelative('2026-03-15T12:00:00Z', 'en')).toBe('3 months ago')
    expect(formatRelative('2024-06-15T12:00:00Z', 'en')).toBe('2 years ago')
    expect(formatRelative('2026-06-18T12:00:00Z', 'en')).toBe('in 3 days')
  })

  it.each(LANGUAGES)('produces text in %s', (lang) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
    expect(formatRelative('2026-06-10T12:00:00Z', LOCALE_TAGS[lang])).not.toBe('')
    expect(formatCompact(12_345, LOCALE_TAGS[lang])).not.toBe('')
  })

  it('compacts numbers and survives a locale Intl does not know', () => {
    expect(formatCompact(1234, 'en')).toBe('1.2K')
    expect(formatCompact(7, 'en')).toBe('7')
    expect(formatCompact(1234, 'not a locale')).toBe('1234')
  })
})

describe('storage', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('round-trips a value', () => {
    storage.set('k', 'v')
    expect(storage.get('k')).toBe('v')
    storage.remove('k')
    expect(storage.get('k')).toBeNull()
  })

  it('never throws when the browser refuses storage (private mode, blocked cookies)', () => {
    const refuse = () => {
      throw new DOMException('denied', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(refuse)
    expect(storage.get('k')).toBeNull()
    expect(() => storage.set('k', 'v')).not.toThrow()
    expect(() => storage.remove('k')).not.toThrow()
    expect(sessionCache.get('k', 1000)).toBeNull()
    expect(() => sessionCache.set('k', { a: 1 })).not.toThrow()
  })

  it('serves a cached value until it is older than its lifetime', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
    sessionCache.set('k', { stars: 3 })
    expect(sessionCache.get('k', 60_000)).toEqual({ stars: 3 })
    vi.setSystemTime(new Date('2026-06-15T12:00:59Z'))
    expect(sessionCache.get('k', 60_000)).toEqual({ stars: 3 })
    vi.setSystemTime(new Date('2026-06-15T12:01:01Z'))
    expect(sessionCache.get('k', 60_000)).toBeNull()
  })

  it('treats a corrupted entry as a miss', () => {
    sessionStorage.setItem('k', '{not json')
    expect(sessionCache.get('k', 60_000)).toBeNull()
  })
})

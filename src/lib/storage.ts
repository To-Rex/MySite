/** localStorage wrapper that never throws (private mode, disabled storage, SSR). */
export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      /* ignore */
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  },
}

/** sessionStorage-backed JSON cache with TTL, used for API responses. */
export const sessionCache = {
  get<T>(key: string, maxAgeMs: number): T | null {
    try {
      const raw = window.sessionStorage.getItem(key)
      if (!raw) return null
      const parsed = JSON.parse(raw) as { at: number; data: T }
      if (Date.now() - parsed.at > maxAgeMs) return null
      return parsed.data
    } catch {
      return null
    }
  },
  set<T>(key: string, data: T): void {
    try {
      window.sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data }))
    } catch {
      /* ignore */
    }
  },
}

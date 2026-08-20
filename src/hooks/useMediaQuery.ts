import { useCallback, useSyncExternalStore } from 'react'

/** Reactive matchMedia hook (SSR-safe, no re-render storms). */
export function useMediaQuery(query: string, serverDefault = false): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    [query],
  )
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])
  return useSyncExternalStore(subscribe, getSnapshot, () => serverDefault)
}

export const useIsTouch = () => useMediaQuery('(pointer: coarse)')
export const useIsFinePointer = () => useMediaQuery('(pointer: fine)')
export const useIsMobile = () => useMediaQuery('(max-width: 767px)')

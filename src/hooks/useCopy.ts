import { useCallback, useEffect, useRef, useState } from 'react'

/** Clipboard copy with a short "copied" state. */
export function useCopy(resetMs = 1800) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setCopied(false), resetMs)
      } catch {
        /* clipboard unavailable — nothing to do */
      }
    },
    [resetMs],
  )
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    [],
  )
  return { copied, copy }
}

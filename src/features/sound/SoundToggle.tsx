import { Button } from '@/components/ui/Button'
import { Volume, VolumeOff } from '@/components/ui/Icons'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { toggleSound, useSoundStatus } from './store'

interface SoundToggleProps {
  /** An icon in a glass circle, for laying over a scene, rather than a page button. */
  compact?: boolean
  /** What to do the moment it is turned on, so that the visitor hears something at once. */
  onEnable?: () => void
  className?: string
}

/**
 * Sound on and off. While the browser is still holding sound back it says so in
 * words, because a page cannot tell you it has a voice any other way; afterwards
 * it shrinks to an icon.
 */
export function SoundToggle({ compact = false, onEnable, className }: SoundToggleProps) {
  const { t } = useI18n()
  const status = useSoundStatus()
  if (status === 'unavailable') return null

  const on = status === 'on'
  const label = on ? t.common.soundOff : t.common.soundOn

  const onClick = () => {
    toggleSound()
    if (!on) onEnable?.()
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={on}
        aria-label={label}
        title={label}
        data-sound={status}
        data-cursor="link"
        className={cn('glass flex h-11 w-11 items-center justify-center rounded-full text-fg transition-colors hover:bg-surface-hover', className)}
      >
        {on ? <Volume size={18} /> : <VolumeOff size={18} />}
      </button>
    )
  }

  return (
    <Button
      size="lg"
      variant={on ? 'ghost' : 'outline'}
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      data-sound={status}
      className={cn(status === 'locked' ? 'sound-invite' : 'w-[3.25rem] px-0!', className)}
    >
      <span className="flex items-center gap-2.5">
        {on ? <Volume size={19} /> : <VolumeOff size={19} />}
        {status === 'locked' && <span>{t.common.soundOn}</span>}
      </span>
    </Button>
  )
}

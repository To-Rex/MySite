import { Button } from '@/components/ui/Button'
import { Volume, VolumeOff } from '@/components/ui/Icons'
import { useI18n } from '@/i18n/context'
import { callRoar, callStrike } from '@/lib/notFound'
import { toggleSound, useSoundStatus } from './store'

/**
 * Sound on and off for the 404 page. While the browser is still holding sound
 * back it says so in words, because a page cannot tell you it has a voice any
 * other way; afterwards it shrinks to an icon. Turning it on is answered: there
 * is no point having just asked to hear a tyrannosaur and then waiting for one.
 */
export function SoundToggle() {
  const { t } = useI18n()
  const status = useSoundStatus()
  if (status === 'unavailable') return null

  const on = status === 'on'
  const label = on ? t.notFound.soundOff : t.notFound.soundOn

  const onClick = () => {
    toggleSound()
    if (!on) {
      callStrike(0.12, 0.4)
      callRoar()
    }
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
      className={status === 'locked' ? 'sound-invite' : 'w-[3.25rem] px-0!'}
    >
      <span className="flex items-center gap-2.5">
        {on ? <Volume size={19} /> : <VolumeOff size={19} />}
        {status === 'locked' && <span>{t.notFound.soundOn}</span>}
      </span>
    </Button>
  )
}

import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { SplitText } from './SplitText'
import { Reveal } from './Reveal'

interface SectionHeadingProps {
  label: string
  title: string
  subtitle?: string
  align?: 'left' | 'center'
  className?: string
  titleId?: string
  children?: ReactNode
}

/** Consistent section opener: mono eyebrow, split-reveal title, optional subtitle. */
export function SectionHeading({ label, title, subtitle, align = 'left', className, titleId, children }: SectionHeadingProps) {
  return (
    <div className={cn('flex flex-col gap-5', align === 'center' && 'items-center text-center', className)}>
      <Reveal className="flex items-center gap-3" y={10}>
        <span className="h-px w-8 bg-accent/80" aria-hidden />
        <span className="eyebrow">{label}</span>
      </Reveal>
      <h2
        id={titleId}
        className={cn(
          'display-tight max-w-[14ch] text-[clamp(2.4rem,6vw,5.25rem)] text-balance',
          align === 'center' && 'max-w-[18ch]',
        )}
      >
        <SplitText text={title} stagger={0.05} />
      </h2>
      {subtitle && (
        <Reveal
          delay={0.15}
          className={cn('max-w-[52ch] text-[1.05rem] leading-relaxed text-fg-2 md:text-lg', align === 'center' && 'mx-auto')}
        >
          <p>{subtitle}</p>
        </Reveal>
      )}
      {children}
    </div>
  )
}

import { cn } from '@/lib/cn'

interface MarqueeProps {
  items: readonly string[]
  className?: string
  separator?: string
}

/** Calm infinite ticker. Pauses on hover; static with reduced motion. */
export function Marquee({ items, className, separator = '·' }: MarqueeProps) {
  const row = [...items, ...items]
  return (
    <div className={cn('marquee mask-fade-x overflow-hidden', className)} aria-hidden>
      <div className="marquee-track gap-10">
        {row.map((item, i) => (
          <span
            key={`${item}-${i}`}
            className="flex items-center gap-10 text-[clamp(1rem,1.6vw,1.25rem)] font-medium tracking-[-0.01em] whitespace-nowrap text-fg-2"
          >
            {item}
            <span className="text-accent">{separator}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

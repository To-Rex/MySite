import { useInView } from 'motion/react'
import { useMemo, useRef, type CSSProperties } from 'react'
import type { ContributionDay } from './api'
import { useI18n } from '@/i18n/context'

interface ContributionGraphProps {
  days: ContributionDay[]
  /** Number of trailing weeks to display (53 = full year). */
  weeks?: number
}

/** GitHub-style heat grid rendered in the site's own palette; cells bloom in by column. */
export function ContributionGraph({ days, weeks = 53 }: ContributionGraphProps) {
  const { t, locale } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.3 })

  const { columns, months } = useMemo(() => {
    if (!days.length) return { columns: [] as (ContributionDay | null)[][], months: [] as { col: number; label: string }[] }
    const first = days[0]!
    const offset = new Date(first.date + 'T00:00:00').getDay() // 0 = Sunday
    const padded: (ContributionDay | null)[] = [...Array<null>(offset).fill(null), ...days]
    const cols: (ContributionDay | null)[][] = []
    for (let i = 0; i < padded.length; i += 7) cols.push(padded.slice(i, i + 7))
    const visible = cols.slice(-weeks)
    const fmt = new Intl.DateTimeFormat(locale, { month: 'short' })
    const labels: { col: number; label: string }[] = []
    let lastMonth = -1
    visible.forEach((col, ci) => {
      const day = col.find((d) => d !== null)
      if (!day) return
      const m = new Date(day.date + 'T00:00:00').getMonth()
      if (m !== lastMonth) {
        labels.push({ col: ci, label: fmt.format(new Date(day.date + 'T00:00:00')) })
        lastMonth = m
      }
    })
    // Drop a label that would collide with the next one (partial first month).
    const spaced = labels.filter((l, i) => i === labels.length - 1 || (labels[i + 1]?.col ?? 99) - l.col >= 3)
    return { columns: visible, months: spaced }
  }, [days, weeks, locale])

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }), [locale])

  return (
    <div ref={ref} data-visible={inView} className="contrib" role="img" aria-label={t.a11y.contributionGraph}>
      <div className="contrib-months" aria-hidden style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}>
        {months.map((m) => (
          <span key={`${m.col}-${m.label}`} style={{ gridColumnStart: m.col + 1 }}>
            {m.label}
          </span>
        ))}
      </div>
      <div className="contrib-grid" style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}>
        {columns.map((col, ci) => (
          <div key={ci} className="contrib-col">
            {Array.from({ length: 7 }).map((_, ri) => {
              const d = col[ri] ?? null
              return (
                <span
                  key={ri}
                  className="contrib-cell"
                  data-level={d ? d.level : 'empty'}
                  style={{ '--d': `${ci * 14}ms` } as CSSProperties}
                  title={d ? `${dateFmt.format(new Date(d.date + 'T00:00:00'))}: ${d.count}` : undefined}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className="contrib-legend" aria-hidden>
        <span>{t.github.lessMore[0]}</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className="contrib-cell is-static" data-level={l} />
        ))}
        <span>{t.github.lessMore[1]}</span>
      </div>
    </div>
  )
}

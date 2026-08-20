import { motion, type Variants } from 'motion/react'
import type { Project } from '@/content/projects'
import { useI18n } from '@/i18n/context'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { TiltCard } from '@/components/ui/TiltCard'
import { ArrowUpRight } from '@/components/ui/Icons'
import { cn } from '@/lib/cn'
import { EASE } from '@/lib/motion'
import { ProjectCover } from './ProjectCover'

interface ProjectCardProps {
  project: Project
  index: number
  onOpen: (project: Project) => void
  className?: string
}

export function ProjectCard({ project, index, onOpen, className }: ProjectCardProps) {
  const { t } = useI18n()
  const reduced = useReducedMotion()
  const copy = t.projects.items[project.id]
  const delay = (index % 3) * 0.08

  // The cover is fully clipped before its reveal, so it must not observe the
  // viewport itself — it inherits the card's in-view state via variants.
  const cardVariants: Variants = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.9, ease: EASE, delay } },
  }
  const coverVariants: Variants = {
    hidden: { clipPath: 'inset(0 0 100% 0)' },
    visible: { clipPath: 'inset(0 0 0% 0)', transition: { duration: 1.1, ease: EASE, delay: delay + 0.15 } },
  }

  return (
    <motion.li
      className={cn('list-none', className)}
      initial={reduced ? false : 'hidden'}
      whileInView="visible"
      viewport={{ once: true, amount: 0.2 }}
      variants={cardVariants}
    >
      <TiltCard className="h-full rounded-[1.75rem]">
        <article className="group/card flex h-full flex-col overflow-hidden rounded-[1.75rem] border border-border bg-bg-2 transition-[border-color,box-shadow] duration-500 hover:border-border-2 hover:shadow-float">
          <button
            type="button"
            onClick={() => onOpen(project)}
            className="flex h-full flex-col text-left"
            data-cursor="text"
            data-cursor-label="open"
            aria-label={`${project.title} — ${t.projects.open}`}
          >
            <div className="relative aspect-[4/3] w-full overflow-hidden">
              <motion.div className="absolute inset-0" variants={coverVariants}>
                <ProjectCover
                  project={project}
                  index={index}
                  alt={`${project.title} — ${t.a11y.projectVisual}`}
                  className="h-full w-full transition-transform duration-700 ease-[var(--ease-out)] group-hover/card:scale-[1.04]"
                />
              </motion.div>
            </div>

            <div className="flex flex-1 flex-col p-6 md:p-7">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-border px-2.5 py-1 font-mono text-[0.62rem] tracking-[0.14em] text-fg-2 uppercase">
                  {t.projects.categories[project.category]}
                </span>
                {project.status && (
                  <span className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[0.62rem] tracking-[0.14em] text-fg-2 uppercase">
                    {t.projects.statuses[project.status]}
                  </span>
                )}
              </div>
              <h3 className="mt-5 text-[1.35rem] leading-tight font-semibold tracking-[-0.02em] text-balance">{project.title}</h3>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-fg-2">{copy.tagline}</p>
              <div className="mt-auto flex items-center justify-between pt-6">
                <span className="text-sm font-medium text-fg-2 transition-colors group-hover/card:text-fg">{t.projects.open}</span>
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-fg-2 transition-[background-color,color,transform] duration-500 ease-[var(--ease-out)] group-hover/card:rotate-45 group-hover/card:bg-fg group-hover/card:text-bg">
                  <ArrowUpRight size={16} />
                </span>
              </div>
            </div>
          </button>
        </article>
      </TiltCard>
    </motion.li>
  )
}

import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import type { Project } from '@/content/projects'
import { projects } from '@/content/projects'
import { useI18n } from '@/i18n/context'
import { useScrollLock } from '@/hooks/useScrollLock'
import { LinkButton } from '@/components/ui/Button'
import { Close } from '@/components/ui/Icons'
import { EASE } from '@/lib/motion'
import { ProjectCover } from './ProjectCover'

interface ProjectDialogProps {
  project: Project | null
  onClose: () => void
}

/** Expanded project view. Esc / backdrop closes; focus is moved in and restored by the caller. */
export function ProjectDialog({ project, onClose }: ProjectDialogProps) {
  const { t } = useI18n()
  const closeButton = useRef<HTMLButtonElement>(null)
  const open = project !== null
  useScrollLock(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const id = window.setTimeout(() => closeButton.current?.focus(), 80)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(id)
    }
  }, [open, onClose])

  const index = project ? projects.findIndex((p) => p.id === project.id) : 0
  const copy = project ? t.projects.items[project.id] : null
  const meta = project
    ? [
        { label: t.projects.categoryLabel, value: t.projects.categories[project.category] },
        project.status ? { label: t.projects.statusLabel, value: t.projects.statuses[project.status] } : null,
        project.year ? { label: t.common.year, value: String(project.year) } : null,
      ].filter((x): x is { label: string; value: string } => x !== null)
    : []

  return (
    <AnimatePresence>
      {project && copy && (
        <motion.div
          key="project-dialog"
          className="fixed inset-0 z-[150] flex items-end justify-center p-0 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3, ease: EASE } }}
          transition={{ duration: 0.4, ease: EASE }}
        >
          <button type="button" className="absolute inset-0 bg-bg/70 backdrop-blur-md" aria-label={t.a11y.closeDialog} onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-dialog-title"
            className="relative max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-[2rem] border border-border bg-bg-2 shadow-float sm:rounded-[2rem]"
            data-lenis-prevent
            initial={{ y: 40, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 24, scale: 0.98, opacity: 0, transition: { duration: 0.3, ease: EASE } }}
            transition={{ duration: 0.55, ease: EASE }}
          >
            <button
              ref={closeButton}
              type="button"
              onClick={onClose}
              aria-label={t.a11y.closeDialog}
              data-cursor="link"
              className="glass absolute top-4 right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full text-fg transition-colors hover:bg-surface-hover"
            >
              <Close size={18} />
            </button>

            <div className="aspect-[16/9] w-full overflow-hidden">
              <ProjectCover project={project} index={index} alt={`${project.title} — ${t.a11y.projectVisual}`} className="h-full w-full" />
            </div>

            <div className="p-7 md:p-10">
              <div className="flex flex-wrap items-center gap-2">
                {meta.map((m) => (
                  <span key={m.label} className="rounded-full border border-border px-2.5 py-1 font-mono text-[0.62rem] tracking-[0.14em] text-fg-2 uppercase">
                    {m.value}
                  </span>
                ))}
              </div>
              <h3 id="project-dialog-title" className="mt-5 text-[clamp(1.8rem,4vw,2.6rem)] leading-tight font-bold tracking-[-0.03em] text-balance">
                {project.title}
              </h3>
              <p className="mt-2 text-lg text-fg-2">{copy.tagline}</p>

              <div className="mt-7 border-t border-border pt-7">
                {copy.description ? (
                  <p className="text-[1.05rem] leading-relaxed text-fg-2">{copy.description}</p>
                ) : (
                  <p className="flex items-center gap-3 text-[0.95rem] text-fg-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                    {t.projects.descriptionPending}
                  </p>
                )}
              </div>

              {project.technologies.length > 0 && (
                <div className="mt-7">
                  <p className="eyebrow mb-3">{t.projects.techLabel}</p>
                  <ul className="flex flex-wrap gap-2">
                    {project.technologies.map((tech) => (
                      <li key={tech} className="rounded-full bg-surface-2 px-3 py-1 text-sm font-medium">
                        {tech}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(project.links.github || project.links.demo) && (
                <div className="mt-8 flex flex-wrap gap-3">
                  {project.links.demo && (
                    <LinkButton href={project.links.demo} external arrow>
                      {t.projects.demo}
                    </LinkButton>
                  )}
                  {project.links.github && (
                    <LinkButton href={project.links.github} external variant="outline" arrow>
                      {t.projects.github}
                    </LinkButton>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

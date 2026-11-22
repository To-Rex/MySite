import { useCallback, useRef, useState } from 'react'
import { useI18n } from '@/i18n/context'
import { SECTION_IDS } from '@/config/sections'
import { projects, type Project } from '@/content/projects'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { Reveal } from '@/components/ui/Reveal'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { cn } from '@/lib/cn'
import { ProjectCard } from './ProjectCard'
import { ProjectDialog } from './ProjectDialog'
import { ProjectGallery } from './ProjectGallery'

export function Projects() {
  const { t } = useI18n()
  const [open, setOpen] = useState<Project | null>(null)
  const lastTrigger = useRef<HTMLElement | null>(null)
  const reduced = useReducedMotion()
  // A phone on its side has no height to pin a row of cards in.
  const roomy = useMediaQuery('(min-height: 34rem)', true)
  const gallery = !reduced && roomy

  const onOpen = useCallback((project: Project) => {
    lastTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setOpen(project)
  }, [])

  const onClose = useCallback(() => {
    setOpen(null)
    // Return focus to the card that opened the dialog.
    window.setTimeout(() => lastTrigger.current?.focus(), 50)
  }, [])

  const pendingCount = projects.filter((p) => !t.projects.items[p.id].description).length

  const heading = <SectionHeading label={t.projects.label} title={t.projects.title} subtitle={t.projects.subtitle} titleId="projects-title" />
  const note = pendingCount > 0 && (
    <Reveal className="mt-8 flex items-center gap-3 font-mono text-[0.68rem] tracking-[0.14em] text-fg-3 uppercase" y={8}>
      <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
      {t.projects.placeholderNote}
    </Reveal>
  )

  return (
    <section id={SECTION_IDS.projects} aria-labelledby="projects-title" className={cn('relative', !gallery && 'section-y')}>
      {gallery ? (
        <ProjectGallery
          word={t.projects.label}
          onOpen={onOpen}
          intro={
            <>
              {heading}
              {note}
            </>
          }
        />
      ) : (
        // Reduced motion, or no room to pin: the plain grid, every card in place.
        <div className="container-x">
          {heading}
          <ul className="mt-14 grid grid-flow-dense gap-5 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project, i) => (
              <ProjectCard
                key={project.id}
                project={project}
                index={i}
                onOpen={onOpen}
                className={cn(project.featured && 'lg:col-span-2')}
              />
            ))}
          </ul>
          {note}
        </div>
      )}

      <ProjectDialog project={open} onClose={onClose} />
    </section>
  )
}

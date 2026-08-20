import type { Project } from '@/content/projects'
import { cn } from '@/lib/cn'

interface ProjectCoverProps {
  project: Project
  index: number
  alt: string
  className?: string
}

/**
 * Project visual. Uses real media when provided; otherwise renders a generated
 * editorial cover (tone gradient, index, monogram) so nothing is fabricated.
 */
export function ProjectCover({ project, index, alt, className }: ProjectCoverProps) {
  const initials = project.title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <div className={cn('cover relative overflow-hidden', `tone-${project.tone}`, className)}>
      {project.media?.image ? (
        <img src={project.media.image} alt={project.media.alt ?? alt} loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <>
          <div className="cover-grid absolute inset-0" aria-hidden />
          <span className="absolute top-5 left-6 font-mono text-[0.68rem] tracking-[0.18em] text-fg/60" aria-hidden>
            {String(index + 1).padStart(2, '0')}
          </span>
          <span
            className="absolute right-5 bottom-3 font-mono text-[clamp(4rem,9vw,7rem)] leading-none font-bold tracking-[-0.06em] text-fg/[0.06] select-none"
            aria-hidden
          >
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="glass absolute top-1/2 left-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[0.95rem] font-bold tracking-[0.04em] text-fg">
            {initials}
          </span>
          <span className="sr-only">{alt}</span>
        </>
      )}
    </div>
  )
}

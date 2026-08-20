import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Magnetic } from './Magnetic'
import { ArrowUpRight } from './Icons'

export type ButtonVariant = 'primary' | 'outline' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-fg text-bg border border-transparent hover:bg-accent hover:text-accent-ink',
  outline: 'bg-transparent text-fg border border-border-2 hover:border-fg/50 hover:bg-surface',
  ghost: 'bg-transparent text-fg-2 border border-transparent hover:text-fg hover:bg-surface',
}

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-[0.8rem] gap-1.5',
  md: 'h-11 px-5 text-[0.9rem] gap-2',
  lg: 'h-[3.25rem] px-7 text-[0.95rem] gap-2.5',
}

const baseClass =
  'group/btn relative inline-flex items-center justify-center rounded-full font-medium tracking-[-0.01em] whitespace-nowrap select-none transition-[background-color,color,border-color] duration-300 ease-[var(--ease-out)]'

interface StyleProps {
  variant?: ButtonVariant
  size?: ButtonSize
  arrow?: boolean
  /** Wrap in a magnetic field (desktop only). */
  magnetic?: boolean
}

function classes({ variant = 'primary', size = 'md' }: StyleProps, className?: string) {
  return cn(baseClass, variantClass[variant], sizeClass[size], className)
}

function Inner({ children, arrow }: { children: ReactNode; arrow?: boolean }) {
  return (
    <>
      <span>{children}</span>
      {arrow && (
        <span className="relative h-4 w-4 overflow-hidden" aria-hidden>
          <ArrowUpRight
            size={16}
            className="absolute inset-0 transition-transform duration-300 ease-[var(--ease-out)] group-hover/btn:-translate-y-4 group-hover/btn:translate-x-4"
          />
          <ArrowUpRight
            size={16}
            className="absolute inset-0 -translate-x-4 translate-y-4 transition-transform duration-300 ease-[var(--ease-out)] group-hover/btn:translate-x-0 group-hover/btn:translate-y-0"
          />
        </span>
      )}
    </>
  )
}

function wrap(magnetic: boolean, node: ReactNode) {
  return magnetic ? <Magnetic>{node}</Magnetic> : node
}

type ButtonProps = StyleProps & ButtonHTMLAttributes<HTMLButtonElement>

/** Pill button with a restrained arrow swap and optional magnetism. */
export function Button({ variant, size, arrow, magnetic = true, className, children, type = 'button', ...rest }: ButtonProps) {
  return wrap(
    magnetic,
    <button type={type} className={classes({ variant, size }, className)} data-cursor="link" {...rest}>
      <Inner arrow={arrow}>{children}</Inner>
    </button>,
  )
}

type LinkButtonProps = StyleProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; external?: boolean }

/** Same visual language as Button, rendered as an anchor. */
export function LinkButton({ variant, size, arrow, magnetic = true, className, children, external, ...rest }: LinkButtonProps) {
  return wrap(
    magnetic,
    <a
      className={classes({ variant, size }, className)}
      data-cursor="link"
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      {...rest}
    >
      <Inner arrow={arrow}>{children}</Inner>
    </a>,
  )
}

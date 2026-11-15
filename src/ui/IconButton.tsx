import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string
  /** Display form of the keyboard shortcut, e.g. "V" or "Ctrl+Z". */
  shortcut?: string
  /** aria-keyshortcuts value, e.g. "V" or "Control+Z Meta+Z". */
  keys?: string
  pressed?: boolean
  tipSide?: 'right' | 'top' | 'bottom' | 'left'
  children: ReactNode
}

/** Icon-only button: always has an accessible name, and a hover/focus tip. */
export function IconButton({ label, shortcut, keys, pressed, tipSide = 'top', className, children, ...rest }: Props) {
  const tip = shortcut ? `${label} (${shortcut})` : label
  return (
    <button
      type="button"
      className={`icon-btn${className ? ` ${className}` : ''}`}
      aria-label={label}
      aria-keyshortcuts={keys}
      aria-pressed={pressed}
      data-tip={tip}
      data-tip-side={tipSide}
      {...rest}
    >
      {children}
    </button>
  )
}

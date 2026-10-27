import type { ComponentChildren } from 'preact'

import './segmented.css'

interface SegmentedOption<T extends string> {
  readonly value: T
  readonly label: string
  /** Drawn before the label; the label then hides in a narrow row and stays the title. */
  readonly icon?: ComponentChildren
  readonly badge?: number
  readonly isDisabled?: boolean
  /** Says why a disabled option cannot be picked. */
  readonly title?: string
}

interface SegmentedProps<T extends string> {
  readonly label: string
  readonly title?: string
  readonly className?: string
  /** Options that switch a view, not a setting: a tablist with the open one selected. */
  readonly isTabs?: boolean
  readonly value: T | undefined
  readonly options: readonly SegmentedOption<T>[]
  readonly onChange: (value: T) => void
}

/** A row of exclusive choices, one pressed; or, as tabs, one selected. */
export function Segmented<T extends string>({
  label,
  title,
  className,
  isTabs = false,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  const classes = className === undefined ? 'seg' : `seg ${className}`
  const buttons = options.map((option) => {
    const isOn = option.value === value

    return (
      <button
        key={option.value}
        type="button"
        class={isOn ? 'is-on' : ''}
        {...(isTabs ? { role: 'tab', 'aria-selected': isOn } : { 'aria-pressed': isOn })}
        disabled={option.isDisabled}
        title={option.title ?? (option.icon === undefined ? undefined : option.label)}
        aria-label={option.icon === undefined ? undefined : option.label}
        onClick={() => onChange(option.value)}
      >
        {option.icon}
        <span class="seg-label">{option.label}</span>
        {option.badge !== undefined && option.badge > 0 && (
          <span class="seg-badge">{option.badge}</span>
        )}
      </button>
    )
  })

  if (isTabs) {
    return (
      <div class={classes} role="tablist" aria-label={label} title={title}>
        {buttons}
      </div>
    )
  }

  return (
    <fieldset class={classes} title={title}>
      <legend class="sr">{label}</legend>
      {buttons}
    </fieldset>
  )
}

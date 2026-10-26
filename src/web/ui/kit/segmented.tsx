import './segmented.css'

interface SegmentedOption<T extends string> {
  readonly value: T
  readonly label: string
  readonly isDisabled?: boolean
  /** Says why a disabled option cannot be picked. */
  readonly title?: string
}

interface SegmentedProps<T extends string> {
  readonly label: string
  readonly title?: string
  readonly className?: string
  readonly value: T
  readonly options: readonly SegmentedOption<T>[]
  readonly onChange: (value: T) => void
}

/** A row of exclusive choices, one pressed. */
export function Segmented<T extends string>({
  label,
  title,
  className,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <fieldset class={className === undefined ? 'seg' : `seg ${className}`} title={title}>
      <legend class="sr">{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          class={option.value === value ? 'is-on' : ''}
          aria-pressed={option.value === value}
          disabled={option.isDisabled}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  )
}

import './segmented.css'

interface SegmentedOption<T extends string> {
  readonly value: T
  readonly label: string
}

interface SegmentedProps<T extends string> {
  readonly label: string
  readonly value: T
  readonly options: readonly SegmentedOption<T>[]
  readonly onChange: (value: T) => void
}

/** A row of exclusive choices, one pressed. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <fieldset class="seg">
      <legend class="sr">{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          class={option.value === value ? 'is-on' : ''}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  )
}

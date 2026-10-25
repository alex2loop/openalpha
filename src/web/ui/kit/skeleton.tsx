import './skeleton.css'

const DEFAULT_LINES = 3

/** Grey bars where a block's figures will be, while its first read is under way. */
export function Skeleton({ lines = DEFAULT_LINES }: { readonly lines?: number }) {
  return (
    <div class="skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, line) => (
        // The bars are identical and never reorder.
        <span key={line} class="skeleton-bar" />
      ))}
    </div>
  )
}

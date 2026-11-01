import './status-line.css'

/** One line in place of the page while it loads, or when it cannot. */
export function StatusLine({ text }: { readonly text: string }) {
  return (
    <div class="status-line" role="status">
      {text}
    </div>
  )
}

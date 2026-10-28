import { useEffect, useRef } from 'preact/hooks'

/** The daemon's sentence under the field it refused, brought into view when it appears: a long
 *  dialog's Save sits far from the field. */
export function FieldNote({ message }: { readonly message: string | undefined }) {
  const note = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (message !== undefined) {
      note.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [message])

  return message === undefined ? null : (
    <p ref={note} class="failure-line" role="alert">
      {message}
    </p>
  )
}

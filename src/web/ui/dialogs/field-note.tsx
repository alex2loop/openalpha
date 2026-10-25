/** The daemon's sentence under the field it refused. */
export function FieldNote({ message }: { readonly message: string | undefined }) {
  return message === undefined ? null : (
    <p class="failure-line" role="alert">
      {message}
    </p>
  )
}

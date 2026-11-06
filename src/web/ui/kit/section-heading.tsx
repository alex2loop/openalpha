// A heading's trailing qualifier as the CLI words it: "(lúc 05/11/2026 07:00)", "(20 phiên)".
const QUALIFIED = /^(.*\S)(\s+\([^()]+\))$/

/** A section heading as the CLI words it, its trailing qualifier quieter than its name. */
export function SectionHeading({ text }: { readonly text: string }) {
  const parts = QUALIFIED.exec(text)

  if (parts === null) {
    return <>{text}</>
  }

  return (
    <>
      {parts[1]}
      <span class="heading-note">{parts[2]}</span>
    </>
  )
}

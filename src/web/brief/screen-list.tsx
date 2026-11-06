import type { PublicScreenWire } from '@/app/server/wire/public-brief'
import { InlineText } from '@/web/ui/markdown/inline-view'

/** One market's screen board as the daemon wrote it: a title, a line per name and a closing note.
 *  A name is plain text, never a link or a button. */
export function ScreenList({ screen }: { readonly screen: PublicScreenWire }) {
  return (
    <section class="flow screen-list">
      <h3 class="sub-head">{screen.title}</h3>
      <div class="stack reader-figures">
        {screen.rows.map((row) => (
          <p key={row.ticker} class="reader-figure">
            <InlineText text={row.line} />
          </p>
        ))}
      </div>
      <p class="reader-note">{screen.note}</p>
    </section>
  )
}

import { twinRows } from '@/web/scene/overlay/twin'
import { tr } from '@/web/text/tr'

import './a11y.css'

const TITLE_ID = 'scene-twin-title'

/** The canvas in words, right after it: every person, what they do now and any marker, each a
 *  button that opens them. Hidden until focus reaches it. */
export function SceneTwin() {
  const rows = twinRows.value

  if (rows.length === 0) {
    return null
  }

  return (
    <section class="scene-twin" aria-labelledby={TITLE_ID}>
      <h2 id={TITLE_ID}>{tr('ui.office.a11y.twinTitle')}</h2>
      <ul>
        {rows.map((row) => (
          <li key={row.actor}>
            <button type="button" onClick={row.open}>
              {row.text}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

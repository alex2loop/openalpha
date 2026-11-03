import type { SessionId } from '@/core/ids'
import type { Locale } from '@/core/types/locale'
import { lruMap } from '@/core/utils/collections'
import { renderAiLabel } from '@/i18n'

const LABELLED_SESSION_CAPACITY = 2_000

export type AiLabeler = (sessionId: SessionId) => string | undefined

/** The label a session's first reply carries since this daemon started: a session that was
 *  labelled once is not labelled again until a restart, which covers a session from before the
 *  label existed. Held in memory so no lookup can fail; a capped map only ever repeats a label. */
export function createAiLabeler(locale: Locale): AiLabeler {
  const labelled = lruMap<SessionId, true>(LABELLED_SESSION_CAPACITY)

  return (sessionId) => {
    if (labelled.get(sessionId) !== undefined) {
      return undefined
    }

    labelled.set(sessionId, true)

    return renderAiLabel(locale, [])
  }
}

/** The footer is what a reply-to cuts off before a quote reaches a model, so the label lives there;
 *  one newline joins it, which leaves no gap `stripFooter` would cut inside it. */
export function withAiLabel(label: string | undefined, footer: string): string {
  return [label, footer].filter((part) => part !== undefined && part !== '').join('\n')
}

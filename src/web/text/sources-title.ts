import type { StatePayload } from '@/app/server/wire/system'
import { t } from '@/i18n'

const SOURCES_TITLE_KEY = 'trading.render.suggestion.sources'
// A report is written in the daemon's language, which may not be the page's by the time it is read.
const LANGUAGES = ['en', 'vi'] as const satisfies readonly StatePayload['locale'][]
const EMPHASIS = /[*_]/g

/** Whether `text` opens a report's sources, as a heading or a bold line, in either language. */
export function isSourcesTitle(text: string): boolean {
  const title = text.replace(EMPHASIS, '').trim().toLowerCase()

  return LANGUAGES.some((language) =>
    title.startsWith(t(language, SOURCES_TITLE_KEY).toLowerCase())
  )
}

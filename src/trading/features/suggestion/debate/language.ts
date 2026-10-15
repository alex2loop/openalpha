import type { Locale } from '@/core/types/locale'
import { languageName } from '@/engine/api'
import { isBrokenVietnamese } from '@/trading/features/suggestion/debate/language-vietnamese'

/** One token test per locale whose writing system has a shape closed enough to judge. A locale
 *  absent here is not validated: an open word shape cannot be told from a corrupted one, and a
 *  wrong reject costs the role a re-ask. */
const BROKEN_TOKEN: Partial<Record<Locale, (token: string) => boolean>> = {
  vi: isBrokenVietnamese,
}
const WORD_BREAK = /[^\p{L}]+/u

/** Every string the value carries, so the caller need not know which fields hold prose. */
function textValues(value: unknown): readonly string[] {
  if (typeof value === 'string') {
    return [value]
  }

  if (Array.isArray(value)) {
    return value.flatMap(textValues)
  }

  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(textValues)
  }

  return []
}

/** Tokens that carry the locale's marks but not its shape, named so the role re-asks with them —
 *  the same path a schema failure takes. */
export function languageIssues(locale: Locale, value: unknown): readonly string[] {
  const isBroken = BROKEN_TOKEN[locale]

  if (isBroken === undefined) {
    return []
  }

  const broken = new Set<string>()

  for (const text of textValues(value)) {
    for (const token of text.split(WORD_BREAK)) {
      if (token.length > 0 && isBroken(token)) {
        broken.add(token)
      }
    }
  }

  return broken.size === 0 ? [] : [`not ${languageName(locale)} words: ${[...broken].join(', ')}`]
}

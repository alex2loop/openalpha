import type { MessageKey } from '@/i18n'

const LANGUAGE_PARAM = 'lang'
const STORAGE_KEY = 'lang'
const PARAM_RE = /\{(\w+)\}/g
const FALLBACK_LOCALE: Locale = 'en'

export type Locale = 'vi' | 'en'

// Only a type reaches the page from the catalogs: the build hands over the words themselves.
type BriefKey = Extract<MessageKey, `ui.brief.${string}`>

export type Translate = (key: BriefKey, params?: Readonly<Record<string, string>>) => string

// Every `ui.brief.*` word of both languages, which the build substitutes here.
declare const STRINGS: Readonly<Record<Locale, Readonly<Record<string, string>>>>

export function createTranslate(locale: Locale): Translate {
  const words = STRINGS[locale]

  return (key, params) =>
    (words[key] ?? key).replace(PARAM_RE, (whole, name: string) => params?.[name] ?? whole)
}

/** The language the page opens in: the address's `?lang=` (which is also kept as the reader's
 *  choice), then the choice kept before, then the phone's. */
export function startLocale(): Locale {
  const asked = toLocale(new URLSearchParams(location.search).get(LANGUAGE_PARAM))

  if (asked !== undefined) {
    rememberChoice(asked)

    return asked
  }

  return toLocale(readChoice()) ?? phoneLocale()
}

/** The phone's own language, English when it is neither of the app's. */
export function phoneLocale(): Locale {
  return toLocale(navigator.language.split('-')[0]?.toLowerCase()) ?? FALLBACK_LOCALE
}

/** Keeps the reader's choice for the next visit. */
export function rememberChoice(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // A private window or blocked site data keeps nothing; the choice lasts until the page closes.
  }
}

function readChoice(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    // Blocked site data reads as no choice made.
    return null
  }
}

/** The app's language a tag names, if it names one. */
export function toLocale(tag: string | null | undefined): Locale | undefined {
  return tag === 'vi' || tag === 'en' ? tag : undefined
}

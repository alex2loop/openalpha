import type { MessageKey } from '@/i18n'
import { CACHE_NAME, isRecord, LOCALE_PATH, withDeadline } from '@/web/brief/load'

const STRINGS_PATH = '/strings.json'
const LANGUAGE_PARAM = 'lang'
const STORAGE_KEY = 'lang'
const PARAM_RE = /\{(\w+)\}/g
const FALLBACK_LOCALE: Locale = 'en'

export type Locale = 'vi' | 'en'

// Only a type reaches the page from the catalogs: the words themselves arrive as `strings.json`.
type BriefKey = Extract<MessageKey, `ui.brief.${string}`>

type Catalogs = Readonly<Record<Locale, Readonly<Record<string, string>>>>

export type Translate = (key: BriefKey, params?: Readonly<Record<string, string>>) => string

/** The words of both languages, or nothing when they could not be read. */
export async function loadStrings(signal: AbortSignal): Promise<Catalogs | undefined> {
  try {
    const found: unknown = await withDeadline(signal, async (bounded) => {
      const response = await fetch(STRINGS_PATH, { signal: bounded })

      return response.ok ? await response.json() : undefined
    })

    return isCatalogs(found) ? found : undefined
  } catch {
    // The words are unreadable whatever the reason; the page offers a retry.
    return undefined
  }
}

export function toTranslate(catalogs: Catalogs, locale: Locale): Translate {
  const words = catalogs[locale]

  return (key, params) =>
    (words[key] ?? key).replace(PARAM_RE, (whole, name: string) => params?.[name] ?? whole)
}

/** The address's `?lang=`, then the language the reader chose before, then the phone's. */
export function resolveLocale(): Locale {
  return (
    toLocale(new URLSearchParams(location.search).get(LANGUAGE_PARAM)) ??
    toLocale(readChoice()) ??
    toLocale(navigator.language.split('-')[0]?.toLowerCase()) ??
    FALLBACK_LOCALE
  )
}

/** Keeps the choice for the next visit, and in the service worker's cache for the push handler. */
export function rememberLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // A private window or blocked site data keeps nothing; the choice lasts until the page closes.
  }

  // A page outside a secure context has no cache storage, so no push to answer in the language.
  if (typeof caches === 'undefined') {
    return
  }

  caches
    .open(CACHE_NAME)
    .then((cache) => cache.put(LOCALE_PATH, new Response(locale)))
    // A refused cache costs only that push.
    .catch(() => undefined)
}

function readChoice(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    // Blocked site data reads as no choice made.
    return null
  }
}

function toLocale(tag: string | null | undefined): Locale | undefined {
  return tag === 'vi' || tag === 'en' ? tag : undefined
}

function isCatalogs(value: unknown): value is Catalogs {
  return isRecord(value) && isWords(value.vi) && isWords(value.en)
}

function isWords(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((text) => typeof text === 'string')
}

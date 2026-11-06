// The phone app's words: every `ui.brief.*` key of both catalogs, written as one `strings.json` the
// app fetches, so it never bundles the catalogs. A key missing from either language, or a plural
// form (the app counts nothing), fails the build.
import { resolve } from 'node:path'

import en from '@/i18n/locales/en.json'
import vi from '@/i18n/locales/vi.json'

export const STRINGS_FILE = 'strings.json'

const KEY_PREFIX = 'brief.'
const WIRE_PREFIX = 'ui.'
// The catalogs mark a counted sentence's singular with this suffix.
const PLURAL_SUFFIX = 'One'

type Strings = Record<string, string>

/** Writes `{ vi, en }` into `outDir`: each key under its full catalog name. */
export async function writeBriefStrings(outDir: string): Promise<void> {
  const strings = { vi: briefStringsOf(vi.ui), en: briefStringsOf(en.ui) }
  const problems = [
    ...missingKeys('vi', strings.vi, strings.en),
    ...missingKeys('en', strings.en, strings.vi),
    ...pluralKeys(strings.en),
  ]

  if (problems.length > 0) {
    throw new Error(`brief-strings: ${problems.join('; ')}`)
  }

  await Bun.write(resolve(outDir, STRINGS_FILE), `${JSON.stringify(strings)}\n`)
}

function briefStringsOf(ui: Strings): Strings {
  const found: Strings = {}

  for (const [key, text] of Object.entries(ui)) {
    if (key.startsWith(KEY_PREFIX)) {
      found[`${WIRE_PREFIX}${key}`] = text
    }
  }

  return found
}

function missingKeys(locale: string, held: Strings, other: Strings): readonly string[] {
  return Object.keys(other)
    .filter((key) => !(key in held))
    .map((key) => `${locale} lacks ${key}`)
}

function pluralKeys(strings: Strings): readonly string[] {
  return Object.keys(strings)
    .filter((key) => key.endsWith(PLURAL_SUFFIX))
    .map((key) => `${key} is a plural form`)
}

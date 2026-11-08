// The phone app's words: every `ui.brief.*` key of both catalogs, handed to the page build as one
// constant, so the app never bundles the catalogs. The service worker takes the `ui.brief.push.*`
// keys alone. A key missing from either language, or a plural form (the app counts nothing), fails
// the build.
import en from '@/i18n/locales/en.json'
import vi from '@/i18n/locales/vi.json'

const KEY_PREFIX = 'brief.'
const WIRE_PREFIX = 'ui.'
// The catalogs mark a counted sentence's singular with this suffix.
const PLURAL_SUFFIX = 'One'

type Strings = Record<string, string>

/** `{ vi, en }`, each key of the scope under its full catalog name. */
export function buildBriefStrings(scope: string = KEY_PREFIX): Record<'vi' | 'en', Strings> {
  const strings = { vi: briefStringsOf(vi.ui, scope), en: briefStringsOf(en.ui, scope) }
  const problems = [
    ...missingKeys('vi', strings.vi, strings.en),
    ...missingKeys('en', strings.en, strings.vi),
    ...pluralKeys(strings.en),
  ]

  if (problems.length > 0) {
    throw new Error(`brief-strings: ${problems.join('; ')}`)
  }

  return strings
}

function briefStringsOf(ui: Strings, scope: string): Strings {
  const found: Strings = {}

  for (const [key, text] of Object.entries(ui)) {
    if (key.startsWith(scope)) {
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

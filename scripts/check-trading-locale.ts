#!/usr/bin/env bun
import { TRADING_CODE_GROUPS } from '@/trading/locale-manifest'

/** Prefixes whose members only a closed market registry can enumerate. Boot's
 *  `assertRegistryConsistency` owns their forward coverage; this script only refuses to call one
 *  orphaned, because a market that is not registered in this process still ships its keys. */
const REGISTRY_DERIVED_PREFIXES = [
  'trading.market.',
  'trading.region.',
  'trading.segment.',
  'trading.venue.',
] as const
const MANIFEST_PREFIXES = REGISTRY_DERIVED_PREFIXES

const LOCALES = ['en', 'vi'] as const
const SOURCE_ROOT = 'src'
/** The manifest declares which keys must exist; it never asks for one. Reading it as a consumer
 *  would let every key it names vouch for itself. */
const KEY_DECLARATION_FILE = 'trading/locale-manifest.ts'
/** A key written out in full, e.g. `t(locale, 'trading.render.screen.row')`. */
const STATIC_KEY = /'(trading\.[a-zA-Z0-9.-]+)'/g
/** The literal head of a key finished at runtime, e.g. `` `trading.rating.${…}` ``. Everything under
 *  that head is reachable, which is as precise as a static reader can be about a dynamic key. */
const KEY_PREFIX = /`(trading\.[a-zA-Z0-9.-]*)\$\{/g
/** `\`trading.${string}\`` is a type annotation, not a key — it would mark the whole namespace live. */
const TYPE_ANNOTATION_PREFIX = 'trading.'

const DERIVED_CODE_KEYS = TRADING_CODE_GROUPS.flatMap((group) =>
  group.members.map((member) => `${group.prefix}.${member}`)
)
const CODE_GROUP_PREFIXES = TRADING_CODE_GROUPS.map((group) => `${group.prefix}.`)
/** What fits under a row on a phone: two sentences. */
const NOTE_MAXIMUM_CHARACTERS = 120
const NOTE_PREFIXES = ['trading.caveat.', 'trading.finding.']
/** `One` is a code's singular sentence; `Withheld` states it without the operator's own figure. */
const VARIANT_SUFFIXES = ['One', 'Withheld'] as const
const USAGE_KEY = /^slash\.\w*Usage$/
const RANK_NOTATION = /\bp\d{1,3}\b/

interface Catalog {
  readonly locale: string
  readonly keys: ReadonlySet<string>
  readonly values: ReadonlyMap<string, string>
}

function flatten(value: unknown, prefix = ''): readonly (readonly [string, string])[] {
  if (typeof value !== 'object' || value === null) {
    return [[prefix.slice(0, -1), String(value)] as const]
  }

  return Object.entries(value).flatMap(([key, child]) => flatten(child, `${prefix}${key}.`))
}

async function readCatalog(locale: string): Promise<Catalog> {
  const raw: unknown = await Bun.file(
    `src/i18n/locales/${locale}.json`
  ).json()
  const entries = flatten(raw)

  return {
    locale,
    keys: new Set(entries.map(([key]) => key)),
    values: new Map(entries),
  }
}

/** A caveat is read on a phone, under a row it qualifies: two sentences fit there and four do not.
 *  One that needs more is two caveats or a fold, never a paragraph. */
function overlongNotes(catalogs: readonly Catalog[]): readonly string[] {
  return catalogs.flatMap((catalog) =>
    [...catalog.values]
      .filter(([key, value]) => isNoteKey(key) && value.length > NOTE_MAXIMUM_CHARACTERS)
      .map(([key, value]) => `${key}: ${value.length} characters in ${catalog.locale}`)
  )
}

function isNoteKey(key: string): boolean {
  return NOTE_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/** A command grammar is a list, not a sentence: one shape per line, or the reader is handed a
 *  paragraph to parse before they can copy anything. */
function unbrokenUsage(catalogs: readonly Catalog[]): readonly string[] {
  return catalogs.flatMap((catalog) =>
    [...catalog.values]
      .filter(([key, value]) => USAGE_KEY.test(key) && !value.includes('\n'))
      .map(([key]) => `${key}: one line in ${catalog.locale}`)
  )
}

/** `p85` was a standing written in a notation no message defined. `formatPercentRank` words it
 *  now, and this is what stops the notation coming back through the catalog. */
function rankNotation(catalogs: readonly Catalog[]): readonly string[] {
  return catalogs.flatMap((catalog) =>
    [...catalog.values]
      .filter(([, value]) => RANK_NOTATION.test(value))
      .map(([key]) => `${key}: writes a pNN rank in ${catalog.locale}`)
  )
}

/** Every member of every frozen code tuple, in both catalogs. This is the half of coverage that
 *  needs no registry and no database, so it fails in CI rather than at someone's first boot. */
function missingCodeKeys(catalogs: readonly Catalog[]): readonly string[] {
  return catalogs.flatMap((catalog) =>
    DERIVED_CODE_KEYS.filter((key) => !catalog.keys.has(key)).map(
      (key) => `${catalog.locale}: ${key}`
    )
  )
}


/** Which keys any source file could still ask for. A key built from a code group's own `prefix`
 *  field reads as `${group.prefix}.${member}` and has no literal head to find, so the groups
 *  contribute theirs directly. */
interface ReachableKeys {
  readonly exact: ReadonlySet<string>
  readonly prefixes: readonly string[]
}

async function reachableKeys(): Promise<ReachableKeys> {
  const scanned = await Array.fromAsync(new Bun.Glob('**/*.{ts,tsx}').scan({ cwd: SOURCE_ROOT }))
  const sources = scanned.filter((file) => file !== KEY_DECLARATION_FILE)
  const blob = (
    await Promise.all(sources.map((file) => Bun.file(`${SOURCE_ROOT}/${file}`).text()))
  ).join('\n')
  const prefixes = new Set([
    ...captured(blob, KEY_PREFIX),
    ...CODE_GROUP_PREFIXES,
    ...MANIFEST_PREFIXES,
  ])

  prefixes.delete(TYPE_ANNOTATION_PREFIX)

  return { exact: new Set(captured(blob, STATIC_KEY)), prefixes: [...prefixes] }
}

/** Group one of every match. An unmatched group would widen a prefix to the whole namespace and
 *  silently pass everything, so it is dropped rather than defaulted. */
function captured(blob: string, pattern: RegExp): readonly string[] {
  return [...blob.matchAll(pattern)].flatMap((match) => match[1] ?? [])
}

/** A rendered line whose renderer was deleted leaves its key behind, reading as live vocabulary to
 *  the next person editing the catalog. Nothing else here can see that: the fixed list names only
 *  part of the namespace, so absence from it proves nothing. */
function orphanedKeys(catalog: Catalog, reachable: ReachableKeys): readonly string[] {
  return [...catalog.keys].filter(
    (key) =>
      key.startsWith('trading.') &&
      !reachable.exact.has(key) &&
      !reachable.prefixes.some((prefix) => key.startsWith(prefix))
  )
}

/** The code a variant key belongs to (`caveat.ts` picks the variant). */
function withoutVariantSuffix(key: string): string {
  const suffix = VARIANT_SUFFIXES.find((variant) => key.endsWith(variant))

  return suffix === undefined ? key : key.slice(0, -suffix.length)
}

/** The direction the boot gate structurally cannot check: it asks "is every derived key present?",
 *  which stays true forever after a tuple member is deleted and its two catalog entries are left
 *  behind. An orphan is dead weight that reads as live vocabulary to the next person editing it. */
function orphanedCodeKeys(catalog: Catalog): readonly string[] {
  const derived = new Set(DERIVED_CODE_KEYS)

  return [...catalog.keys].filter((key) => {
    if (!key.startsWith('trading.') || derived.has(key) || derived.has(withoutVariantSuffix(key))) {
      return false
    }

    // Manifest-declared keys have no tuple; only a registry knows them, so they are out of scope.
    if (MANIFEST_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      return false
    }

    // Only keys inside a tuple's own namespace are checkable — a free-standing key elsewhere under
    // `trading.` is prose (a title, a usage line) and has no tuple to belong to.
    return CODE_GROUP_PREFIXES.some((prefix) => key.startsWith(prefix))
  })
}

/** Every other check here asks about `trading.` keys the code can enumerate. This one asks the
 *  question no list can: the `MessageKey` type proves a key exists in English, and nothing proves it
 *  was ever translated, so a catalog that gained a key alone ships a line no Vietnamese reader
 *  sees. */
function catalogDrift(catalogs: readonly Catalog[]): readonly string[] {
  return catalogs.flatMap((catalog) =>
    catalogs
      .filter((other) => other.locale !== catalog.locale)
      .flatMap((other) =>
        [...catalog.keys]
          .filter((key) => !other.keys.has(key))
          .map((key) => `${key}: in ${catalog.locale}, absent from ${other.locale}`)
      )
  )
}

function report(label: string, entries: readonly string[]): boolean {
  if (entries.length === 0) {
    return false
  }

  process.stderr.write(`FAIL: ${entries.length} ${label}:\n`)

  for (const entry of entries) {
    process.stderr.write(`  ${entry}\n`)
  }

  return true
}

const catalogs = await Promise.all(LOCALES.map(readCatalog))
const reachable = await reachableKeys()
const english = catalogs.find((catalog) => catalog.locale === 'en')

if (english === undefined) {
  process.stderr.write('FAIL: no English catalog to check orphans against\n')
  process.exit(1)
}

const failed = [
  report('trading code key(s) missing from a catalog', missingCodeKeys(catalogs)),
  report('orphaned trading code key(s) with no tuple member', orphanedCodeKeys(english)),
  report('trading key(s) no source file can ask for', orphanedKeys(english, reachable)),
  report('key(s) in one catalog but not the other', catalogDrift(catalogs)),
  report('caveat or finding(s) over 120 characters', overlongNotes(catalogs)),
  report('usage string(s) with no line break', unbrokenUsage(catalogs)),
  report('value(s) writing a rank as pNN', rankNotation(catalogs)),
].some(Boolean)

if (failed) {
  process.exit(1)
}

const covered = TRADING_CODE_GROUPS.reduce((sum, group) => sum + group.members.length, 0)

process.stdout.write(
  `check-trading-locale: PASS (${TRADING_CODE_GROUPS.length} code groups, ${covered} keys)\n`
)

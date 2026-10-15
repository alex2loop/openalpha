import {
  RESEARCH_CONFLICT_DISPLAY_KEYS,
  RESEARCH_DATE_CONFIDENCE_KEYS,
  RESEARCH_FRESHNESS_FIELD_KEYS,
  RESEARCH_GAP_DISPLAY_KEYS,
  RESEARCH_NUMERIC_CONFLICT_REASON_KEYS,
  RESEARCH_OPERATION_SHORT_KEYS,
  RESEARCH_VALIDATION_REASON_KEYS,
} from '@/engine/research/display/progress'
import {
  FAILURE_ACTION_KEYS,
  FAILURE_LABEL_KEYS,
  FAILURE_RESULT_KEYS,
  RESEARCH_EVIDENCE_LEVEL_KEYS,
} from '@/engine/research/display/result'

const REGISTRIES: readonly Readonly<Record<string, string>>[] = [
  RESEARCH_GAP_DISPLAY_KEYS,
  RESEARCH_CONFLICT_DISPLAY_KEYS,
  RESEARCH_OPERATION_SHORT_KEYS,
  RESEARCH_DATE_CONFIDENCE_KEYS,
  RESEARCH_FRESHNESS_FIELD_KEYS,
  RESEARCH_NUMERIC_CONFLICT_REASON_KEYS,
  RESEARCH_VALIDATION_REASON_KEYS,
  FAILURE_LABEL_KEYS,
  FAILURE_RESULT_KEYS,
  FAILURE_ACTION_KEYS,
  RESEARCH_EVIDENCE_LEVEL_KEYS,
]

const LOCALES = ['en', 'vi'] as const

function resolve(catalog: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[key]
          : undefined,
      catalog
    )
}

function flatten(catalog: unknown, prefix = ''): readonly string[] {
  if (typeof catalog !== 'object' || catalog === null) {
    return [prefix]
  }

  return Object.entries(catalog).flatMap(([key, value]) => flatten(value, `${prefix}${key}.`))
}

const catalogs = await Promise.all(
  LOCALES.map(async (locale) => Bun.file(`src/i18n/locales/${locale}.json`).json())
)
const keys = REGISTRIES.flatMap((registry) => Object.values(registry))
const missing = keys.flatMap((key) =>
  catalogs.flatMap((catalog, index) =>
    resolve(catalog, key) === undefined ? [`${LOCALES[index]}: ${key}`] : []
  )
)

if (missing.length > 0) {
  console.error('MISSING:', missing)
  process.exit(1)
}

const [en, vi] = catalogs.map((catalog) => flatten(catalog))
const drift = [
  ...(en ?? []).filter((key) => !(vi ?? []).includes(key)),
  ...(vi ?? []).filter((key) => !(en ?? []).includes(key)),
]

if (drift.length > 0) {
  console.error('KEY SET DRIFT:', drift)
  process.exit(1)
}

console.log(`research i18n: PASS (${keys.length} registry keys, ${(en ?? []).length} total keys)`)

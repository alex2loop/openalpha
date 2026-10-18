import type { Locale } from '@/core/types/locale'
import en from '@/i18n/locales/en.json'
import vi from '@/i18n/locales/vi.json'

type Catalog = typeof en

// i18n is a dependency-free leaf (DAG: i18n → nothing), so it cannot import RunCompletionCode from
// core. This closed literal set mirrors core/types.ts; the catalogs cover every value, and callers
// pass a core RunCompletionCode, which is structurally identical.
type RunCompletionCode = 'approval_timeout' | 'model_tool_call_as_text'

export type MessageKey = {
  [N in keyof Catalog]: `${N & string}.${keyof Catalog[N] & string}`
}[keyof Catalog]

type ApprovalLabelDecision = 'deny' | 'once' | 'remember'

const CATALOGS: Record<Locale, Catalog> = { en, vi }
const PARAM_RE = /\{(\w+)\}/g
const FALLBACK_LOCALE: Locale = 'en'
const SENTENCE_STOP = '.'
// Their detail is addressed to the model, not the operator reading the tool line.
const MODEL_DETAIL_ERROR_CODES: ReadonlySet<string> = new Set([
  'approval_denied',
  'approval_timeout',
  'approval_unavailable',
  'invalid_input',
  'repeated_call',
])
const APPROVAL_LABEL_KEYS = {
  deny: 'channel.denyLabel',
  once: 'channel.approveOnceLabel',
  remember: 'channel.rememberLabel',
} satisfies Record<ApprovalLabelDecision, MessageKey>
// A button caption instructs ("Approve once"); an outcome states what happened. Never share one set.
const APPROVAL_OUTCOME_KEYS = {
  deny: 'channel.deniedOutcome',
  once: 'channel.approvedOnceOutcome',
  remember: 'channel.approvedRememberedOutcome',
} satisfies Record<ApprovalLabelDecision, MessageKey>
const RUN_COMPLETION_KEYS = {
  approval_timeout: 'runCompletion.approvalTimeout',
  model_tool_call_as_text: 'runCompletion.modelToolCallAsText',
} satisfies Record<RunCompletionCode, MessageKey>

// Locale is a per-run argument, never module state: concurrent runs render different languages.
export function t(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>
): string {
  const raw = lookupKey(locale, key) ?? key

  if (!params) {
    return raw
  }

  return raw.replace(PARAM_RE, (whole, name: string) => {
    const value = params[name]
    return value === undefined ? whole : String(value)
  })
}

/** English marks plurals and Vietnamese does not, so a counted sentence needs two catalog entries
 *  in one locale and the same text twice in the other. The plural keeps the key; the singular adds
 *  `One`. `footer.*` is the one pair outside this: `core` cannot import `i18n`, so it branches
 *  locally and names both keys in English. */
export function pluralKey<K extends MessageKey>(count: number, one: K, many: K): K {
  return count === 1 ? one : many
}

export function approvalDecisionLabel(locale: Locale, decision: ApprovalLabelDecision): string {
  return t(locale, APPROVAL_LABEL_KEYS[decision])
}

export function approvalOutcome(locale: Locale, decision: ApprovalLabelDecision): string {
  return t(locale, APPROVAL_OUTCOME_KEYS[decision])
}

/** A cut detail leads with the marker, so a surface that trims the tail of a long prompt still
 *  shows that the operator did not see the whole call. */
export function approvalDetail(
  locale: Locale,
  detail: string | undefined,
  truncated: true | undefined
): string | undefined {
  if (detail === undefined || truncated === undefined) {
    return detail
  }

  return `${t(locale, 'channel.approvalTruncated')} ${detail}`
}

export function runCompletionMessage(
  locale: Locale,
  code: RunCompletionCode,
  model: string
): string {
  return t(locale, RUN_COMPLETION_KEYS[code], { model })
}

// A dotless key names no namespace, so it can never resolve — splitting it anyway would yield a
// truncated `ns` that silently matches the wrong section. Only the first dot separates; everything
// after it is one opaque field name, which is what lets `trading` carry literal dotted keys.
function splitKey(key: string): { readonly ns: string; readonly field: string } | undefined {
  const dot = key.indexOf('.')

  if (dot <= 0 || dot === key.length - 1) {
    return undefined
  }

  return { ns: key.slice(0, dot), field: key.slice(dot + 1) }
}

function lookupKey(locale: Locale, key: string): string | undefined {
  const parts = splitKey(key)

  if (parts === undefined) {
    return undefined
  }

  return lookup(locale, parts.ns, parts.field) ?? lookup(FALLBACK_LOCALE, parts.ns, parts.field)
}

// A catalog is two levels deep by construction; the widened view is what lets `ns`/`field` — plain
// strings split out of a MessageKey — index it. Own-key checks keep an `Object.prototype` name
// (a tool called `constructor`) from resolving to an inherited function instead of a message.
function lookup(locale: Locale, ns: string, field: string): string | undefined {
  const catalog: Record<string, Record<string, string>> = CATALOGS[locale]
  const section = Object.hasOwn(catalog, ns) ? catalog[ns] : undefined

  return section !== undefined && Object.hasOwn(section, field) ? section[field] : undefined
}

/** True when a message key resolves in the given locale (or the fallback). Key is a bare string so
 *  i18n stays a dependency-free localization leaf; callers pass their own typed keys. */
export function hasMessage(locale: Locale, key: string): boolean {
  return hasOwnMessage(locale, key) || hasOwnMessage(FALLBACK_LOCALE, key)
}

/** True only when *this* locale's own catalog carries the key. `hasMessage` deliberately accepts
 *  the fallback, which means it cannot prove a Vietnamese user will read Vietnamese — coverage
 *  validation needs this stricter check. */
export function hasOwnMessage(locale: Locale, key: string): boolean {
  const parts = splitKey(key)

  return parts !== undefined && lookup(locale, parts.ns, parts.field) !== undefined
}

// The one place a runtime-assembled key enters `t`, so the cast happens once rather than at every
// caller that builds a key from a tool or error name.
// why-safe: `t` returns the key unchanged when nothing resolves, which is what each caller tests for.
function translateDynamic(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>
): string {
  return t(locale, key as MessageKey, params)
}

// A direct namespace lookup, so a tool name never has to be asserted into `MessageKey`. Every
// trading tool has a catalog entry by registration, so the fallback is only ever reached by a
// plugin or MCP tool the catalogs cannot know about.
export function translateToolLabel(
  locale: Locale,
  toolName: string,
  fallbackLabel: string
): string {
  return (
    lookup(locale, 'tools', toolName) ?? lookup(FALLBACK_LOCALE, 'tools', toolName) ?? fallbackLabel
  )
}

/** The code names the kind of failure and the detail names the failure, so a reader gets both. A
 *  code with no catalog entry falls back to the detail alone; a detail that only restates the code
 *  is dropped rather than printed twice. */
export function translateToolError(
  locale: Locale,
  errorCode: string,
  detail: string | undefined
): string {
  const key = `toolErrors.${errorCode}`
  const translated = translateDynamic(locale, key)

  if (translated === key) {
    return detail ?? key
  }

  return detail === undefined ||
    detail === '' ||
    detail === translated ||
    MODEL_DETAIL_ERROR_CODES.has(errorCode)
    ? translated
    : `${withoutTrailingStop(translated)}: ${detail}`
}

// Every catalog entry is a finished sentence, so appending a detail after one would print `.: `.
function withoutTrailingStop(text: string): string {
  return text.endsWith(SENTENCE_STOP) ? text.slice(0, -SENTENCE_STOP.length) : text
}

export function translateLlmErrorCode(locale: Locale, errorCode: string): string {
  return (
    lookup(locale, 'llmErrors', errorCode) ??
    lookup(FALLBACK_LOCALE, 'llmErrors', errorCode) ??
    errorCode
  )
}

/** `en` resolves to `en-GB` for date order only: both locales read day-first, because every figure
 *  the market publishes does. It selects a date convention, never a dialect of the copy. */
export const DATE_ORDER_LOCALES: Readonly<Record<Locale, string>> = Object.freeze({
  en: 'en-GB',
  vi: 'vi',
})

/** Day-first parts, pinned to UTC; a caller dating an instant overrides `timeZone`. */
export const DAY_PARTS: Intl.DateTimeFormatOptions = Object.freeze({
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
})
// One per locale, so bounded by construction.
const dayFormatters = new Map<Locale, Intl.DateTimeFormat>()
// One per locale and currency precision, so bounded by construction.
const amountFormatters = new Map<string, Intl.NumberFormat>()

/** A `YYYY-MM-DD` calendar day in the reader's date order: `2026-08-24` reads as `24/08/2026`. It
 *  names a date, not an instant, so it is pinned to UTC to survive any host timezone. */
export function formatDay(locale: Locale, day: string): string {
  let formatter = dayFormatters.get(locale)

  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(DATE_ORDER_LOCALES[locale], DAY_PARTS)
    dayFormatters.set(locale, formatter)
  }

  return formatter.format(new Date(day))
}

/** A value a message interpolates. A keyed one is localized, and prints `fallback` where the catalog
 *  has no such key; a `day` is put in the reader's date order; an `amount` in their separators; a
 *  list prints one item per line. */
export type DisplayParam =
  | string
  | number
  | { readonly day: string }
  | { readonly amount: number; readonly digits: number }
  | readonly DisplayParam[]
  | {
      readonly key: string
      readonly params?: Readonly<Record<string, DisplayParam>>
      readonly fallback?: string
    }

/** Resolves display text: keyed messages are localized, plain text passes
 *  through. A param may itself be a keyed message or a list of them, e.g. a gap
 *  whose reason is a failure display. */
export function translateDisplayText(
  locale: Locale,
  value:
    | string
    | {
        readonly key: string
        readonly params?: Readonly<Record<string, DisplayParam>>
        readonly fallback?: string
      }
): string {
  if (typeof value === 'string') {
    return value
  }

  if (value.fallback !== undefined && !hasMessage(locale, value.key)) {
    return value.fallback
  }

  return translateDynamic(locale, value.key, translateDisplayParams(locale, value.params))
}

function translateDisplayParams(
  locale: Locale,
  params: Readonly<Record<string, DisplayParam>> | undefined
): Record<string, string | number> | undefined {
  if (params === undefined) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(params).map(([name, value]) => [name, displayParamText(locale, value)])
  )
}

function displayParamText(locale: Locale, value: DisplayParam): string | number {
  if (typeof value !== 'object') {
    return value
  }

  if ('day' in value) {
    return formatDay(locale, value.day)
  }

  if ('amount' in value) {
    return formatParamAmount(locale, value.amount, value.digits)
  }

  if ('key' in value) {
    return translateDisplayText(locale, value)
  }

  return value.map((item) => displayParamText(locale, item)).join('\n')
}

function formatParamAmount(locale: Locale, amount: number, digits: number): string {
  const id = `${locale}:${digits}`
  let formatter = amountFormatters.get(id)

  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
    amountFormatters.set(id, formatter)
  }

  return formatter.format(amount)
}

/** Binds a locale into a closure-based lookup pair for the command renderer (commands/render.ts),
 *  which may not import i18n directly. Kept here because it closes over `t` and `hasMessage`. */
export function bindLocale(locale: Locale): {
  translate: (key: string, params?: Readonly<Record<string, DisplayParam>>) => string
  has: (key: string) => boolean
} {
  return {
    translate: (key, params) =>
      translateDynamic(locale, key, translateDisplayParams(locale, params)),
    has: (key) => hasMessage(locale, key),
  }
}

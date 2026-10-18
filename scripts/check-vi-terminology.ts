#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const LOCALES_DIR = resolve(import.meta.dir, '../src/i18n/locales')
const LOCALE = 'vi'
/** Prefixes whose values a user reads as domain vocabulary rather than as prose. */
const REVIEWED_PREFIXES = ['trading.', 'slash.trading', 'tools.'] as const

/** Format-only strings with nothing to translate. Every other identical pair is a leak. `oz` is the
 *  international abbreviation Vietnamese financial writing uses unchanged. `coin` is the loanword
 *  Vietnamese crypto writing uses unchanged — `đồng` reads as VND. Index basket names (VN30, VN100)
 *  are proper nouns Vietnamese financial writing also uses unchanged, for the same reason as `oz`. */
/** An exchange trades under one name in both languages, and that holds for every venue registered
 *  after these — which is why this is a prefix and not two entries the next one would fail on. */
const IDENTICAL_ALLOWED_PREFIXES = ['trading.venue.'] as const
const IDENTICAL_ALLOWED: ReadonlySet<string> = new Set([
  'tools.listChanged',
  'trading.render.quote.price',
  'trading.render.quotes.row',
  'trading.render.quotes.rowChange',
  'trading.render.portfolio.positionWeight',
  'trading.render.portfolio.sectorRow',
  'trading.quote-unit.currency-per-troy-ounce',
  'trading.quote-unit.currency-per-coin',
  'trading.render.screen.row',
  'trading.render.screen.gateRow',
  'trading.render.watchlist.row',
  'trading.render.alert.row',
  'trading.order.prompt.line',
  'trading.render.refresh.records',
  'trading.render.segment.cell',
  'trading.intraday.header',
  'trading.intraday.index.row',
  'trading.intraday.index.rowChange',
  'trading.intraday.row.priced',
  'trading.intraday.row.pricedChange',
  'trading.render.ledger.pageKind',
  'trading.render.ledger.transferRow',
  'trading.index-tier.vn30',
  'trading.index-tier.vn100',
  // A currency pair is written the same way on every desk; translating the symbol invents a name
  // no quote screen shows.
  'trading.macro.series.usd-vnd',
  // Read as the international symbols in Vietnamese filings and broker research alike.
  'trading.metric.pe',
  'trading.metric.pb',
  'trading.metric-short.pe',
  'trading.metric-short.pb',
  // The acronym is what the exchange lists it as, so the badge is the same word in both.
  'trading.render.kind.etf',
  // A series name, a date and a value carry no word to translate.
  'trading.render.macro.driver',
])

interface TermRule {
  /** An exact key, a dotted prefix, or a prefix ending in `*` for a group that shares no dot. */
  readonly key: string
  /** Sub-prefixes the rule does not reach, for a namespace holding two vocabularies. */
  readonly except?: readonly string[]
  /** Vietnamese substrings that must not appear in this key's value, matched without regard to
   *  case. A pattern where the wrong term is a word in some contexts and right in others, which no
   *  substring can separate. */
  readonly forbidden: readonly (string | RegExp)[]
  readonly why: string
}

/** Buy-arm vocabulary a reduce key may never carry. Matching ignores case, so a levels row in Title
 *  Case and the same word in prose are one entry. */
const REDUCE_BUY_TERMS = Object.freeze(['cắt lỗ', 'chốt lời', 'vào lệnh'])

/** The reduce arm's levels sit the other way up: the stop is above the sale price and the target
 *  below it, so a fill at the stop forgoes upside rather than cutting a loss, and reaching the
 *  target avoids a loss rather than taking a profit. */
const REDUCE_LEVELS_WHY =
  'on a reduce the stop sits above the sale price and the target below it: a fill at the stop forgoes upside rather than cutting a loss, and the target is a loss avoided rather than a profit taken'

/** Every key the reduce arm reaches. A headline the arm can render and this list does not name is
 *  a key still free to carry the buy vocabulary. */
const REDUCE_KEYS = Object.freeze([
  'trading.render.suggestion.actionableReduce',
  'trading.render.suggestion.actionableSizedReduce',
  'trading.render.suggestion.actionableUnsizedReduce',
  'trading.render.suggestion.holdLevelsEntryReduce',
  'trading.render.suggestion.holdLevelsRowHeldReduceStop',
  'trading.render.suggestion.holdLevelsStopReduce',
  'trading.render.suggestion.holdLevelsTargetReduce',
  'trading.render.suggestion.holdReduce',
  'trading.render.suggestion.stakeReduce',
  'trading.render.suggestion.stopVolatilityReduce',
])

/** Confirmed-wrong mappings, recorded so they cannot come back. This is a regression guard, not a
 *  translation review: it proves nothing about the terms it does not name. Add a row only after a
 *  Vietnamese-speaking trader has confirmed the term is wrong — a guess here is worse than nothing,
 *  because it makes the wrong term look adjudicated. */
/** `phiên` alone is a trading session - the unit every VN market figure is quoted in, and what
 *  `(20 phiên)` means. Every other sense takes a qualifier: `phiên chat` for the assistant's own
 *  session, `phiên chạy` for one run, `phiên bản` for a version. */
const BARE_SESSION_RE = /\bphiên(?!\s+(?:chat|chạy|bản|đánh giá|định kỳ))/i
const BARE_SESSION_WHY =
  'a bare "phiên" reads as a trading session; the assistant\'s own session is "phiên chat" and one run is "phiên chạy"'
/** `lệnh` is an exchange order. A command the operator types is `câu lệnh`, and the two compounds
 *  that are neither stay whole: `dòng lệnh` is a command line and `lệnh gọi` is a call. */
const BARE_ORDER_RE = /(?<!câu |dòng )\blệnh(?!\s+gọi)/i
const BARE_ORDER_WHY =
  'a bare "lệnh" is an exchange order; a command the operator types is "câu lệnh"'
/** `bán` alone instructs a sell-out. `bán bớt` is explicitly partial, which is what a reduce is. */
const BARE_SELL_RE = /\bbán(?!\s+bớt)/i
/** The one namespace holding both vocabularies: every trading command is named `slash.trading*`,
 *  and those say `phiên` and `lệnh` in the market's sense. */
const SLASH_TRADING = Object.freeze(['slash.trading'])

type TermScope = Pick<TermRule, 'key' | 'except'>

/** Where a bare `phiên` is the assistant's session rather than a trading one. */
const SESSION_SCOPES: readonly TermScope[] = Object.freeze([
  { key: 'cli.' },
  { key: 'cliHelp.' },
  { key: 'errors.' },
  { key: 'channel.' },
  { key: 'toolErrors.' },
  { key: 'slash.', except: SLASH_TRADING },
])

/** Where a bare `lệnh` is a typed command rather than an order. `toolErrors.` is absent: its order
 *  arm is the largest honest user of the word. */
const ORDER_SCOPES: readonly TermScope[] = Object.freeze([
  { key: 'channel.' },
  { key: 'pairing.' },
  { key: 'slash.', except: SLASH_TRADING },
])

const TERM_RULES: readonly TermRule[] = Object.freeze([
  ...SESSION_SCOPES.map((scope) => ({ ...scope, forbidden: [BARE_SESSION_RE], why: BARE_SESSION_WHY })),
  ...ORDER_SCOPES.map((scope) => ({ ...scope, forbidden: [BARE_ORDER_RE], why: BARE_ORDER_WHY })),
  ...REDUCE_KEYS.map((key) => ({ key, forbidden: REDUCE_BUY_TERMS, why: REDUCE_LEVELS_WHY })),
  {
    key: 'trading.action.reduce',
    forbidden: [BARE_SELL_RE],
    why: 'reduce trims a position; a bare "bán" tells the user to sell out, which the product did not suggest',
  },
  {
    key: 'trading.action.hold',
    forbidden: ['Nắm giữ thêm', 'Mua thêm'],
    why: 'hold is "no change", never an instruction to add',
  },
  {
    key: 'trading.hold.',
    forbidden: ['lệnh bán', 'đặt lệnh'],
    why: 'a hold reason explains why nothing was suggested; it must not read as an order instruction',
  },
  {
    key: 'trading.caveat.valuation.fx-*',
    forbidden: ['biên lợi nhuận'],
    why: 'FX terms are rates, not profit margin',
  },
  {
    key: 'trading.ledger.kind.dividend',
    forbidden: ['lãi', 'lợi nhuận'],
    why: 'a cash dividend is "cổ tức", not interest or profit',
  },
  {
    key: 'tools.market_screen',
    forbidden: ['cổ phiếu'],
    why: 'the screen runs over every registered market - crypto and gold included - so its label must not name one asset class',
  },
  {
    key: 'slash.tradingScreen*',
    forbidden: ['cổ phiếu'],
    why: 'the screen runs over every registered market - crypto and gold included - so its label must not name one asset class',
  },
  {
    key: 'trading.factor.turnover-velocity',
    forbidden: ['Vòng quay'],
    why: 'the factor is 24h volume over market cap; "vòng quay giao dịch" is the textbook phrase and names neither side of the ratio',
  },
  {
    key: 'trading.factor.index-momentum',
    forbidden: ['tăng'],
    why: 'factor scores are signed and + is always bullish, so a direction word in the label contradicts every negative reading',
  },
  {
    key: 'trading.factor.value',
    forbidden: ['hấp dẫn'],
    why: 'the label must name the dimension, not assert the verdict - a cheap and an expensive name share this factor',
  },
  {
    key: 'trading.rating.',
    forbidden: ['khuyến nghị', 'Rất tránh'],
    why: 'khuyến nghị is analyst coverage; the rating scale reads "nên", and "rất" cannot take a bare verb',
  },
  {
    key: 'trading.render.portfolio.positionDetail',
    forbidden: ['giá nay', 'giá bây giờ'],
    why: 'market price pairs with giá vốn as "thị giá"; "giá nay" is colloquial and reads as a typo',
  },
])

/** A term that must never render as another term anywhere in the reviewed surface, regardless of
 *  key. These are the cross-cutting confusions the plan names by example. */
const GLOBAL_CONFUSIONS: readonly TermRule[] = Object.freeze([
  {
    key: '*',
    forbidden: ['biên lợi nhuận ký quỹ'],
    why: 'margin (ký quỹ) and profit margin (biên lợi nhuận) are unrelated concepts',
  },
  {
    key: '*',
    forbidden: [/(?:lượt|lần) chạy/i],
    why: 'one execution is "phiên chạy"; "lượt" alone is the turn inside it, so "lượt chạy" names the smaller thing with the bigger word',
  },
])

/** The old tone-mark placement: on the second vowel of a closing `oa`, `oe` or `uy` ("khoá",
 *  "huỷ"). The catalog writes the new one ("khóa", "hủy") in every key, reviewed or not. `quý`
 *  keeps its mark on the `y`, because `qu` is one consonant. */
const OLD_TONE_MARK_RE = /(?:o[àáảãạèéẻẽẹ]|(?<!q)u[ỳýỷỹỵ])(?!\p{L})/iu

interface Violation {
  readonly key: string
  readonly message: string
}

function readCatalog(locale: string): Readonly<Record<string, string>> {
  const raw: unknown = JSON.parse(readFileSync(`${LOCALES_DIR}/${locale}.json`, 'utf8'))

  return flatten(raw)
}

function flatten(value: unknown, prefix = ''): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }

  const out: Record<string, string> = {}

  for (const [key, child] of Object.entries(value)) {
    const path = `${prefix}${key}`

    if (typeof child === 'string') {
      out[path] = child
      continue
    }

    Object.assign(out, flatten(child, `${path}.`))
  }

  return out
}

function isReviewed(key: string): boolean {
  return REVIEWED_PREFIXES.some((prefix) => key.startsWith(prefix))
}

function isIdenticalAllowed(key: string): boolean {
  return (
    IDENTICAL_ALLOWED.has(key) ||
    IDENTICAL_ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))
  )
}

/** Presence is already proven by the boot-time locale gate; this catches the next failure along —
 *  a key that exists in both catalogs and was never actually translated. */
function untranslatedViolations(
  en: Readonly<Record<string, string>>,
  vi: Readonly<Record<string, string>>
): readonly Violation[] {
  const violations: Violation[] = []

  for (const [key, english] of Object.entries(en)) {
    if (!isReviewed(key) || isIdenticalAllowed(key)) {
      continue
    }

    if (vi[key] === english) {
      violations.push({ key, message: `vi is identical to en: ${JSON.stringify(english)}` })
    }
  }

  return violations
}

function termViolations(vi: Readonly<Record<string, string>>): readonly Violation[] {
  const violations: Violation[] = []

  for (const rule of [...TERM_RULES, ...GLOBAL_CONFUSIONS]) {
    for (const [key, value] of Object.entries(vi)) {
      if (!matches(rule, key)) {
        continue
      }

      const folded = value.toLocaleLowerCase(LOCALE)
      const hit = rule.forbidden.find((term) =>
        typeof term === 'string' ? folded.includes(term.toLocaleLowerCase(LOCALE)) : term.test(value)
      )

      if (hit !== undefined) {
        violations.push({ key, message: `contains ${String(hit)} - ${rule.why}` })
      }
    }
  }

  return violations
}

function toneMarkViolations(vi: Readonly<Record<string, string>>): readonly Violation[] {
  return Object.entries(vi)
    .filter(([, value]) => OLD_TONE_MARK_RE.test(value))
    .map(([key]) => ({
      key,
      message: 'old tone-mark placement - write khóa, hủy, hòa, not khoá, huỷ, hoà',
    }))
}

function matches(rule: TermRule, key: string): boolean {
  if (rule.except?.some((prefix) => key.startsWith(prefix))) {
    return false
  }

  if (rule.key === '*') {
    return isReviewed(key)
  }
  if (rule.key.endsWith('*')) {
    return key.startsWith(rule.key.slice(0, -1))
  }

  return rule.key.endsWith('.') ? key.startsWith(rule.key) : key === rule.key
}

/** A rule whose key was renamed or removed silently guards nothing while the gate still reports PASS,
 *  which is how four of these went stale. `GLOBAL_CONFUSIONS` is exempt: `*` matches by definition. */
function unmatchedRules(vi: Readonly<Record<string, string>>): readonly Violation[] {
  const keys = Object.keys(vi)

  return TERM_RULES.filter((rule) => !keys.some((key) => matches(rule, key))).map((rule) => ({
    key: rule.key,
    message: `rule matches no key, so it guards nothing - it was renamed or removed: ${rule.why}`,
  }))
}

function main(): void {
  const en = readCatalog('en')
  const vi = readCatalog('vi')
  const violations = [
    ...untranslatedViolations(en, vi),
    ...termViolations(vi),
    ...toneMarkViolations(vi),
    ...unmatchedRules(vi),
  ]

  if (violations.length > 0) {
    process.stderr.write(`FAIL: ${violations.length} Vietnamese terminology violation(s):\n`)

    for (const violation of violations) {
      process.stderr.write(`  ${violation.key} - ${violation.message}\n`)
    }

    process.exit(1)
  }

  const reviewed = Object.keys(en).filter(isReviewed).length

  process.stdout.write(
    `check-vi-terminology: PASS (${reviewed} reviewed keys, ` +
      `${TERM_RULES.length + GLOBAL_CONFUSIONS.length} recorded rules)\n`
  )
}

main()

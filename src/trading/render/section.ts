import type { Locale } from '@/core/types/locale'
import type { CurrencyCode } from '@/trading/kernel/instrument'
import type {
  BriefField,
  BriefSectionResult,
  BriefSectionRow,
  BriefSectionValue,
} from '@/trading/kernel/operator/brief-section'
import type { RenderContext } from '@/trading/render/format'
import { formatDay, t } from '@/i18n'
import { isCurrencyCode } from '@/trading/kernel/instrument'
import { BRIEF_STRUCTURAL_FIELDS } from '@/trading/kernel/operator/brief-section'
import { renderCaveatLines } from '@/trading/render/caveat'
import { formatInstant, isTradingDayText } from '@/trading/render/datetime'
import {
  INDENT,
  INLINE_SEPARATOR,
  toFactLines,
  withoutUnfilledWindow,
} from '@/trading/render/layout'
import { renderPricePair } from '@/trading/render/price-pair'
import { type PriceContext, toPricePair } from '@/trading/render/section-price'
import { type RowUnit, renderValue, toLink } from '@/trading/render/section-values'

// Fields whose rendered value already says what it is: a ticker names itself, the side that crossed
// the spread names itself, the price beside it is the only bare amount on the row, a signed percent
// carries its own arrow and sign, and a driver is named by the series it points at under a section
// header that already says these are the drivers.
// Labelling them prints the field's own name at the reader ("change % ▲ 1,31%"), which is the
// mechanism, not the fact. Every other field keeps its label, because its number is ambiguous
// without one. `valuePct` joins them because its only rows pair it with the `driver` that names it;
// the basis, which used to share the field, now has `basisPct` and keeps its label. A board names
// itself the way a ticker does, and only ever appears under a section that already says these are
// boards. `premium` has one emitter and one section, whose title already says what it is. The rest
// are values whose own words are the answer: a sleeve, a sector, a side, a headline, a next step, a
// dated event and its date, an alert's condition, and the one rate a foreign-exchange row states.
// A level is the only bare number on its row the way a price is, and its section title says which
// index it is a level of.
/** Carried for another field's sake, so a row never prints them itself. */
const STRUCTURAL_FIELDS: ReadonlySet<string> = new Set(BRIEF_STRUCTURAL_FIELDS)
const TITLE_FIELD = 'title'
const URL_FIELD = 'url'

const SELF_EVIDENT_FIELDS: ReadonlySet<BriefField> = new Set([
  'aggressorSide',
  'at',
  'board',
  'code',
  'condition',
  'conviction',
  'direction',
  'driver',
  'eventKind',
  'changePct',
  'last',
  'level',
  'market',
  'premium',
  'publisher',
  'rate',
  'sector',
  'segment',
  'ticker',
  'title',
  'valuePct',
])
/** A single-field row needs no label: the section title already names what the value is. */

/** What a long digest gives a reader to find while scrolling: the market's name in bold, with the
 *  blank line above it doing what the rule used to. The framing ran to 66 characters on a market
 *  name and wrapped on a phone, which split the rule from the name it framed. */
export function renderBlockRule(icon: string | undefined, name: string): string {
  return `${icon === undefined ? '' : `${icon} `}**${name}**`
}

/** A section that failed still renders its title and the caveat that says why: dropping it makes an
 *  outage look like a quiet morning. A section that succeeded renders neither — its caveats qualify
 *  the read rather than the section, and four blocks quoting one source repeat that sentence four
 *  times, so the surface states them once. */
/** A section's heading apart from its rows, for a surface that folds the rows away. */
interface BriefSectionText {
  readonly heading: string
  readonly lines: readonly string[]
}

export function toBriefSectionText(
  locale: Locale,
  section: BriefSectionResult,
  context: RenderContext
): BriefSectionText {
  const heading = renderSectionHeading(locale, section, context.timezone)

  if (section.status !== 'ready') {
    return { heading, lines: renderCaveatLines(locale, section.caveats) }
  }

  const priceContext: PriceRowContext = {
    context,
    ...(section.currency === undefined ? {} : { currency: section.currency }),
  }

  return {
    heading,
    lines:
      section.kind === 'market-prices'
        ? section.rows.flatMap((row) => renderPriceRow(locale, row, priceContext))
        : fieldRows(locale, section, context),
  }
}

export function renderBriefSection(
  locale: Locale,
  section: BriefSectionResult,
  context: RenderContext
): string {
  const { heading, lines } = toBriefSectionText(locale, section, context)

  return [heading, ...lines].join('\n')
}

/** Only the first row rides the section title: a later single-field row has nothing naming it, and
 *  a bare `37,85%` under a breadth heading says nothing about what was measured. */
type ReadySection = Extract<BriefSectionResult, { readonly status: 'ready' }>

function fieldRows(
  locale: Locale,
  section: ReadySection,
  context: RenderContext
): readonly string[] {
  const { currency } = section
  const [first, ...rest] = section.rows

  if (first === undefined) {
    return []
  }

  return [
    ...toFactLines(headRowFacts(locale, first, unitOf(currency)), context, 1),
    ...rest.flatMap((row) =>
      toFactLines(labelledRowFacts(locale, row, unitOf(currency)), context, 1)
    ),
  ]
}

/** The row that rides the section title: one field needs no label, because the title already gave
 *  it one. */
export function headRowFacts(
  locale: Locale,
  row: BriefSectionRow,
  unit: RowUnit
): readonly string[] {
  const entries = fieldEntries(row)
  const [only] = entries

  if (entries.length === 1 && only !== undefined) {
    const [field] = only

    return [
      linkedValue(
        renderValue(locale, only, unitOf(currencyOf(row, unit.currency), unit.stated)),
        field,
        row
      ),
    ]
  }

  return labelledRowFacts(locale, row, unit)
}

/** One owner for what a section is called, so a surface that renders a section's rows its own way
 *  still names it the way every other surface does. */
export function renderSectionHeading(
  locale: Locale,
  section: BriefSectionResult,
  timezone: string
): string {
  return withoutUnfilledWindow(
    t(
      locale,
      `trading.brief.section.${section.kind}` as const,
      titleParamsOf(section, locale, timezone)
    )
  )
}

/** The title params a builder cannot resolve: an instant reads in the operator's locale and clock,
 *  and a trading day reads day-first in both — only this renderer holds either. Every day-valued
 *  param is converted, not a named few, or the next title to carry one prints its ISO form. */
function titleParamsOf(
  section: BriefSectionResult,
  locale: Locale,
  timezone: string
): Readonly<Record<string, string | number>> | undefined {
  const params = section.status === 'ready' ? section.titleParams : undefined

  if (params === undefined) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(params).map((entry) => [entry[0], titleParam(locale, entry, timezone)])
  )
}

function titleParam(
  locale: Locale,
  [name, value]: readonly [string, string | number],
  timezone: string
): string | number {
  if (name === 'observedAt' && typeof value === 'number') {
    return formatInstant(locale, value, timezone)
  }

  return typeof value === 'string' && isTradingDayText(value) ? formatDay(locale, value) : value
}

interface PriceRowContext {
  readonly context: RenderContext
  readonly currency?: CurrencyCode
}

/** The one section whose rows are a price pair rather than a field list, so it renders as the block
 *  every other price surface uses. A row carrying neither reading falls back to the field list,
 *  which states what it does have rather than a half-drawn pair. */
function renderPriceRow(
  locale: Locale,
  row: BriefSectionRow,
  price: PriceRowContext
): readonly string[] {
  const pair = toPricePair(row, priceContextOf(price))

  if (pair === undefined) {
    return [`${INDENT[1]}${renderRow(locale, row)}`]
  }

  return [
    `${INDENT[1]}${String(row.ticker ?? '')}`,
    ...renderPricePair(locale, pair, { context: price.context, depth: 2 }),
  ]
}

/** The clock and the unit a pair is read in, taken from the destination the row renders for. */
function priceContextOf(price: PriceRowContext): PriceContext {
  return {
    timezone: price.context.timezone,
    ...(price.currency === undefined ? {} : { currency: price.currency }),
  }
}

/** For a row something above it names - a section title, or the field label it rides on. A lone
 *  value then needs no label of its own, because that namer already gave it one. */
function renderRow(locale: Locale, row: BriefSectionRow, currency?: CurrencyCode): string {
  const entries = fieldEntries(row)
  const [only] = entries

  if (entries.length === 1 && only !== undefined) {
    const [field] = only

    return linkedValue(renderValue(locale, only, unitOf(currencyOf(row, currency))), field, row)
  }

  return renderLabelledRow(locale, row, unitOf(currency))
}

/** Spread rather than assigned, because `exactOptionalPropertyTypes` rejects an absent currency
 *  handed over as a present-and-undefined field. */
function unitOf(currency?: CurrencyCode, stated?: true): RowUnit {
  return {
    ...(currency === undefined ? {} : { currency }),
    ...(stated === undefined ? {} : { stated }),
  }
}

/** A row's own currency wins over its section's: a section states one unit for rows that share it,
 *  and a row carries one only where its neighbours are quoted in something else. The row's is read
 *  back from an untyped payload, so a value that is not a currency code falls through to the
 *  section's rather than labelling the row with whatever was stored. */
function currencyOf(row: BriefSectionRow, currency?: CurrencyCode): CurrencyCode | undefined {
  return typeof row.currency === 'string' && isCurrencyCode(row.currency) ? row.currency : currency
}

/** A row's values written the way this renderer prints them, for a reader handed the row without
 *  the section around it - a model, which would otherwise read board points as money. */
export function renderRowValues(
  locale: Locale,
  row: BriefSectionRow,
  currency?: CurrencyCode
): Readonly<Record<string, string>> {
  const unit = unitOf(currencyOf(row, currency))

  return Object.fromEntries(
    Object.entries(row).flatMap(([field, value]) =>
      value === undefined ? [] : [[field, renderValue(locale, [field as BriefField, value], unit)]]
    )
  )
}

/** For a row nothing names - a continuation line under a label the first row already took. Every
 *  field keeps its label, or a lone value arrives as a bare number with nothing saying what it is. */
export function renderLabelledRow(
  locale: Locale,
  row: BriefSectionRow,
  unit: RowUnit = {}
): string {
  return labelledRowFacts(locale, row, unit).join(INLINE_SEPARATOR)
}

/** One fact per field, for a surface that decides where they are joined. A field never splits: a
 *  label and the value it names are one reading. */
export function labelledRowFacts(
  locale: Locale,
  row: BriefSectionRow,
  unit: RowUnit = {}
): readonly string[] {
  const cells = unitOf(currencyOf(row, unit.currency), unit.stated)
  const params = labelParams(row)

  return fieldEntries(row).map((entry) => {
    const [field] = entry
    const rendered = renderValue(locale, entry, cells)

    const value = linkedValue(rendered, field, row)

    return SELF_EVIDENT_FIELDS.has(field) ? value : `${t(locale, fieldKey(field), params)} ${value}`
  })
}

/** The window the row's labels name. One per row: a section measuring two spans states them in its
 *  own titles rather than on one line. */
function labelParams(row: BriefSectionRow): Record<string, number> | undefined {
  return typeof row.sessions === 'number' ? { sessions: row.sessions } : undefined
}

function fieldKey(field: BriefField): `trading.brief.field.${BriefField}` {
  return `trading.brief.field.${field}`
}

// why-safe: BriefSectionRow's keys are BriefField by construction; Object.entries widens them to
// string, and no other value can reach this function.
/** A `url` is never a field of its own: it prints as the link under the row's own headline, and a
 *  row carrying a target and no headline has nothing worth showing - a bare redirect target is
 *  300 characters of base64 the reader cannot read or act on. */
function fieldEntries(row: BriefSectionRow): readonly (readonly [BriefField, BriefSectionValue])[] {
  return Object.entries(row).flatMap(([field, value]) =>
    value === undefined || STRUCTURAL_FIELDS.has(field) || field === URL_FIELD
      ? []
      : [[field as BriefField, value] as const]
  )
}

/** The headline as a link where the row carries a target, the headline alone where it does not. */
function linkedValue(rendered: string, field: BriefField, row: BriefSectionRow): string {
  const url = row[URL_FIELD]

  return field === TITLE_FIELD && typeof url === 'string' ? toLink(rendered, url) : rendered
}

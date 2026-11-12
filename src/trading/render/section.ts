import type { Locale } from '@/core/types/locale'
import type { TradingDay } from '@/trading/kernel/instrument'
import type {
  BriefField,
  BriefSectionResult,
  BriefSectionRow,
  BriefSectionValue,
} from '@/trading/kernel/operator/brief-section'
import type { RenderContext } from '@/trading/render/format'
import type { BriefSectionText } from '@/trading/render/section-heading'
import { t } from '@/i18n'
import { isCurrencyCode } from '@/trading/kernel/instrument'
import { BRIEF_STRUCTURAL_FIELDS } from '@/trading/kernel/operator/brief-section'
import { INDENT, INLINE_SEPARATOR, toRowLines } from '@/trading/render/layout'
import { renderHeadlineCells } from '@/trading/render/price-pair'
import { renderFactLines, toSectionFacts } from '@/trading/render/section-facts'
import { renderSectionHeading, toUnavailableText } from '@/trading/render/section-heading'
import { type PriceContext, priceContextOf, toPricePair } from '@/trading/render/section-price'
import { type RowUnit, renderValue, unitOfSection } from '@/trading/render/section-values'

// Fields whose rendered value already says what it is: a ticker names itself, the side that crossed
// the spread names itself, the price beside it is the only bare amount on the row, a signed percent
// carries its own arrow and sign, and a driver is named by the series it points at under a section
// header that already says these are the drivers.
// Labeling them prints the field's own name at the reader ("change % ▲ 1,31%"), which is the
// mechanism, not the fact. Every other field keeps its label, because its number is ambiguous
// without one. `valuePct` joins them because its only rows pair it with the `driver` that names it;
// the basis, which used to share the field, now has `basisPct` and keeps its label. A board names
// itself the way a ticker does, and only ever appears under a section that already says these are
// boards. `premium` has one emitter and one section, whose title already says what it is. The rest
// are values whose own words are the answer: a segment, a sector, a side, a headline, a next step, a
// dated event and its date, an alert's condition, and the one rate a foreign-exchange row states.
// A level is the only bare number on its row the way a price is, and its section title says which
// index it is a level of.
/** Carried for another field's sake, so a row never prints them itself. */
const STRUCTURAL_FIELDS: ReadonlySet<string> = new Set(BRIEF_STRUCTURAL_FIELDS)
const TITLE_FIELD = 'title'
const URL_FIELD = 'url'

const SELF_EVIDENT_FIELDS: ReadonlySet<BriefField> = new Set([
  'action',
  'aggressorSide',
  'at',
  'board',
  'code',
  'condition',
  'conviction',
  'direction',
  'driver',
  'eventKind',
  'freshness',
  'changePct',
  'last',
  'level',
  'market',
  'premium',
  'publisher',
  'rate',
  'reference',
  'sector',
  'segment',
  'ticker',
  'title',
  'valuePct',
  'verdict',
])

const NOTE_SEPARATOR = ', '

const VIETNAMESE_LETTER_RE =
  /[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]/iu
const URL_PARENTHESIS_RE = /[()]/g
const URL_PARENTHESIS = Object.freeze({ '(': '%28', ')': '%29' })
const LABEL_BRACKET_RE = /[[\]]/g
const LABEL_BRACKET = Object.freeze({ '[': '(', ']': ')' })
const LABEL_BREAK_RE = /\s*[\r\n]+\s*/g
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
export function toBriefSectionText(
  locale: Locale,
  section: BriefSectionResult,
  context: RenderContext
): BriefSectionText {
  if (section.status !== 'ready') {
    return toUnavailableText(locale, section, context.timezone)
  }

  const heading = renderSectionHeading(locale, section, context.timezone)
  const facts = toSectionFacts(locale, section)

  if (facts !== undefined) {
    return { heading, lines: renderFactLines(locale, facts, context) }
  }

  const priceContext: PriceRowContext = {
    context,
    price: priceContextOf(context.timezone, section),
    ...(section.asOf === undefined ? {} : { statedDay: section.asOf }),
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
  const unit = unitOfSection(section)
  const [first, ...rest] = section.rows

  if (first === undefined) {
    return []
  }

  return [
    ...toRowLines(headRowFacts(locale, first, unit), context, 1),
    ...rest.flatMap((row) => toRowLines(labelledRowFacts(locale, row, unit), context, 1)),
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

    return [linkedValue(locale, renderValue(locale, only, rowUnitOf(row, unit)), { field, row })]
  }

  return labelledRowFacts(locale, row, unit)
}

interface PriceRowContext {
  readonly context: RenderContext
  /** The clock and the unit a pair is read in, taken from the section the row sits under. */
  readonly price: PriceContext
  /** The session the section's block already states, so a close of that day is not dated again. */
  readonly statedDay?: TradingDay
}

/** The one section whose rows are a price rather than a field list, so each prints as one line:
 *  the ticker, the reading with its move, and a stamp only where the reading is not the section's
 *  own day. A row carrying no reading falls back to the field list, which states what it does have
 *  rather than a half-drawn line. */
function renderPriceRow(
  locale: Locale,
  row: BriefSectionRow,
  price: PriceRowContext
): readonly string[] {
  const pair = toPricePair(row, price.price)
  const { cells } =
    pair === undefined
      ? { cells: [] }
      : renderHeadlineCells(locale, pair, {
          ...(price.statedDay === undefined ? {} : { statedDay: price.statedDay }),
        })

  if (cells.length === 0) {
    return [`${INDENT[1]}${renderRow(locale, row)}`]
  }

  return toRowLines([String(row.ticker ?? ''), ...cells], price.context, 1)
}

/** For a row something above it names - a section title, or the field label it rides on. A lone
 *  value then needs no label of its own, because that namer already gave it one. */
function renderRow(locale: Locale, row: BriefSectionRow): string {
  const entries = fieldEntries(row)
  const [only] = entries

  if (entries.length === 1 && only !== undefined) {
    const [field] = only

    return linkedValue(locale, renderValue(locale, only, rowUnitOf(row, {})), { field, row })
  }

  return renderLabelledRow(locale, row)
}

/** A row's own unit wins over its section's: a section states one unit for rows that share it, and a
 *  row carries one only where its neighbours are quoted in something else - so a row naming its own
 *  currency brings its own measure with it, never the section's. The row's is read back from an
 *  untyped payload, so a value that is not a currency code falls through to the section's rather
 *  than labeling the row with whatever was stored. */
function rowUnitOf(row: BriefSectionRow, unit: RowUnit): RowUnit {
  if (typeof row.currency !== 'string' || !isCurrencyCode(row.currency)) {
    return unit
  }

  return {
    currency: row.currency,
    ...(typeof row.quoteUnit === 'string' ? { quoteUnit: row.quoteUnit } : {}),
    ...(unit.stated === undefined ? {} : { stated: unit.stated }),
  }
}

/** A row's values written the way this renderer prints them, for a reader handed the row without
 *  the section around it - a model, which would otherwise read board points as money. */
export function renderRowValues(
  locale: Locale,
  row: BriefSectionRow,
  sectionUnit: RowUnit = {}
): Readonly<Record<string, string>> {
  const unit = rowUnitOf(row, sectionUnit)

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
  const cells = rowUnitOf(row, unit)
  const params = labelParams(row)

  return fieldEntries(row).map((entry) => {
    const [field] = entry
    const rendered = renderValue(locale, entry, cells)

    const value = linkedValue(locale, rendered, { field, row })

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
function linkedValue(
  locale: Locale,
  rendered: string,
  cell: { readonly field: BriefField; readonly row: BriefSectionRow }
): string {
  const { field, row } = cell
  const url = row[URL_FIELD]

  return field === TITLE_FIELD && typeof url === 'string'
    ? toLink(rendered, url, { reader: locale })
    : rendered
}

interface LinkNotes {
  readonly reader: Locale
  readonly dated?: string
}

/** A headline that carries its source: the label is what prints, and the target travels behind it.
 *  Telegram reads a bare `)` as the end of a link, so the parentheses are encoded here - where the
 *  link is built is the only place that knows where the URL really ends. Notes follow in one
 *  parenthetical: the caller's own, then the headline's language where it is not the reader's,
 *  since sources publish verbatim. */
export function toLink(label: string, url: string, notes?: LinkNotes): string {
  const target = url.replace(
    URL_PARENTHESIS_RE,
    (char) => URL_PARENTHESIS[char as keyof typeof URL_PARENTHESIS]
  )
  const link = `[${linkLabel(label)}](${target})`

  if (notes === undefined) {
    return link
  }

  const written = writtenIn(label)
  const all = [
    ...(notes.dated === undefined ? [] : [notes.dated]),
    ...(written === notes.reader ? [] : [t(notes.reader, `trading.render.language.${written}`)]),
  ]

  return all.length === 0 ? link : `${link} (${all.join(NOTE_SEPARATOR)})`
}

/** The two catalog languages part on script: Vietnamese spells with letters English never uses. */
function writtenIn(text: string): Locale {
  return VIETNAMESE_LETTER_RE.test(text) ? 'vi' : 'en'
}

/** A headline is a third party's text: an unbalanced bracket would end the label early, and
 *  `Foo](https://other)` would turn it into a link of the headline's own choosing. */
function linkLabel(label: string): string {
  return label
    .replace(LABEL_BREAK_RE, ' ')
    .replace(LABEL_BRACKET_RE, (char) => LABEL_BRACKET[char as keyof typeof LABEL_BRACKET])
}

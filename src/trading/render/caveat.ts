import type { Locale } from '@/core/types/locale'
import type { Caveat, CaveatDetail, CaveatSeverity } from '@/trading/kernel/caveat'
import { hasMessage, type MessageKey, t } from '@/i18n'
import { caveatSeverity } from '@/trading/kernel/caveat'
import { isCurrencyCode } from '@/trading/kernel/instrument'
import { toFoldLines } from '@/trading/render/fold'
import {
  CAVEAT_SUBJECT_SEPARATOR,
  renderProvidedValue,
  SEVERITY_MARKS,
} from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'
import { formatMoney } from '@/trading/render/money'
import { renderSubject } from '@/trading/render/subject'

const UNFILLED_PARAM_RE = /\{\w+\}/

/** A stored caveat carries the detail shape of the build that wrote it, so a message it can no
 *  longer fill is dropped rather than shown with a raw placeholder. Two caveats that reach the same
 *  sentence are one fact stated twice: `mergeSubjects` joins the ones that name a subject, and
 *  `distinctLines` drops the rest — a sentence with no subject to merge on reads identically however
 *  many rows raised it. */
/** One caveat as the CLI states it, for a client that draws its own mark: the severity and the
 *  catalog sentence in the reader's language. Undefined when the stored detail can no longer fill
 *  the sentence, which the CLI drops the same way. */
export function describeCaveat(
  locale: Locale,
  caveat: Caveat
): { readonly severity: CaveatSeverity; readonly message: string } | undefined {
  const rendered = toRendered(locale, caveat)
  const message = t(locale, rendered.key, rendered.detail)

  return UNFILLED_PARAM_RE.test(message) ? undefined : { severity: rendered.severity, message }
}

export function renderCaveatLines(
  locale: Locale,
  caveats: readonly Caveat[],
  options: CaveatRenderOptions = {}
): readonly string[] {
  const lines = distinctLines(
    mergeSubjects(caveats.map((caveat) => toRendered(locale, caveat))).flatMap((caveat) => {
      const message = t(locale, caveat.key, caveat.detail)

      return UNFILLED_PARAM_RE.test(message) ? [] : [{ severity: caveat.severity, message }]
    })
  )

  return options.collapseInfo === true ? collapsedLines(locale, lines) : lines.map(toCaveatLine)
}

interface RenderedCaveat {
  readonly code: Caveat['code']
  readonly key: MessageKey
  readonly severity: CaveatSeverity
  readonly detail: Record<string, string | number>
}

interface CaveatRenderOptions {
  /** Join the by-design notes into one line. A surface that states four of them in a row buries the
   *  one degradation among them; the notes keep their own catalog text, so a new one joins the line
   *  rather than needing a hand-written summary to be updated. */
  readonly collapseInfo?: boolean
}

interface RenderedLine {
  readonly severity: CaveatSeverity
  readonly message: string
}

/** Keyed on the rendered sentence, not the code: the same code with different details is two facts,
 *  and the reader can only tell them apart by what they say. */
function distinctLines(lines: readonly RenderedLine[]): readonly RenderedLine[] {
  const seen = new Set<string>()

  return lines.filter((line) => {
    if (seen.has(line.message)) {
      return false
    }

    seen.add(line.message)

    return true
  })
}

function toCaveatLine(line: RenderedLine): string {
  return `${INDENT[1]}${SEVERITY_MARKS[line.severity]} ${line.message}`
}

/** The by-design notes fold away and everything else stays: a note explains how a number was made,
 *  which is detail, while a warning is the reading itself and never goes behind a tap. */
function collapsedLines(locale: Locale, lines: readonly RenderedLine[]): readonly string[] {
  const notes = lines.filter((line) => line.severity === 'info')

  if (notes.length === 0) {
    return lines.map(toCaveatLine)
  }

  return [
    ...lines.filter((line) => line.severity !== 'info').map(toCaveatLine),
    ...toFoldLines(
      `${SEVERITY_MARKS.info} ${t(locale, 'trading.render.layout.methodologyTitle')}`,
      notes.map((line) => line.message)
    ),
  ]
}

function toRendered(locale: Locale, caveat: Caveat): RenderedCaveat {
  const raw = caveat.detail ?? {}
  const detail = renderSubject(locale, raw)

  // Internal ids the catalog names in the reader's language, falling back to the raw id. A
  // confirmer needs two labels: `reasons` says what strained, `confirmers` says which check is blind.
  const { role, reasons, confirmers, section, signs } = detail

  return {
    code: caveat.code,
    key: messageKey(locale, caveat),
    severity: caveatSeverity(caveat),
    detail: {
      ...detail,
      ...renderedShortfall(locale, raw),
      ...(typeof role === 'string'
        ? { role: renderProvidedValue(locale, `trading.debate.role.${role}`, role) }
        : {}),
      ...(typeof reasons === 'string'
        ? { reasons: namedIds(locale, reasons, (id) => `trading.macro.stress.${id}`) }
        : {}),
      ...(typeof signs === 'string'
        ? { signs: namedIds(locale, signs, (id) => `trading.accounts.sign.${id}`) }
        : {}),
      ...(typeof confirmers === 'string'
        ? { confirmers: namedIds(locale, confirmers, (id) => `trading.macro.confirmer.${id}`) }
        : {}),
      ...(typeof section === 'string'
        ? { section: renderProvidedValue(locale, `trading.brief.section.${section}`, section) }
        : {}),
    },
  }
}

/** A caveat whose `count` is 1 reads from its `<code>One` sentence when the catalog carries one. */
function messageKey(locale: Locale, caveat: Caveat): MessageKey {
  const key = `trading.caveat.${caveat.code}` as const
  const one = `${key}One`

  // why-safe: `hasMessage` proves the singular resolves before the string is treated as a key.
  return caveat.detail?.count === 1 && hasMessage(locale, one) ? (one as MessageKey) : key
}

/** `renderSubject` prints a number without a unit, which for money is a different figure in every
 *  book. A currency it cannot read leaves the bare amount rather than throwing mid-message. */
function renderedShortfall(locale: Locale, detail: CaveatDetail): CaveatDetail {
  const { shortfallBase, baseCurrency } = detail

  return typeof shortfallBase === 'number' &&
    typeof baseCurrency === 'string' &&
    isCurrencyCode(baseCurrency)
    ? { shortfallBase: formatMoney(locale, shortfallBase, baseCurrency) }
    : {}
}

function namedIds(locale: Locale, ids: string, key: (id: string) => `trading.${string}`): string {
  return ids
    .split(CAVEAT_SUBJECT_SEPARATOR)
    .map((id) => renderProvidedValue(locale, key(id), id))
    .join(CAVEAT_SUBJECT_SEPARATOR)
}

/** Which detail field names *who* each caveat is about. A code earns a row here only once its two
 *  catalog sentences read for a list of subjects as well as for one - which is what every mergeable
 *  sentence gets by naming its subject first. A code absent from the table never merges. */
const SUBJECT_FIELD: Readonly<Record<string, string>> = Object.freeze({
  'portfolio.regime-risk': 'segment',
  'portfolio.segment-no-candidates': 'segment',
  'portfolio.targets-renormalized': 'segment',
  'portfolio.targets-unfilled': 'segment',
  'portfolio.concentration-unchecked': 'ticker',
  'portfolio.unmeasured-volatility': 'ticker',
  'portfolio.increases-underfunded': 'segment',
  'portfolio.too-few-candidates': 'segment',
  'portfolio.candidates-available': 'segment',
  'portfolio.candidates-by-name': 'segment',
  'valuation.price-stale': 'ticker',
  'market-data.series-stale': 'ticker',
  'market-data.trade-sides-missed': 'ticker',
  'source.symbol-not-found': 'ticker',
})

/** Three segments with no eligible names, or four holdings marked on the same stale day, emit the
 *  same sentence three and four times. Merging keeps the fact and drops the repetition; anything
 *  differing beyond the subject stays its own line. */
function mergeSubjects(caveats: readonly RenderedCaveat[]): readonly RenderedCaveat[] {
  const bySubject = new Map<string, RenderedCaveat>()
  const lines: RenderedCaveat[] = []

  for (const caveat of caveats) {
    const field = SUBJECT_FIELD[caveat.code]

    if (field === undefined || caveat.detail[field] === undefined) {
      lines.push(caveat)
      continue
    }

    const { [field]: subject, ...rest } = caveat.detail
    const key = `${caveat.code}:${field}:${JSON.stringify(rest)}`
    const merged = bySubject.get(key)

    if (merged === undefined) {
      bySubject.set(key, caveat)
      lines.push(caveat)
      continue
    }

    // Several reads of one name each report it: the subject is listed once.
    const named = `${merged.detail[field]}`.split(CAVEAT_SUBJECT_SEPARATOR)

    if (!named.includes(`${subject}`)) {
      merged.detail[field] = `${merged.detail[field]}${CAVEAT_SUBJECT_SEPARATOR}${subject}`
    }
  }

  return lines
}

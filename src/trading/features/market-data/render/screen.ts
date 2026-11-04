import type { Locale } from '@/core/types/locale'
import type { ScreenBoard } from '@/trading/features/market-data/render/screen-evidence'
import type { ScreenedCandidate, ScreenView } from '@/trading/features/market-data/types'
import type { InstrumentKind, MarketRef, PriceDisplay } from '@/trading/kernel/instrument'
import type { ScreenResult } from '@/trading/kernel/market/market-capability'
import type { ScreenRating } from '@/trading/markets/screen-rating'
import type { RenderContext } from '@/trading/render/format'
import { pluralKey, t } from '@/i18n'
import {
  metricsFold,
  renderBoardRow,
  renderCandidateBlock,
} from '@/trading/features/market-data/render/screen-evidence'
import {
  renderMoverLines,
  renderRejectionLines,
} from '@/trading/features/market-data/render/screen-footer'
import { EXTREME_SCORE_AT, MILD_SCORE_AT } from '@/trading/kernel/conviction'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { boardMedians } from '@/trading/markets/factor-scoring'
import { screenRating } from '@/trading/markets/screen-rating'
import { renderCaveatLines } from '@/trading/render/caveat'
import {
  formatCount,
  formatScoreValue,
  renderDeclaredValue,
  SECTION_ICONS,
} from '@/trading/render/format'
import {
  INDENT,
  INLINE_SEPARATOR,
  joinSections,
  renderAsOf,
  renderProvenanceLine,
  renderSectionTitle,
  toFactLines,
} from '@/trading/render/layout'
import { renderBoardScaleNotes } from '@/trading/render/money'

/** The ratings that answer "is there anything to buy here". */
const BUY_RATINGS: ReadonlySet<ScreenRating> = new Set(['strong-buy', 'buy'])

/** The market and its board convention travel as parameters because `ScreenResult` echoes neither,
 *  and a ranking without its market reads as a claim about the whole world. */
interface ScreenRenderRequest {
  readonly market: MarketRef
  readonly context: RenderContext
  readonly display?: PriceDisplay
  /** Named when the board was narrowed to one kind. A market that screens both equities and ETFs
   *  produces two boards that are otherwise indistinguishable in the output. */
  readonly instrumentKind?: InstrumentKind
  /** Names of a board listing printed in text; absent prints them all. */
  readonly shown?: number
}

export function renderScreenText(
  locale: Locale,
  request: ScreenRenderRequest,
  result: ScreenView
): string {
  if (result.form === 'board') {
    return renderBoardText(locale, request, result)
  }

  if (result.candidates.length === 0) {
    // An empty universe never reached the gates, so saying nothing cleared them names the wrong
    // cause; the caveat below carries the real one.
    return joinSections([
      [renderSectionTitle(SECTION_ICONS.screen, renderEmptyTitle(locale, request, result))],
      renderRejectionLines(locale, result.rejections),
      renderMoverLines(locale, result.movers),
      renderCaveatLines(locale, result.caveats),
    ])
  }

  const board = boardOf(request, result)

  return joinSections([
    [
      `${renderSectionTitle(SECTION_ICONS.screen, renderTitle(locale, request, result))}${renderAsOf(locale, result.dataThroughDay ?? result.asOf)}`,
      ...renderBoardUnitLine(locale, request, result),
      ...toFactLines(rankedNoteFacts(locale, result.candidates), request.context, 1),
      ...result.candidates.flatMap((candidate, index) =>
        renderCandidateBlock(locale, { candidate, index, gated: result.board === 'gate' }, board)
      ),
      ...metricsFold(locale, result.candidates, board),
      ...renderProvenanceLine(locale, result.provenance, request.context.timezone),
    ],
    renderRejectionLines(locale, result.rejections),
    renderMoverLines(locale, result.movers),
    renderCaveatLines(locale, result.caveats),
  ])
}

/** One ranked name as `/screen` prints it: its row, then what the rank was taken on. */
export interface ScreenCardRow {
  readonly key: string
  readonly line: string
  readonly evidence: readonly string[]
}

/** The board an app shows: the lines `/screen` prints, without the indentation a chat needs (the
 *  app lays the lines out itself). */
export interface ScreenCard {
  readonly title: string
  readonly notes: readonly string[]
  readonly rows: readonly ScreenCardRow[]
  readonly metrics: readonly string[]
  readonly provenance: readonly string[]
  readonly rejections: readonly string[]
  readonly movers: readonly string[]
  readonly caveats: readonly string[]
}

export function renderScreenCard(
  locale: Locale,
  request: ScreenRenderRequest,
  result: ScreenView
): ScreenCard {
  if (result.form === 'board') {
    return renderBoardCard(locale, request, result)
  }

  const board = boardOf(request, result)
  const empty = result.candidates.length === 0

  return {
    title: empty
      ? renderEmptyTitle(locale, request, result)
      : `${renderTitle(locale, request, result)}${renderAsOf(locale, result.dataThroughDay ?? result.asOf)}`,
    notes: empty
      ? []
      : trimmed([
          ...renderBoardUnitLine(locale, request, result),
          ...cardNote(rankedNoteFacts(locale, result.candidates)),
        ]),
    rows: result.candidates.map((candidate, index) => {
      const [line = '', ...evidence] = renderCandidateBlock(
        locale,
        { candidate, index, gated: result.board === 'gate' },
        board
      )

      return {
        key: buildInstrumentKey(candidate.instrument),
        line: line.trimStart(),
        evidence: trimmed(evidence),
      }
    }),
    metrics: trimmed(empty ? [] : metricsFold(locale, result.candidates, board)),
    provenance: trimmed(
      empty ? [] : renderProvenanceLine(locale, result.provenance, request.context.timezone)
    ),
    rejections: trimmed(renderRejectionLines(locale, result.rejections)),
    movers: trimmed(renderMoverLines(locale, result.movers)),
    caveats: trimmed(renderCaveatLines(locale, result.caveats)),
  }
}

/** The whole priced board in ticker order, one row per name. A chat holds a screenful, so `shown`
 *  cuts how many names print, never which are on the board. */
function renderBoardText(locale: Locale, request: ScreenRenderRequest, result: ScreenView): string {
  const board = boardOf(request, result)
  const shown = result.candidates.slice(0, request.shown ?? result.candidates.length)
  const notes = boardNoteFacts(locale, result, shown.length)

  return joinSections([
    [
      `${renderSectionTitle(SECTION_ICONS.screen, renderBoardTitle(locale, request, result))}${renderAsOf(locale, result.dataThroughDay ?? result.asOf)}`,
      ...(result.candidates.length === 0 ? [] : renderPriceUnitLine(locale, request, result)),
      ...toFactLines(notes, request.context, 1),
      ...shown.flatMap((candidate) => renderBoardRow(locale, candidate, board)),
      ...renderProvenanceLine(locale, result.provenance, request.context.timezone),
    ],
    renderRejectionLines(locale, result.rejections),
    renderCaveatLines(locale, result.caveats),
  ])
}

/** The app lists the names itself, from the structured candidates; the card carries what surrounds
 *  them. The page is the board, so it is not told where the board is. */
function renderBoardCard(
  locale: Locale,
  request: ScreenRenderRequest,
  result: ScreenView
): ScreenCard {
  const hasNames = result.candidates.length > 0

  return {
    title: `${renderBoardTitle(locale, request, result)}${renderAsOf(locale, result.dataThroughDay ?? result.asOf)}`,
    notes: trimmed(
      hasNames
        ? [
            ...renderPriceUnitLine(locale, request, result),
            ...cardNote(boardNoteFacts(locale, result)),
          ]
        : []
    ),
    rows: [],
    metrics: [],
    provenance: trimmed(
      hasNames ? renderProvenanceLine(locale, result.provenance, request.context.timezone) : []
    ),
    rejections: trimmed(renderRejectionLines(locale, result.rejections)),
    movers: [],
    caveats: trimmed(renderCaveatLines(locale, result.caveats)),
  }
}

/** A board that priced nothing says so rather than reading as every name being filtered out. */
function renderBoardTitle(
  locale: Locale,
  request: ScreenRenderRequest,
  result: ScreenView
): string {
  const market = renderDeclaredValue(locale, `trading.market.${request.market}`)
  const unpriced = result.unpriced ?? 0

  if (result.candidates.length === 0) {
    return unpriced > 0
      ? t(locale, 'trading.render.screen.boardNoPrices', {
          market,
          count: formatCount(locale, unpriced),
        })
      : renderEmptyTitle(locale, request, result)
  }

  const count = formatCount(locale, result.candidates.length)

  return request.instrumentKind === undefined
    ? t(locale, 'trading.render.screen.boardTitle', { market, count })
    : t(locale, 'trading.render.screen.boardTitleKind', {
        market,
        count,
        kind: renderDeclaredValue(locale, `trading.instrument-kind.${request.instrumentKind}`),
      })
}

/** What a reader needs before the rows, as short facts that wrap whole: how the names are ordered,
 *  what the chat leaves out, and where the board's own controls are. `shown` is set only where
 *  names were cut for a chat, which is also the only place a pointer to the page helps. */
function boardNoteFacts(locale: Locale, result: ScreenView, shown?: number): readonly string[] {
  const unpriced = result.unpriced ?? 0

  return [
    t(locale, 'trading.render.screen.boardNote'),
    ...(shown === undefined ? [] : [t(locale, 'trading.render.screen.boardTools')]),
    ...(unpriced === 0
      ? []
      : [
          t(
            locale,
            pluralKey(
              unpriced,
              'trading.render.screen.boardUnpricedOne',
              'trading.render.screen.boardUnpriced'
            ),
            { count: formatCount(locale, unpriced) }
          ),
        ]),
    ...(shown === undefined || shown >= result.candidates.length
      ? []
      : [
          t(locale, 'trading.render.screen.boardShown', {
            shown: formatCount(locale, shown),
            count: formatCount(locale, result.candidates.length),
          }),
        ]),
  ]
}

/** An app lays its own lines out, so its notes are one line however long. */
function cardNote(facts: readonly string[]): readonly string[] {
  return facts.length === 0 ? [] : [`${INDENT[1]}${facts.join(INLINE_SEPARATOR)}`]
}

function trimmed(lines: readonly string[]): readonly string[] {
  return lines.map((line) => line.trimStart())
}

/** An empty universe never reached the gates, so saying nothing cleared them names the wrong cause;
 *  the caveat below carries the real one. A narrowed board still says which kind it screened. */
function renderEmptyTitle(
  locale: Locale,
  request: ScreenRenderRequest,
  result: ScreenResult
): string {
  const market = renderDeclaredValue(locale, `trading.market.${request.market}`)
  const empty = result.universeSize === 0

  if (request.instrumentKind === undefined) {
    return t(locale, empty ? 'trading.render.screen.noUniverse' : 'trading.render.screen.empty', {
      market,
    })
  }

  return t(
    locale,
    empty ? 'trading.render.screen.noUniverseKind' : 'trading.render.screen.emptyKind',
    {
      market,
      kind: renderDeclaredValue(locale, `trading.instrument-kind.${request.instrumentKind}`),
    }
  )
}

/** A board narrowed to one instrument kind says so: an ETF board and an equity board on the same
 *  market score different factors and are otherwise identical in the output.
 *
 *  A gate board takes its own heading, selected from what the board declares itself to be and never
 *  from the market's id: "top 2 of 3" claims a selection a segment of correlated names cannot make. */
function renderTitle(locale: Locale, request: ScreenRenderRequest, result: ScreenResult): string {
  const shared = {
    market: renderDeclaredValue(locale, `trading.market.${request.market}`),
    count: formatCount(locale, result.candidates.length),
    universe: formatCount(locale, result.universeSize),
  }

  if (result.board === 'gate') {
    return t(locale, 'trading.render.screen.gateTitle', shared)
  }

  if (request.instrumentKind === undefined) {
    return t(locale, 'trading.render.screen.title', shared)
  }

  return t(locale, 'trading.render.screen.titleKind', {
    ...shared,
    kind: renderDeclaredValue(locale, `trading.instrument-kind.${request.instrumentKind}`),
  })
}

/** The whole board is one market, so its convention is named once above the rows rather than on
 *  each of them - through the note every other price surface uses, so one fact reads one way. */
function renderBoardUnitLine(
  locale: Locale,
  request: ScreenRenderRequest,
  result: ScreenResult
): readonly string[] {
  return renderBoardScaleNotes(locale, [
    {
      market: request.market,
      ...(result.currency === undefined ? {} : { currency: result.currency }),
      ...(request.display === undefined ? {} : { display: request.display }),
    },
  ]).map((note) => `${INDENT[1]}${note}`)
}

/** A board that prints bare prices says what they are in, once: the board's scale where the market
 *  has one, else its currency. */
function renderPriceUnitLine(
  locale: Locale,
  request: ScreenRenderRequest,
  result: ScreenResult
): readonly string[] {
  const scaled = renderBoardUnitLine(locale, request, result)

  if (scaled.length > 0 || result.currency === undefined) {
    return scaled
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.screen.boardUnit', {
      market: renderDeclaredValue(locale, `trading.market.${request.market}`),
      currency: result.currency,
    })}`,
  ]
}

function boardOf(request: ScreenRenderRequest, result: ScreenResult): ScreenBoard {
  return {
    currency: result.currency,
    display: request.display,
    context: request.context,
    medians: boardMedians(result.candidates.map((candidate) => candidate.factors)),
    day: result.dataThroughDay ?? result.asOf,
  }
}

/** What a ranked board's numbers mean and, when nothing on it clears the bar, that this is the
 *  market's condition and not a scoring failure. One scale for every market, so it is stated once
 *  above the board. */
function rankedNoteFacts(
  locale: Locale,
  candidates: readonly ScreenedCandidate[]
): readonly string[] {
  return [
    t(locale, 'trading.render.screen.scale', {
      mild: formatScoreValue(locale, MILD_SCORE_AT),
      extreme: formatScoreValue(locale, EXTREME_SCORE_AT),
    }),
    ...noBuysFact(locale, candidates),
  ]
}

/** A board of nothing but holds otherwise reads as a scoring failure rather than the market
 *  condition it is. Scoped to what is shown: the board is truncated to the requested size, so
 *  "nothing here clears the bar" is the exact claim and "nothing in the market does" is not. */
function noBuysFact(locale: Locale, candidates: readonly ScreenedCandidate[]): readonly string[] {
  const [first] = candidates
  // A name the operator asked to skip is never bought, so its rating clears nothing.
  const buyable = candidates.some(
    (candidate) => candidate.excluded === undefined && BUY_RATINGS.has(screenRating(candidate))
  )

  if (first === undefined || buyable) {
    return []
  }

  return [
    t(locale, 'trading.render.screen.noBuys', {
      rating: renderDeclaredValue(locale, `trading.rating.${screenRating(first)}`),
    }),
  ]
}

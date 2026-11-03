import type { ScreenResponse } from '@/app/server/wire/market'
import type { ScreenAnswer, ScreenView } from '@/trading/api'
import { toInstrumentWire } from '@/app/server/mappers/trading'

type ScreenedCandidate = ScreenView['candidates'][number]
type CandidateWire = ScreenResponse['candidates'][number]

/** Where a page of a `list` board starts and how many names it holds. */
interface ScreenPage {
  readonly offset: number
  readonly limit: number
}

function toCandidateWire(candidate: ScreenedCandidate): CandidateWire {
  const quote = candidate.price?.quote

  return {
    instrument: toInstrumentWire(candidate.instrument),
    ...(candidate.name === undefined ? {} : { name: candidate.name }),
    ...(quote === undefined ? {} : { price: quote.price }),
    ...(quote?.changePct === undefined ? {} : { changePct: quote.changePct }),
  }
}

export function toScreenWire(market: string, answer: ScreenAnswer): ScreenResponse {
  const { view, card } = answer

  return {
    market,
    asOf: view.asOf,
    ...(view.dataThroughDay === undefined ? {} : { dataThroughDay: view.dataThroughDay }),
    board: boardKindOf(view),
    universeSize: view.universeSize,
    candidates:
      view.form === 'board'
        ? view.candidates.map((candidate) => toListedWire(candidate, answer))
        : view.candidates.map(toCandidateWire),
    ...(view.form === 'board'
      ? { total: view.candidates.length, unpriced: view.unpriced ?? 0 }
      : {}),
    card,
  }
}

function boardKindOf(view: ScreenView): ScreenResponse['board'] {
  return view.form === 'board' ? 'list' : (view.board ?? 'rank')
}

/** A name of the whole board: no composite, band or rating, only what each factor read and where it
 *  sits among the board's names. Fixed factor order, so two names line up. */
function toListedWire(candidate: ScreenedCandidate, answer: ScreenAnswer): CandidateWire {
  const factors = candidate.factors
    .filter((factor) => factor.weight !== undefined)
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .map((factor) => {
      const percentile = candidate.percentiles?.[factor.id]

      return {
        id: factor.id,
        label: answer.factorLabels?.[factor.id] ?? factor.id,
        value: factor.score,
        ...(percentile === undefined ? {} : { percentile }),
      }
    })

  return { ...toCandidateWire(candidate), factors }
}

/** One page of a `list` board, cut from the whole board the host read; any other board is one page.
 *  `next` is the offset the following page starts at. */
export function toScreenPage(board: ScreenResponse, page: ScreenPage): ScreenResponse {
  if (board.board !== 'list') {
    return board
  }

  const end = page.offset + page.limit

  return {
    ...board,
    candidates: board.candidates.slice(page.offset, end),
    ...(end < board.candidates.length ? { next: String(end) } : {}),
  }
}

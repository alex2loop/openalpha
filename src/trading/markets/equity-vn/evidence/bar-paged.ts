import type { InstrumentRef, Ticker } from '@/trading/kernel/instrument'
import type { BarRecord } from '@/trading/kernel/market/market-data'
import type { DayWindow } from '@/trading/markets/admissibility'
import type { EvidenceScope } from '@/trading/markets/equity-vn/evidence/evidence'
import { writeBarWindows } from '@/trading/markets/bars'
import {
  BACKFILL_MINIMUM_TARGETS,
  type BarOutcome,
  boardTickers,
  chunkWindows,
  createWindowedProgress,
  fetchAllBars,
  fullWindow,
  joinOutcomes,
} from '@/trading/markets/equity-vn/evidence/bar-fetch'
import { invalidateWhenWritten } from '@/trading/markets/equity-vn/evidence/evidence'
import { VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'

/** What the paged load already put in the store: the names it holds as outcomes with no records
 *  left in them, the ones fetched whole after it, and the rows written for the first. */
interface PagedHistory {
  readonly outcomes: readonly BarOutcome[]
  readonly recordCount: number
}

interface WindowWrite {
  readonly fetched: readonly BarOutcome[]
  readonly chunk: DayWindow
  readonly isLast: boolean
}

/** Stands in for the records of a name every window answered for: they are in the store already,
 *  and the outcome only still carries its provenance and caveats. */
const WRITTEN: readonly BarRecord[] = Object.freeze([])

/** The web's first history load: a market with no completed pass on record, so a retry after a load
 *  cut short pages again however many rows it left, on a board wide enough to share windows. A
 *  forced pass and a restatement rebuild are not it, and keep the one write at the end on every
 *  edition; so does an edition that did not ask for paged writes. */
export function splitInitialHistory(
  scope: EvidenceScope,
  rebuild: readonly InstrumentRef[]
): { readonly initial: readonly InstrumentRef[]; readonly rest: readonly InstrumentRef[] } {
  if (
    scope.deps.pagedBackfill !== true ||
    scope.request.forced === true ||
    scope.storedFrom !== undefined
  ) {
    return { initial: [], rest: rebuild }
  }

  const board = boardTickers(scope)
  const initial = rebuild.filter((target) => board.has(target.ticker))

  if (initial.length < BACKFILL_MINIMUM_TARGETS) {
    return { initial: [], rest: rebuild }
  }

  const loading = new Set(initial.map((target) => target.ticker))

  return { initial, rest: rebuild.filter((target) => !loading.has(target.ticker)) }
}

/** Windows run in sequence like `fetchChunkedBars`, but each is written before the next is fetched,
 *  so no more than one window of bars is held. A name some window did not answer for (or the store
 *  refused) is fetched whole afterwards and written with the final write; windows already written
 *  stay, and a pass cut short leaves them with no attempt row, so the next pass starts again. */
export async function fetchPagedHistory(
  scope: EvidenceScope,
  targets: readonly InstrumentRef[]
): Promise<PagedHistory> {
  if (targets.length === 0) {
    return { outcomes: [], recordCount: 0 }
  }

  const merged = new Map<Ticker, BarOutcome>()
  const counts = new Map<Ticker, number>()
  const chunks = chunkWindows(scope.calendar, fullWindow(scope))
  const progress = createWindowedProgress(scope, targets.length, chunks.length)

  for (const [index, chunk] of chunks.entries()) {
    const fetched = await fetchAllBars(scope, targets, { window: chunk, progress })
    const refused = await writeWindow(scope, {
      fetched,
      chunk,
      isLast: index === chunks.length - 1,
    })

    for (const outcome of fetched) {
      const { ticker } = outcome.instrument
      const held = merged.get(ticker)
      const settled = toWritten(outcome, refused.has(ticker))

      counts.set(
        ticker,
        (counts.get(ticker) ?? 0) + (settled.value === undefined ? 0 : (outcome.value?.length ?? 0))
      )
      merged.set(ticker, held === undefined ? settled : joinOutcomes(held, settled, () => WRITTEN))
    }
  }

  const answered = [...merged.values()].filter((outcome) => outcome.value !== undefined)
  const lost = [...merged.values()].filter((outcome) => outcome.value === undefined)

  return {
    outcomes: [...answered, ...(await fetchWhole(scope, lost))],
    // Only names every window answered for: a lost name's earlier windows are counted by its own
    // whole refetch, not twice.
    recordCount: answered.reduce(
      (sum, outcome) => sum + (counts.get(outcome.instrument.ticker) ?? 0),
      0
    ),
  }
}

function fetchWhole(
  scope: EvidenceScope,
  lost: readonly BarOutcome[]
): Promise<readonly BarOutcome[]> {
  const targets = lost.map((outcome) => outcome.instrument)

  return fetchAllBars(scope, targets, { window: fullWindow(scope) })
}

/** The names the store refused for joining a different adjustment basis. */
async function writeWindow(
  scope: EvidenceScope,
  window: WindowWrite
): Promise<ReadonlySet<string>> {
  const written = await writeBarWindows({
    deps: scope.deps,
    market: VN_MARKET_REF,
    toDay: window.chunk.toDay,
    // Only the last window ends at the pass's own day, where a name's tail can really stop short.
    trimTail: window.isLast,
    writes: window.fetched.map((outcome) => ({ outcome, fromDay: window.chunk.fromDay })),
    signal: scope.request.signal,
  })

  invalidateWhenWritten(scope, written.recordCount)

  return new Set(written.conflicted.map((instrument) => instrument.ticker))
}

/** A window the store refused, for joining a different adjustment basis, reads as one that did not
 *  answer for the name. */
function toWritten(outcome: BarOutcome, refused: boolean): BarOutcome {
  const { instrument, provenance, caveats } = outcome

  return outcome.value === undefined || refused
    ? { instrument, provenance, caveats }
    : { instrument, value: WRITTEN, provenance, caveats }
}

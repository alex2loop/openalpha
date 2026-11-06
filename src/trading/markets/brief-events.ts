import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { MarketBriefRequest } from '@/trading/kernel/market/market-capability'
import type { MarketEvent } from '@/trading/kernel/market/market-event'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { BriefDeps } from '@/trading/markets/deps'
import type { TradingCalendar } from '@/trading/markets/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { dedupeProvenance } from '@/trading/kernel/source/source-result'

export interface DatedEvent {
  readonly instrument: InstrumentRef
  readonly event: MarketEvent
}

/** A failed target contributes its caveats without removing another target's events. */
export interface EventTarget {
  readonly rows: readonly DatedEvent[]
  readonly available: boolean
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

export interface EventWindow {
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

/** Every dated action inside the window, soonest first, before any section's display cap: what a
 *  reminder is built from, since a held name's ex-date past the cap is no less owed to the book. */
export interface EventsRead {
  readonly rows: readonly DatedEvent[]
  /** Every target answered, so no rows is a quiet calendar rather than a failed read. */
  readonly isComplete: boolean
  readonly caveats: readonly Caveat[]
  readonly provenance: readonly SourceProvenance[]
}

export interface EventsReadInput {
  readonly deps: BriefDeps
  readonly request: MarketBriefRequest
  readonly calendar: TradingCalendar
  /** The names whose calendar is read, and what capping them left unsaid. */
  readonly calendarNames: {
    readonly names: readonly InstrumentRef[]
    readonly caveats: readonly Caveat[]
  }
}

interface CollectOptions {
  readonly concurrency: number
  read(instrument: InstrumentRef): Promise<EventTarget>
}

/** Read live across the bounded name set rather than warmed into a cache: the horizon is a handful
 *  of names and a fortnight, and a stale corporate calendar is worse than a slow one. Each home
 *  market says how one name is read; the fan-out, dedupe and order are the same for all. */
export async function collectEvents(
  input: EventsReadInput,
  options: CollectOptions
): Promise<EventsRead> {
  const targets = await mapWithConcurrency(
    input.calendarNames.names,
    options.concurrency,
    options.read
  )

  return {
    rows: sortEvents(dedupeEvents(targets.flatMap((target) => target.rows))),
    isComplete: targets.every((target) => target.available),
    caveats: dedupeCaveats([
      ...input.calendarNames.caveats,
      ...targets.flatMap((target) => target.caveats),
    ]),
    provenance: dedupeProvenance(targets.flatMap((target) => target.provenance)),
  }
}

/** Without a provider id the whole value is the identity: two genuinely distinct events on one day
 *  would otherwise collapse into one line. */
function dedupeEvents(rows: readonly DatedEvent[]): readonly DatedEvent[] {
  const seen = new Set<string>()

  return rows.filter((row) => {
    const subject = buildInstrumentKey(row.instrument)
    const key =
      row.event.providerEventId === undefined
        ? `${subject}|${row.event.at}|${row.event.kind}|${row.event.title}`
        : `${subject}|${row.event.providerEventId}`

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function sortEvents(rows: readonly DatedEvent[]): readonly DatedEvent[] {
  return [...rows].sort(
    (left, right) =>
      left.event.at.localeCompare(right.event.at) ||
      left.instrument.ticker.localeCompare(right.instrument.ticker)
  )
}

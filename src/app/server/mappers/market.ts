import type {
  AlertWire,
  InstrumentSearchResponse,
  MacroResponse,
  MarketsResponse,
  OverviewResponse,
  ScreenResponse,
} from '@/app/server/wire/market'
import type { Locale } from '@/core/types/locale'
import type {
  Alert,
  InstrumentMatch,
  MarketDataOverview,
  ScreenAnswer,
  ScreenView,
  TradingMacroView,
  TradingMarketsView,
} from '@/trading/api'
import { toCaveatWires, toInstrumentWire } from '@/app/server/mappers/trading'
import { MACRO_SCORE_RANGE, parseExitLevel } from '@/trading/api'

type ScreenedCandidate = ScreenView['candidates'][number]
type OverviewRow = MarketDataOverview['rows'][number]

function toCandidateWire(candidate: ScreenedCandidate): ScreenResponse['candidates'][number] {
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
    board: view.board ?? 'rank',
    universeSize: view.universeSize,
    candidates: view.candidates.map(toCandidateWire),
    card,
  }
}

export function toMarketsWire(view: TradingMarketsView): MarketsResponse {
  return {
    homeRegion: view.homeRegion,
    markets: view.markets.map((market) => ({
      market: market.market,
      currency: market.currency,
      quoteUnit: market.unit,
      ...(market.display === undefined ? {} : { priceDisplay: market.display }),
      region: market.region,
      ownsRegion: market.ownsRegion,
      segment: market.segment,
      label: market.label,
      segmentLabel: market.segmentLabel,
      regionLabel: market.regionLabel,
      icon: market.icon,
      ...(market.benchmark === undefined ? {} : { benchmark: toInstrumentWire(market.benchmark) }),
      hasBoard: market.hasBoard,
      hasBrief: market.hasBrief,
      hasEvents: market.hasEvents,
    })),
  }
}

export function toSearchWire(matches: readonly InstrumentMatch[]): InstrumentSearchResponse {
  return {
    matches: matches.map((match) => ({
      instrument: toInstrumentWire(match.instrument),
      ...(match.name === undefined ? {} : { name: match.name }),
      ...(match.instrumentKind === undefined ? {} : { kind: match.instrumentKind }),
    })),
  }
}

/** A live reading wins while the market trades; otherwise the settled close stands. */
function toOverviewRowWire(row: OverviewRow): OverviewResponse['markets'][number]['rows'][number] {
  const instrument = toInstrumentWire(row.instrument)

  if (row.live !== undefined) {
    return {
      instrument,
      price: row.live.price,
      ...(row.live.changePct === undefined ? {} : { changePct: row.live.changePct }),
      observedAt: row.live.observedAt,
    }
  }

  return {
    instrument,
    ...(row.quote === undefined ? {} : { price: row.quote.price }),
    ...(row.changePct === undefined ? {} : { changePct: row.changePct }),
    ...(row.closedOn === undefined ? {} : { closedOn: row.closedOn }),
  }
}

export function toOverviewWire(
  blocks: readonly MarketDataOverview[],
  locale: Locale
): OverviewResponse {
  return {
    markets: blocks.map((block) => ({
      market: block.market,
      asOf: block.asOf,
      ...(block.sessionState === undefined ? {} : { sessionState: block.sessionState }),
      currency: block.currency,
      ...(block.priceCurrency === undefined ? {} : { priceCurrency: block.priceCurrency }),
      rows: block.rows.map(toOverviewRowWire),
      ...(block.breadth === undefined
        ? {}
        : {
            breadth: {
              advancers: block.breadth.advancers,
              decliners: block.breadth.decliners,
              measured: block.breadth.measured,
            },
          }),
      ...(block.foreignNetValue === undefined ? {} : { foreignNetValue: block.foreignNetValue }),
      caveats: toCaveatWires(block.caveats, locale),
    })),
  }
}

export function toMacroWire(view: TradingMacroView, locale: Locale): MacroResponse {
  const { result } = view

  if (result.kind === 'unavailable') {
    return {
      region: view.region,
      status: 'unavailable',
      caveats: toCaveatWires(result.caveats, locale),
    }
  }

  const macro = result.value

  return {
    region: view.region,
    status: 'ready',
    asOf: macro.asOf,
    ...(macro.provenance.length === 0
      ? {}
      : { readAt: Math.max(...macro.provenance.map((read) => read.fetchedAt)) }),
    regime: macro.regime,
    scoreRegime: macro.scoreRegime,
    score: macro.score,
    ...(view.lean === undefined ? {} : { lean: view.lean }),
    scoreRange: { ...MACRO_SCORE_RANGE },
    coverage: macro.coverage,
    drivers: macro.drivers.map((driver) => ({
      id: driver.id,
      label: view.labels[driver.id] ?? driver.id,
      unit: driver.unit,
      value: driver.value,
      asOf: driver.asOf,
      weight: driver.weight,
      bearishAt: driver.bearishAt,
      bullishAt: driver.bullishAt,
      contribution: driver.contribution,
    })),
    missing: macro.missing.map((driver) => ({ id: driver.id, reason: driver.reason })),
    caveats: toCaveatWires([...macro.caveats, ...result.caveats], locale),
  }
}

function alertSource(alert: Alert): Pick<AlertWire, 'source' | 'level'> {
  const level = parseExitLevel(alert.origin)

  if (level !== null) {
    return { source: 'plan', level }
  }

  return { source: alert.origin === undefined ? 'you' : 'screen' }
}

/** `delivering` is a send in flight, which reads as triggered to anyone outside the daemon. */
export function toAlertWire(alert: Alert): AlertWire {
  const base = {
    id: alert.id,
    instrument: toInstrumentWire(alert.instrument),
    condition: alert.condition,
    threshold: alert.threshold,
    ...alertSource(alert),
    channel: alert.delivery.channel,
    createdAt: alert.createdAt,
  }

  switch (alert.state) {
    case 'active':
      return { ...base, state: 'active' }

    case 'disabled':
      return { ...base, state: 'disabled', disabledAt: alert.disabledAt }

    case 'fired':
      return {
        ...base,
        state: 'fired',
        triggeredAt: alert.triggeredAt,
        observedPrice: alert.observedPrice,
        firedAt: alert.firedAt,
      }

    default:
      return {
        ...base,
        state: 'triggered',
        triggeredAt: alert.triggeredAt,
        observedPrice: alert.observedPrice,
      }
  }
}

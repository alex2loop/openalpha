import type {
  AlertWire,
  InstrumentSearchResponse,
  MacroResponse,
  MarketSessionWire,
  MarketsResponse,
  SectorsResponse,
  SourcesResponse,
} from '@/app/server/wire/market'
import type {
  OverviewLeadersWire,
  OverviewLeaderWire,
  OverviewMoversWire,
  OverviewMoverWire,
  OverviewResponse,
} from '@/app/server/wire/overview'
import type * as Vocab from '@/app/server/wire/vocab'
import type { Locale } from '@/core/types/locale'
import type {
  Alert,
  AssetClass,
  BriefSectionKind,
  CaveatSeverity,
  ConvictionBand,
  InstrumentKind,
  InstrumentMatch,
  InvestmentGoal,
  InvestmentHorizon,
  MacroRiskView,
  MarketDataOverview,
  MarketEventKind,
  MarketView,
  NavWindow,
  RiskLevel,
  SessionPhase,
  SourceFreshness,
  SourceStatus,
  TradingMacroView,
  TradingMarketsView,
  TradingSectorsView,
  TypedPrice,
} from '@/trading/api'
import { toCaveatWires, toDealerBoardWire, toInstrumentWire } from '@/app/server/mappers/trading'
import {
  changeAgainstClose,
  MACRO_SCORE_RANGE,
  parseExitLevel,
  renderOverviewForSurface,
} from '@/trading/api'

// A closed vocabulary the wire copies in `wire/vocab.ts` must match its trading source both ways, so
// a value added on either side fails typecheck here.
type Same<Wire, Source> = [Wire] extends [Source] ? ([Source] extends [Wire] ? true : false) : false

// A bare expression: a const would trip noUnusedLocals and an export the unused-exports gate.
;({
  assetClass: true,
  briefSectionKind: true,
  caveatSeverity: true,
  convictionBand: true,
  instrumentKind: true,
  investmentGoal: true,
  investmentHorizon: true,
  marketEventKind: true,
  navWindow: true,
  riskLevel: true,
  sessionPhase: true,
  sourceFreshness: true,
  typedPrice: true,
}) as const satisfies {
  assetClass: Same<Vocab.AssetClass, AssetClass>
  briefSectionKind: Same<Vocab.BriefSectionKind, BriefSectionKind>
  caveatSeverity: Same<Vocab.CaveatSeverity, CaveatSeverity>
  convictionBand: Same<Vocab.ConvictionBand, ConvictionBand>
  instrumentKind: Same<Vocab.InstrumentKind, InstrumentKind>
  investmentGoal: Same<Vocab.InvestmentGoal, InvestmentGoal>
  investmentHorizon: Same<Vocab.InvestmentHorizon, InvestmentHorizon>
  marketEventKind: Same<Vocab.MarketEventKind, MarketEventKind>
  navWindow: Same<Vocab.NavWindow, NavWindow>
  riskLevel: Same<Vocab.RiskLevel, RiskLevel>
  sessionPhase: Same<Vocab.SessionPhase, SessionPhase>
  sourceFreshness: Same<Vocab.SourceFreshness, SourceFreshness>
  typedPrice: Same<Vocab.TypedPrice, TypedPrice>
}

type OverviewRow = MarketDataOverview['rows'][number]

/** Absent for a market that never closes: it has neither hours nor a day. */
function toSessionWire({ session, day }: MarketView): MarketSessionWire | undefined {
  if (session === undefined || day === undefined) {
    return undefined
  }

  const { exchange, timezone, open, close, breaks, closeAuction } = day.hours ?? session

  return {
    ...(exchange === undefined ? {} : { exchange }),
    timeZone: timezone,
    open,
    close,
    ...(breaks === undefined ? {} : { breaks }),
    ...(closeAuction === undefined ? {} : { closeAuction }),
    today: day.today,
    tradesToday: day.tradesToday,
    nextTradingDay: day.nextTradingDay,
    phase: day.phase,
  }
}

/** `off` is the segments the operator switched off; their markets stay listed, as `enabled: false`. */
export function toMarketsWire(view: TradingMarketsView, off: ReadonlySet<string>): MarketsResponse {
  return {
    homeRegion: view.homeRegion,
    markets: view.markets.map((market) => {
      const session = toSessionWire(market)

      return {
        market: market.market,
        currency: market.currency,
        quoteUnit: market.unit,
        ...(market.display === undefined ? {} : { priceDisplay: market.display }),
        region: market.region,
        ownsRegion: market.ownsRegion,
        segment: market.segment,
        enabled: !off.has(market.segment),
        holdable: market.holdable,
        label: market.label,
        segmentLabel: market.segmentLabel,
        regionLabel: market.regionLabel,
        icon: market.icon,
        ...(market.benchmark === undefined
          ? {}
          : { benchmark: toInstrumentWire(market.benchmark) }),
        ...(session === undefined ? {} : { session }),
        hasBoard: market.hasBoard,
        hasBrief: market.hasBrief,
        hasEvents: market.hasEvents,
        hasIndexes: market.hasIndexes,
        hasBars: market.hasBars,
      }
    }),
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

/** A live reading wins while the market trades, its move measured against the settled close as
 *  every surface measures it; otherwise the settled close stands. */
function toOverviewRowWire(row: OverviewRow): OverviewResponse['markets'][number]['rows'][number] {
  const instrument = toInstrumentWire(row.instrument)
  const board = row.quote?.board

  if (row.live !== undefined) {
    const changePct = changeAgainstClose(row.live.price, row.quote?.price, row.live.changePct)

    return {
      instrument,
      price: row.live.price,
      ...(changePct === undefined ? {} : { changePct }),
      observedAt: row.live.observedAt,
    }
  }

  return {
    instrument,
    ...(row.quote === undefined ? {} : { price: row.quote.price }),
    ...(row.changePct === undefined ? {} : { changePct: row.changePct }),
    ...(row.closedOn === undefined ? {} : { closedOn: row.closedOn }),
    ...(board === undefined ? {} : { board: toDealerBoardWire(board) }),
  }
}

type OverviewBlockWire = OverviewResponse['markets'][number]
type OverviewLeaders = NonNullable<MarketDataOverview['leaders']>
type OverviewLeader = NonNullable<OverviewLeaders['mostTraded']>[number]
type OverviewMovers = NonNullable<MarketDataOverview['movers']>
type OverviewMover = OverviewMovers['gainers'][number]

export function toOverviewWire(
  blocks: readonly MarketDataOverview[],
  locale: Locale,
  timezone: string
): OverviewResponse {
  return { markets: blocks.map((block) => toOverviewBlockWire(block, locale, timezone)) }
}

function toOverviewBlockWire(
  block: MarketDataOverview,
  locale: Locale,
  timezone: string
): OverviewBlockWire {
  const { breadth, foreignNetValue, leaders, movers } = block
  const { sections, sources } = renderOverviewForSurface(locale, block, timezone)

  return {
    market: block.market,
    asOf: block.asOf,
    ...(block.sessionState === undefined ? {} : { sessionState: block.sessionState }),
    currency: block.currency,
    ...(block.priceCurrency === undefined ? {} : { priceCurrency: block.priceCurrency }),
    rows: block.rows.map(toOverviewRowWire),
    ...(breadth === undefined
      ? {}
      : {
          breadth: {
            advancers: breadth.advancers,
            decliners: breadth.decliners,
            measured: breadth.measured,
          },
        }),
    ...(foreignNetValue === undefined ? {} : { foreignNetValue }),
    ...(leaders === undefined ? {} : { leaders: toLeadersWire(leaders) }),
    ...(movers === undefined ? {} : { movers: toMoversWire(movers) }),
    ...(sections.length === 0 ? {} : { sections }),
    ...(sources === undefined ? {} : { sources }),
    caveats: toCaveatWires(block.caveats, locale),
  }
}

function toLeadersWire(leaders: OverviewLeaders): OverviewLeadersWire {
  const { window, sessions, foreignBuys, foreignSells } = leaders
  const { proprietaryBuys, proprietarySells, proprietaryDay } = leaders

  return {
    window,
    ...(sessions === undefined ? {} : { sessions }),
    ...(foreignBuys === undefined ? {} : { foreignBuys: foreignBuys.map(toLeaderWire) }),
    ...(foreignSells === undefined ? {} : { foreignSells: foreignSells.map(toLeaderWire) }),
    ...(proprietaryBuys === undefined
      ? {}
      : { proprietaryBuys: proprietaryBuys.map(toLeaderWire) }),
    ...(proprietarySells === undefined
      ? {}
      : { proprietarySells: proprietarySells.map(toLeaderWire) }),
    ...(proprietaryDay === undefined ? {} : { proprietaryDay }),
    ...(leaders.mostTraded === undefined
      ? {}
      : { mostTraded: leaders.mostTraded.map(toLeaderWire) }),
  }
}

function toLeaderWire(leader: OverviewLeader): OverviewLeaderWire {
  return {
    instrument: toInstrumentWire(leader.instrument),
    value: leader.value,
    ...(leader.sharePct === undefined ? {} : { sharePct: leader.sharePct }),
    ...(leader.changePct === undefined ? {} : { changePct: leader.changePct }),
  }
}

function toMoversWire(movers: OverviewMovers): OverviewMoversWire {
  return {
    window: movers.window,
    gainers: movers.gainers.map(toMoverWire),
    losers: movers.losers.map(toMoverWire),
  }
}

function toMoverWire(mover: OverviewMover): OverviewMoverWire {
  return {
    instrument: toInstrumentWire(mover.instrument),
    changePct: mover.changePct,
    turnover: mover.turnover,
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
    readings: macro.readings,
    drivers: macro.drivers.map((driver) => toMacroDriverWire(driver, view.labels)),
    missing: macro.missing.map((driver) => ({
      id: driver.id,
      label: view.labels[driver.id] ?? driver.id,
      reason: driver.reason,
    })),
    caveats: toCaveatWires([...macro.caveats, ...result.caveats], locale),
  }
}

function toMacroDriverWire(
  driver: MacroRiskView['drivers'][number],
  labels: TradingMacroView['labels']
) {
  return {
    id: driver.id,
    label: labels[driver.id] ?? driver.id,
    unit: driver.unit,
    value: driver.value,
    asOf: driver.asOf,
    weight: driver.weight,
    bearishAt: driver.bearishAt,
    bullishAt: driver.bullishAt,
    contribution: driver.contribution,
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

export function toSectorsWire(
  market: string,
  view: TradingSectorsView,
  locale: Locale
): SectorsResponse {
  return {
    market,
    asOf: view.asOf,
    sectors: view.sectors.map((entry) => ({
      sector: entry.sector,
      label: entry.label,
      memberCount: entry.memberCount,
      ...(entry.sessionReturn === undefined ? {} : { sessionReturn: entry.sessionReturn }),
      ...(entry.excessReturnShort === undefined
        ? {}
        : { excessReturnShort: entry.excessReturnShort }),
      ...(entry.excessReturnLong === undefined ? {} : { excessReturnLong: entry.excessReturnLong }),
      ...(entry.score === undefined ? {} : { score: entry.score }),
    })),
    caveats: toCaveatWires(view.caveats, locale),
  }
}

export function toSourcesWire(statuses: readonly SourceStatus[]): SourcesResponse {
  return {
    sources: statuses.map((status) => ({
      id: status.id,
      kind: status.kind,
      ...(status.lastSuccessAt === undefined ? {} : { lastSuccessAt: status.lastSuccessAt }),
      ...(status.failure === undefined ? {} : { failure: status.failure }),
      breaker: status.breaker,
    })),
  }
}

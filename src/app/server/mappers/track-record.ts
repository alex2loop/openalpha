import type { ByModelWire } from '@/app/server/wire/track-record'
import type { TradingTrackRecordResponse } from '@/app/server/wire/trading'
import type { Locale } from '@/core/types/locale'
import type { ModelRecord, TradingTrackRecordView } from '@/trading/api'
import { toCaveatWires, toSuggestionWire } from '@/app/server/mappers/trading'

type FocusWires = TradingTrackRecordResponse['summary']['focuses']

export function toTrackRecordWire(
  view: TradingTrackRecordView,
  locale: Locale
): TradingTrackRecordResponse {
  const { report, acted } = view.reflection
  const { summary } = report

  return {
    text: {
      summary: [...view.text.summary],
      byConviction: [...view.text.byConviction],
      acted: [...view.text.acted],
      closed: view.text.closed.map((row) => ({ ...row })),
    },
    summary: {
      resolvedCount: summary.resolvedCount,
      ...(summary.winRate === undefined ? {} : { winRate: summary.winRate }),
      ...(summary.meanReturnPct === undefined ? {} : { meanReturnPct: summary.meanReturnPct }),
      ...(summary.medianReturnPct === undefined
        ? {}
        : { medianReturnPct: summary.medianReturnPct }),
      benchmarkComparedCount: summary.benchmarkComparedCount,
      benchmarkBeatCount: summary.benchmarkBeatCount,
      ...(summary.benchmarkMeanReturnPct === undefined
        ? {}
        : { benchmarkMeanReturnPct: summary.benchmarkMeanReturnPct }),
      ...(summary.beatsBenchmarkMajority === undefined
        ? {}
        : { beatsBenchmarkMajority: summary.beatsBenchmarkMajority }),
      versions: summary.versions.map((entry) => ({
        strategyVersion: entry.strategyVersion,
        calculationVersions: entry.calculationVersions.map((version) => ({
          name: version.name,
          version: version.version,
        })),
        resolvedCount: entry.resolvedCount,
      })),
      calibration: summary.calibration.map((bucket) => ({
        convictionBand: bucket.convictionBand,
        resolvedCount: bucket.resolvedCount,
        ...(bucket.winRate === undefined ? {} : { winRate: bucket.winRate }),
      })),
      focuses: toFocusWires(summary.focuses),
      byModel: toByModelWires(view.byModel),
      caveats: toCaveatWires(summary.caveats, locale),
    },
    recent: report.recent.map((suggestion) => toSuggestionWire(suggestion, locale)),
    ...(acted === undefined ? {} : { acted: { ...acted } }),
  }
}

function toFocusWires(
  focuses: TradingTrackRecordView['reflection']['report']['summary']['focuses']
): FocusWires {
  return focuses.map((entry) => ({
    focusKey: entry.focusKey,
    resolvedCount: entry.resolvedCount,
    winCount: entry.winCount,
    targetCount: entry.targetCount,
    ...(entry.winRate === undefined ? {} : { winRate: entry.winRate }),
  }))
}

function toByModelWires(records: readonly ModelRecord[]): readonly ByModelWire[] {
  return records.map((record) => ({
    model: record.model,
    resolvedCount: record.resolvedCount,
    winCount: record.winCount,
    ...(record.winRate === undefined ? {} : { winRate: record.winRate }),
  }))
}

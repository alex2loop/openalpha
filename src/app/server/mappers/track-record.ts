import type { ByModelWire } from '@/app/server/wire/track-record'
import type { TradingTrackRecordResponse } from '@/app/server/wire/trading'
import type { ModelRecord, TradingTrackRecordView } from '@/trading/api'

type FocusWires = TradingTrackRecordResponse['summary']['focuses']

export function toFocusWires(
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

export function toByModelWires(records: readonly ModelRecord[]): readonly ByModelWire[] {
  return records.map((record) => ({
    model: record.model,
    resolvedCount: record.resolvedCount,
    winCount: record.winCount,
    ...(record.winRate === undefined ? {} : { winRate: record.winRate }),
  }))
}

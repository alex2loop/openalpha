import type { AnalysisWire } from '@/app/server/wire/analysis'
import type { Locale } from '@/core/types/locale'
import type { AnalysisRecord } from '@/trading/api'
import { toInstrumentWire } from '@/app/server/mappers/trading'
import { renderAnalysisText } from '@/trading/api'

export function toAnalysisWire(record: AnalysisRecord, locale: Locale): AnalysisWire {
  return {
    id: record.id,
    instrument: toInstrumentWire(record.instrument),
    at: record.at,
    authoredLocale: record.authoredLocale,
    createdAt: record.createdAt,
    text: renderAnalysisText(locale, record),
  }
}

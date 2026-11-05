import type { AnalysisWire } from '@/app/server/wire/analysis'
import type { Locale } from '@/core/types/locale'
import type { AnalysisRecord } from '@/trading/api'
import { toInstrumentWire } from '@/app/server/mappers/trading'
import { renderAnalysisText } from '@/trading/api'

/** `last` is the name's price now, where the host read one. */
export function toAnalysisWire(
  record: AnalysisRecord & { readonly last?: number },
  locale: Locale
): AnalysisWire {
  return {
    id: record.id,
    instrument: toInstrumentWire(record.instrument),
    at: record.at,
    authoredLocale: record.authoredLocale,
    createdAt: record.createdAt,
    conditions: {
      bull: [...record.result.bull.invalidators],
      bear: [...record.result.bear.invalidators],
    },
    text: renderAnalysisText(locale, record, {
      pageFrames: true,
      ...(record.last === undefined ? {} : { last: record.last }),
    }),
  }
}

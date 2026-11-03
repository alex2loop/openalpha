import type { AnalysisWire } from '@/app/server/wire/analysis'
import type { Locale } from '@/core/types/locale'
import type { AnalysisRecord } from '@/trading/api'
import { toCaveatWires, toInstrumentWire } from '@/app/server/mappers/trading'

export function toAnalysisWire(record: AnalysisRecord, locale: Locale): AnalysisWire {
  const { result } = record
  const verdicts = new Map(result.verification.verified.map((entry) => [entry.id, entry.verdict]))

  return {
    id: record.id,
    instrument: toInstrumentWire(record.instrument),
    at: record.at,
    authoredLocale: record.authoredLocale,
    createdAt: record.createdAt,
    bull: toCaseWire(result.bull),
    bear: toCaseWire(result.bear),
    claims: result.claims.map(({ id, text }) => ({
      id,
      text,
      verdict: verdicts.get(id) ?? 'insufficient',
    })),
    citations: record.citations.map((citation) => ({ ...citation })),
    caveats: toCaveatWires(record.caveats, locale),
    models: [...result.models],
    ...(record.evidenceThrough === undefined ? {} : { evidenceThrough: record.evidenceThrough }),
  }
}

function toCaseWire(analysisCase: AnalysisRecord['result']['bull']): AnalysisWire['bull'] {
  return {
    stance: analysisCase.stance,
    summary: analysisCase.summary,
    claims: [...analysisCase.claims],
    invalidators: [...analysisCase.invalidators],
    citations: analysisCase.citations.map((citation) => ({ ...citation })),
  }
}

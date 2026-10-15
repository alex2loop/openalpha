import type { Locale } from '@/core/types/locale'
import type { SourceSummary } from '@/trading/kernel/source/source-result'
import { t } from '@/i18n'
import { formatInstant } from '@/trading/render/datetime'
import { renderProvidedValue } from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR } from '@/trading/render/layout'

interface SourcesRenderInput {
  readonly summaries: readonly SourceSummary[]
  readonly locale: Locale
  readonly timezone: string
}

/** One row per provider, degraded first: the reason for reading this at all is the provider that
 *  stopped answering, and a healthy list is a single line rather than a page to scan. Breaker state
 *  is this process's memory, so a process that has called nothing reports that rather than health. */
export function renderSourcesText(input: SourcesRenderInput): string {
  const { locale, summaries } = input
  const degraded = summaries.filter(isDegraded)

  if (degraded.length === 0) {
    const answered = summaries.some((summary) => summary.lastSuccessAt !== undefined)
    const state = answered ? 'slash.tradingSourcesHealthy' : 'slash.tradingSourcesIdle'

    return `${t(locale, 'slash.tradingSourcesTitle')}${INLINE_SEPARATOR}${t(locale, state)}`
  }

  return [
    t(locale, 'slash.tradingSourcesTitle'),
    ...degraded.map((summary) => `${INDENT[1]}${toRow(summary, input)}`),
  ].join('\n')
}

function isDegraded(summary: SourceSummary): boolean {
  return summary.breaker === 'open' || summary.lastFailureCode !== undefined
}

function toRow(summary: SourceSummary, input: SourcesRenderInput): string {
  const { locale } = input
  const parts = [`${summary.id} (${summary.kind})`]

  if (summary.breaker === 'open') {
    parts.push(t(locale, 'slash.tradingSourcesOpen'))
  }

  if (summary.lastFailureCode !== undefined) {
    // A transport code is an internal name; the catalog carries the operator's words for the four
    // the transport can raise, and anything it outgrows degrades to the code rather than a key.
    const reason = renderProvidedValue(
      locale,
      `trading.source.failure.${summary.lastFailureCode}`,
      summary.lastFailureCode
    )

    parts.push(t(locale, 'slash.tradingSourcesFailure', { reason }))
  }

  parts.push(
    summary.lastSuccessAt === undefined
      ? t(locale, 'slash.tradingSourcesNeverOk')
      : t(locale, 'slash.tradingSourcesLastOk', {
          at: formatInstant(locale, summary.lastSuccessAt, input.timezone),
        })
  )

  return parts.join(INLINE_SEPARATOR)
}

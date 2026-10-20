import type { LLMUsageTotals } from '@/core/types/usage'

// Money is shown to 4dp everywhere, caps included: a turn routinely costs less than a cent, and the
// schema accepts any positive cap, so 2dp renders `max_daily_usd = 0.0035` as `$0.00` — which reads
// as the uncapped sentinel.
export const SPEND_DECIMALS = 4
const PCT_DECIMALS = 0
const THOUSAND = 1_000
const THOUSANDS_DECIMALS = 1
const fixedFormatters = new Map<string, Intl.NumberFormat>()

/** Locale is a bare BCP-47 tag so core stays i18n-free. */
function fixedFormat(locale: string, digits: number): Intl.NumberFormat {
  const key = `${locale}:${digits}`
  let formatter = fixedFormatters.get(key)

  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
    fixedFormatters.set(key, formatter)
  }

  return formatter
}

/** The stable `$0.0142` that logs, errors and the cost command print. */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(SPEND_DECIMALS)}`
}

/** LLM spend as a reader sees it, in their digit separators. */
export function formatSpendUsd(locale: string, usd: number): string {
  return `${fixedFormat(locale, SPEND_DECIMALS).format(usd)} USD`
}

export function formatSpend(spentUsd: number, capUsd: number): string {
  if (capUsd <= 0) {
    return formatUsd(spentUsd)
  }

  const pct = ((spentUsd / capUsd) * 100).toFixed(PCT_DECIMALS)

  return `${formatUsd(spentUsd)} / ${formatUsd(capUsd)} (${pct}%)`
}

export function formatTokenCount(locale: string, n: number): string {
  return n >= THOUSAND
    ? `${fixedFormat(locale, THOUSANDS_DECIMALS).format(n / THOUSAND)}k`
    : String(n)
}

type PromptTokenCounts = Pick<
  LLMUsageTotals,
  'inputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'
>

/** The whole prompt: stored input is only its uncached share. */
export function sentTokensOf(counts: PromptTokenCounts): number {
  return counts.inputTokens + counts.cacheReadTokens + counts.cacheWriteTokens
}

import type { LLMUsageTotals } from '@/core/types/usage'

// CLI and chat print spend at 4dp, caps included: a turn routinely costs less than a cent, and 2dp
// would render `max_daily_usd = 0.0035` as `0.00`, which reads as the uncapped sentinel. The web
// chip prints cents, with significant digits under a cent (docs/en/budgets.md).
const SPEND_DECIMALS = 4
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

/** The stable `$0.0142` that locale-free engine errors print; a reader-facing figure uses `formatSpendUsd`. */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(SPEND_DECIMALS)}`
}

/** LLM spend as a reader sees it, in their digit separators. */
export function formatSpendUsd(locale: string, usd: number): string {
  return `${fixedFormat(locale, SPEND_DECIMALS).format(usd)} USD`
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

import type { LLMUsageTotals } from '@/core/types/usage'

// CLI and chat print spend at 4dp, caps included: a turn routinely costs less than a cent, and 2dp
// would render `max_daily_usd = 0.0035` as `0.00`, which reads as the uncapped sentinel. The web
// chip prints cents, with significant digits under a cent (docs/en/budgets.md). Below the last
// printed decimal a billed amount keeps two significant digits, so it never reads as free.
const SPEND_DECIMALS = 4
const SPEND_ROUNDS_TO_ZERO_BELOW = 0.5 * 10 ** -SPEND_DECIMALS
const SPEND_SMALL_DIGITS = 2
const THOUSAND = 1_000
const MILLION = 1_000_000
const COMPACT_DECIMALS = 1
// The first count whose thousands print as `1.000,0k`; it reads `1,0M` instead.
const MILLIONS_FROM = 999_950
const formatters = new Map<string, Intl.NumberFormat>()

/** Locale is a bare BCP-47 tag so core stays i18n-free. */
function cachedFormat(
  locale: string,
  shape: string,
  options: Intl.NumberFormatOptions
): Intl.NumberFormat {
  const key = `${locale}:${shape}`
  let formatter = formatters.get(key)

  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, options)
    formatters.set(key, formatter)
  }

  return formatter
}

function fixedFormat(locale: string, digits: number): Intl.NumberFormat {
  return cachedFormat(locale, `fixed:${digits}`, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function smallSpendFormat(locale: string): Intl.NumberFormat {
  return cachedFormat(locale, `significant:${SPEND_SMALL_DIGITS}`, {
    maximumSignificantDigits: SPEND_SMALL_DIGITS,
  })
}

/** LLM spend as a reader sees it, in their digit separators. */
export function formatSpendUsd(locale: string, usd: number): string {
  if (usd !== 0 && Math.abs(usd) < SPEND_ROUNDS_TO_ZERO_BELOW) {
    return `${smallSpendFormat(locale).format(usd)} USD`
  }

  // `usd === 0` also catches -0, which would otherwise print as `-0,0000`.
  return `${fixedFormat(locale, SPEND_DECIMALS).format(usd === 0 ? 0 : usd)} USD`
}

export function formatTokenCount(locale: string, n: number): string {
  if (n >= MILLIONS_FROM) {
    return `${fixedFormat(locale, COMPACT_DECIMALS).format(n / MILLION)}M`
  }

  return n >= THOUSAND
    ? `${fixedFormat(locale, COMPACT_DECIMALS).format(n / THOUSAND)}k`
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

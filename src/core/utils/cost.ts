import type { LLMUsageTotals } from '@/core/types/usage'

// Money is shown to 4dp everywhere, caps included: a turn routinely costs less than a cent, and the
// schema accepts any positive cap, so 2dp renders `max_daily_usd = 0.0035` as `$0.00` — which reads
// as the uncapped sentinel.
export const SPEND_DECIMALS = 4
const PCT_DECIMALS = 0
const THOUSAND = 1_000

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(SPEND_DECIMALS)}`
}

export function formatSpend(spentUsd: number, capUsd: number): string {
  if (capUsd <= 0) {
    return formatUsd(spentUsd)
  }

  const pct = ((spentUsd / capUsd) * 100).toFixed(PCT_DECIMALS)

  return `${formatUsd(spentUsd)} / ${formatUsd(capUsd)} (${pct}%)`
}

export function formatTokenCount(n: number): string {
  return n >= THOUSAND ? `${(n / THOUSAND).toFixed(1)}k` : String(n)
}

type PromptTokenCounts = Pick<
  LLMUsageTotals,
  'inputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'
>

/** The whole prompt: stored input is only its uncached share. */
export function sentTokensOf(counts: PromptTokenCounts): number {
  return counts.inputTokens + counts.cacheReadTokens + counts.cacheWriteTokens
}

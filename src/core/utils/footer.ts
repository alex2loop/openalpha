import type { SlashInvocationPolicy, SlashResult } from '@/core/types/command'
import type { LLMUsageTotals } from '@/core/types/usage'
import { scrubCredentials } from '@/core/security/credentials'
import { formatTokenCount, formatUsd, sentTokensOf } from '@/core/utils/cost'
import { formatLongDuration } from '@/core/utils/duration'
import { stripControls } from '@/core/utils/text'

const FOOTER_SEPARATOR = ' · '

type FooterMessageKey =
  | 'footer.cost'
  | 'footer.costFree'
  | 'footer.tokens'
  | 'footer.tokensCached'
  | 'footer.modelCall'
  | 'footer.modelCalls'
  | 'footer.modelCallOn'
  | 'footer.modelCallsOn'
  | 'footer.context'
  | 'footer.elapsed'

type FooterValues = Readonly<Record<string, string | number>>

interface FooterSegment {
  readonly key: FooterMessageKey
  readonly values: FooterValues
}

/** An absent field renders no segment. */
export interface FooterDetails {
  readonly contextPct?: number
  readonly elapsedMs?: number
}

/** Injected because core never imports i18n. */
type FooterTranslate = (key: FooterMessageKey, values: FooterValues) => string

interface RunFooterInput {
  /** BCP-47 tag; a surface `Locale` is a subtype. */
  readonly locale: string
  readonly translate: FooterTranslate
  readonly totals: LLMUsageTotals
  readonly details: FooterDetails
}

/** A command that spends, or that declared a progress label and so was watched waiting, closes with
 *  the session's running spend — the same figure the chat turn above it printed, so one column never
 *  means two things. A cheap command that answers at once closes with nothing. */
export function hasRunFooter(
  policy: SlashInvocationPolicy | undefined,
  result: SlashResult | null
): boolean {
  if (result?.kind !== 'text') {
    return false
  }

  return policy?.action === 'costly' || policy?.execution !== undefined
}

/** Every surface renders the same segments in the same order. */
export function formatRunFooter(input: RunFooterInput): string {
  return toSegments(input.locale, input.totals, input.details)
    .map((segment) => stripControls(scrubCredentials(input.translate(segment.key, segment.values))))
    .join(FOOTER_SEPARATOR)
}

function toSegments(
  locale: string,
  totals: LLMUsageTotals,
  details: FooterDetails
): readonly FooterSegment[] {
  return [
    toCostSegment(totals),
    toTokenSegment(totals),
    toModelCallSegment(totals),
    ...toDetailSegments(locale, details),
  ]
}

/** Work priced at exactly zero is free work: the price chain only reaches zero through a free
 *  source (subscription plan, free tier, local provider, zero override) — its fallback rate is
 *  non-zero — and "$0.0000" beside real token counts reads as broken accounting instead. A total
 *  with no calls keeps the plain "$0.0000": that line says nothing was spent because nothing ran. */
function toCostSegment(totals: LLMUsageTotals): FooterSegment {
  if (totals.modelCalls > 0 && totals.costUsd === 0) {
    return { key: 'footer.costFree', values: {} }
  }

  return { key: 'footer.cost', values: { cost: formatUsd(totals.costUsd) } }
}

// Zero cache reads is the common case; the plain variant drops the noise.
function toTokenSegment(totals: LLMUsageTotals): FooterSegment {
  const input = formatTokenCount(sentTokensOf(totals))
  const output = formatTokenCount(totals.outputTokens)

  if (totals.cacheReadTokens === 0) {
    return { key: 'footer.tokens', values: { input, output } }
  }

  return {
    key: 'footer.tokensCached',
    values: { input, output, cached: formatTokenCount(totals.cacheReadTokens) },
  }
}

/** The model rides the count rather than taking its own segment: "3 model calls · model X" prints
 *  the word twice. Unnamed where several billed - the count is still true, and no one name is. */
function toModelCallSegment(totals: LLMUsageTotals): FooterSegment {
  const { modelCalls, modelName } = totals

  if (modelName === undefined) {
    return {
      key: modelCalls === 1 ? 'footer.modelCall' : 'footer.modelCalls',
      values: { modelCalls },
    }
  }

  return {
    key: modelCalls === 1 ? 'footer.modelCallOn' : 'footer.modelCallsOn',
    values: { modelCalls, model: modelName },
  }
}

function toDetailSegments(locale: string, details: FooterDetails): readonly FooterSegment[] {
  const segments: FooterSegment[] = []

  if (details.contextPct !== undefined) {
    segments.push({ key: 'footer.context', values: { percent: details.contextPct } })
  }

  if (details.elapsedMs !== undefined) {
    segments.push({
      key: 'footer.elapsed',
      values: { elapsed: formatLongDuration(locale, details.elapsedMs) },
    })
  }

  return segments
}

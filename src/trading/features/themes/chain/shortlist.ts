import type { ScreenedCandidate } from '@/trading/features/market-data/types'
import type { ChainContext } from '@/trading/features/themes/chain/context'
import type { ThemeSector } from '@/trading/features/themes/types'
import type { FactorResult } from '@/trading/kernel/factor'
import type { Ticker } from '@/trading/kernel/instrument'

const SHORTLIST_PER_SECTOR = 5
/** Piotroski at or below the market's weak line, Beneish's manipulation flags, and free cash flow
 *  negative across the window the market reads it over. */
const DISQUALIFYING_CAVEATS: ReadonlySet<string> = new Set([
  'factor.accounts-weakening',
  'factor.accounts-warning-signs',
  'factor.free-cash-negative',
])

interface ShortlistEntry {
  readonly ticker: Ticker
  /** The board's quality factor, -1 to 1, which the list is ranked on. */
  readonly quality: number
}

/** Every name here already cleared the board's liquidity and tradability gates. The model never
 *  picks a name: this list is all the company step sees. */
export function shortlistSector(
  context: ChainContext,
  sector: ThemeSector
): readonly ShortlistEntry[] {
  return context.candidates
    .filter(
      (candidate) =>
        candidate.excluded !== true && context.sectorOf.get(candidate.instrument.ticker) === sector
    )
    .flatMap((candidate) => {
      const quality = qualityOf(candidate)

      return quality === undefined || !isQualified(quality)
        ? []
        : [{ ticker: candidate.instrument.ticker, quality: quality.score }]
    })
    .sort((left, right) => right.quality - left.quality)
    .slice(0, SHORTLIST_PER_SECTOR)
}

/** Only a quality factor that fired: one that abstained keeps a row scored zero, and ranking on it
 *  would put a name with no accounts above every name the factor reads as weak. */
function qualityOf(candidate: ScreenedCandidate): FactorResult | undefined {
  return candidate.factors.find((factor) => factor.id === 'quality' && factor.weight !== undefined)
}

/** A return on invested capital that was not read (a bank, a first year) is no reading, so only a
 *  read one at or below zero disqualifies. */
function isQualified(quality: FactorResult): boolean {
  const returnOnCapital = quality.metrics?.find(
    (metric) => metric.id === 'return-on-invested-capital'
  )?.value

  return (
    !quality.caveats.some((caveat) => DISQUALIFYING_CAVEATS.has(caveat.code)) &&
    (returnOnCapital === undefined || returnOnCapital > 0)
  )
}

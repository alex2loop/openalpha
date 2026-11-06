import type {
  PublicBriefDeps,
  PublicBriefInput,
  PublicScreen,
} from '@/trading/features/brief/public/types'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { PUBLIC_BRIEF_MARKETS } from '@/trading/features/brief/public/reads'
import { hasOnlyPublicSources } from '@/trading/features/brief/public/scope'

/** The top names of each public market that has a screen, as the day's lists. Empty, with no read
 *  at all, when the lists are off. A list that cites a source the public side may not name is left
 *  out, whole. */
export async function readPublicScreens(
  deps: PublicBriefDeps,
  input: PublicBriefInput
): Promise<readonly PublicScreen[]> {
  if (deps.topScreen === 0) {
    return []
  }

  const read = await Promise.all(
    PUBLIC_BRIEF_MARKETS.map((market) => readScreen(deps, input, market))
  )
  const screens = read.filter((screen) => screen !== undefined)
  const dropped = screens.filter((screen) => !isPublishable(screen))

  if (dropped.length > 0) {
    deps.logger.warn('trading.public_brief_screens_dropped', {
      markets: dropped.map((screen) => screen.market),
      sources: [...new Set(dropped.flatMap(sourcesOf))],
    })
  }

  return screens.filter(isPublishable)
}

/** A list is garnish: one that cannot be read leaves that market out and the brief stands. */
async function readScreen(
  deps: PublicBriefDeps,
  input: PublicBriefInput,
  market: MarketRef
): Promise<PublicScreen | undefined> {
  try {
    const screen = await deps.screen({
      market,
      limit: deps.topScreen,
      now: input.now,
      signal: input.signal,
    })

    return screen === undefined
      ? undefined
      : { market, ...screen, provenance: onePerSource(screen.provenance) }
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.public_brief_screen_unreadable', {
      market,
      err: formatErrForLog(err),
    })

    return undefined
  }
}

/** A list is ranked from hundreds of reads of a few sources; the check and the stored row need each
 *  source once. */
function onePerSource(provenance: readonly SourceProvenance[]): readonly SourceProvenance[] {
  return [...new Map(provenance.map((entry) => [entry.sourceId, entry])).values()]
}

function isPublishable(screen: PublicScreen): boolean {
  return hasOnlyPublicSources(sourcesOf(screen))
}

function sourcesOf(screen: PublicScreen): readonly SourceId[] {
  return screen.provenance.map((entry) => entry.sourceId)
}

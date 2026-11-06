import type {
  PublicBriefDeps,
  PublicBriefInput,
  PublicScreen,
} from '@/trading/features/brief/public/types'
import type { MarketRef } from '@/trading/kernel/instrument'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { PUBLIC_BRIEF_MARKETS } from '@/trading/features/brief/public/reads'

/** The top names of each public market that has a screen, as the day's lists. Empty, with no read
 *  at all, when the lists are off. */
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

  return read.filter((screen) => screen !== undefined)
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

    return screen === undefined ? undefined : { market, ...screen }
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

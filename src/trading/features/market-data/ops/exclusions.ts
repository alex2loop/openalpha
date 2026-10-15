import type { Logger } from '@/core/logging/logger'
import type { ExclusionReader, ScreenedCandidate } from '@/trading/features/market-data/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { ScreenCandidate } from '@/trading/kernel/market/market-capability'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { buildInstrumentKey } from '@/trading/kernel/instrument'

interface MarkExcludedInput {
  readonly candidates: readonly ScreenCandidate[]
  readonly reader: ExclusionReader
  readonly logger: Logger
  readonly signal: AbortSignal
}

/** The marks and what the board could not check. An unmarked row is otherwise two different
 *  answers - not excluded, or not checked - and only the caveat tells them apart. */
interface MarkedCandidates {
  readonly candidates: readonly ScreenedCandidate[]
  readonly caveats: readonly Caveat[]
}

/** An enrichment, never the answer: a profile that cannot be read costs the board its marks, not
 *  its rows. It costs the reader their certainty too, so the caveat says so rather than letting an
 *  unmarked board read as a checked one. */
export async function markExcluded(input: MarkExcludedInput): Promise<MarkedCandidates> {
  if (input.candidates.length === 0) {
    return { candidates: input.candidates, caveats: [] }
  }

  const excluded = await readExclusions(input)

  if (excluded === undefined) {
    return {
      candidates: input.candidates,
      caveats: [{ code: 'profile.exclusions-unavailable' }],
    }
  }

  return {
    candidates: input.candidates.map((candidate) =>
      excluded.has(buildInstrumentKey(candidate.instrument))
        ? { ...candidate, excluded: true }
        : candidate
    ),
    caveats: [],
  }
}

/** `undefined` is the unread list, which is not the empty one: an operator who excluded nothing and
 *  a profile that would not open must not produce the same board. */
async function readExclusions(input: MarkExcludedInput): Promise<ReadonlySet<string> | undefined> {
  try {
    const refs = await input.reader.exclusions(input.signal)

    return new Set(refs.map(buildInstrumentKey))
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    input.logger.warn('trading.screen_exclusions_unavailable', { err: formatErrForLog(err) })

    return undefined
  }
}

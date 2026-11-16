import type { StoryCandidate } from '@/trading/kernel/operator/brief-story'
import type { BreadthStoryInputs } from '@/trading/markets/brief-story'
import { toRunKey } from '@/trading/kernel/operator/brief-story'
import { buildWatches, detectBreadthShift, fact, salienceOf } from '@/trading/markets/brief-story'
import { US_STORY_POLICY as P } from '@/trading/markets/equity-us/brief/story-policy'

type StoryDetector = (inputs: BreadthStoryInputs) => StoryCandidate | undefined

/** The two pure detectors. Each reads only the breadth the board folds to, so a missing input
 *  silences its own detector and nothing else. */
export const US_STORY_DETECTORS: readonly StoryDetector[] = Object.freeze([
  (inputs) => detectBreadthShift(inputs, P),
  detectDistributionCluster,
])

/** An index fund selling on rising volume again and again: the weakness a breadth reading alone
 *  does not name. The index above its own mean is the one fact that argues against it. */
function detectDistributionCluster(inputs: BreadthStoryInputs): StoryCandidate | undefined {
  const { breadth } = inputs
  const rows = breadth.distribution ?? []
  const worst = Math.max(...rows.map((row) => row.days))

  if (rows.length === 0 || worst < P.distributionClusterAt) {
    return undefined
  }

  const trend = breadth.indexToMa50Pct
  const now = breadth.aboveMa50Ratio

  return {
    code: 'distribution-cluster',
    runKey: toRunKey('distribution-cluster'),
    salience: salienceOf(worst, P.distributionClusterAt),
    facts: [
      ...rows.map((row) =>
        fact({ ticker: row.ticker, distributionDays: row.days, sessions: row.sessions }, 'supports')
      ),
      ...(trend !== undefined && trend > 0 ? [fact({ indexToMa50Pct: trend }, 'contradicts')] : []),
    ],
    watches: buildWatches(
      [
        {
          shape: 'aboveMa50Ratio-below',
          threshold: now - P.breadthFollowThrough,
          effect: 'confirms',
        },
        {
          shape: 'aboveMa50Ratio-above',
          threshold: now + P.breadthFollowThrough,
          effect: 'refutes',
        },
      ],
      P.horizonSessions
    ),
  }
}

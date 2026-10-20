import type { BriefSectionRow } from '@/trading/kernel/operator/brief-section'
import type {
  StoryCandidate,
  StoryCode,
  StoryFact,
  StoryWatch,
} from '@/trading/kernel/operator/brief-story'
import type { StoryInputs } from '@/trading/markets/equity-vn/brief/story-facts'
import { toRunKey } from '@/trading/kernel/operator/brief-story'
import {
  buildWatches,
  fact,
  moveFacts,
  salienceOf,
  turnoverFact,
  vn30Fact,
  vnRows,
} from '@/trading/markets/equity-vn/brief/story-facts'
import { VN_STORY_POLICY as P } from '@/trading/markets/equity-vn/brief/story-policy'
import { FLOW_DEVIATION_SESSIONS, VN_INDEX_TICKER } from '@/trading/markets/equity-vn/policy'
import { CONFIRMING_TURNOVER_RATIO } from '@/trading/markets/overview-sections'

type StoryDetector = (inputs: StoryInputs) => StoryCandidate | undefined

interface StrongSector {
  readonly sector: string
  readonly strength: number
}

/** The seven pure detectors. Each reads only `StoryInputs`, so a missing input silences its own
 *  detector and nothing else. */
export const VN_STORY_DETECTORS: readonly StoryDetector[] = Object.freeze([
  detectBreadthSplit,
  detectForeignFlow,
  detectTurnoverMove,
  detectLevelTest,
  detectBreadthShift,
  detectSectorLeadership,
  detectBasis,
])

function detectBreadthSplit(inputs: StoryInputs): StoryCandidate | undefined {
  const { breadth, indexMovePct } = inputs
  const netShare = Math.abs(breadth.netAdvancers) / breadth.measured
  const opposed = Math.sign(indexMovePct) * Math.sign(breadth.netAdvancers) < 0

  if (!opposed || Math.abs(indexMovePct) < P.splitIndexMovePct || netShare < P.splitNetShare) {
    return undefined
  }

  const down = indexMovePct < 0
  const code = down ? 'breadth-split-index-down' : 'breadth-split-index-up'
  const now = breadth.aboveMa50Ratio
  const widens = down ? 1 : -1

  return {
    code,
    runKey: toRunKey(code),
    salience: Math.min(
      salienceOf(Math.abs(indexMovePct), P.splitIndexMovePct),
      salienceOf(netShare, P.splitNetShare)
    ),
    facts: splitFacts(inputs),
    watches: buildWatches([
      {
        shape: down ? 'aboveMa50Ratio-above' : 'aboveMa50Ratio-below',
        threshold: now + widens * P.breadthFollowThrough,
        effect: 'confirms',
      },
      {
        shape: down ? 'aboveMa50Ratio-below' : 'aboveMa50Ratio-above',
        threshold: now - widens * P.breadthFollowThrough,
        effect: 'refutes',
      },
    ]),
  }
}

function detectForeignFlow(inputs: StoryInputs): StoryCandidate | undefined {
  const { windowForeignNet: net, windowTurnover } = inputs
  const trend = inputs.breadth.indexToMa50Pct

  if (net === undefined || windowTurnover === undefined || windowTurnover <= 0) {
    return undefined
  }

  const share = Math.abs(net / windowTurnover)

  if (trend === undefined || share < P.foreignWindowShare) {
    return undefined
  }

  const selling = net < 0
  const code = selling ? 'foreign-selling' : 'foreign-buying'

  return {
    code,
    runKey: toRunKey(code),
    salience: salienceOf(share, P.foreignWindowShare),
    facts: [
      fact({ foreignNetWindow: net, sessions: FLOW_DEVIATION_SESSIONS }, 'supports'),
      ...sessionForeignFact(inputs),
      ...vn30Fact(inputs),
      ...proprietaryFact(inputs, net),
    ],
    watches: buildWatches([
      {
        shape: selling ? 'indexToMa50Pct-below' : 'indexToMa50Pct-above',
        threshold: trend + (selling ? -1 : 1) * P.indexFollowThrough,
        effect: 'confirms',
      },
      {
        shape: selling ? 'net-above' : 'net-below',
        threshold: 0,
        effect: 'refutes',
      },
    ]),
  }
}

function detectTurnoverMove(inputs: StoryInputs): StoryCandidate | undefined {
  const { indexMovePct, turnoverRatio, breadth } = inputs
  const trend = breadth.indexToMa50Pct

  if (turnoverRatio === undefined || trend === undefined) {
    return undefined
  }

  const thin = turnoverRatio < P.turnoverThinBelow
  const heavy = turnoverRatio >= P.turnoverHeavyFrom

  if (Math.abs(indexMovePct) < P.turnoverMovePct || !(thin || heavy)) {
    return undefined
  }

  const rise = indexMovePct > 0
  const code: StoryCode = `turnover-${thin ? 'thin' : 'heavy'}-${rise ? 'rise' : 'fall'}`
  // Both read lower from here: a rise on thin trade gives back, a fall on heavy trade carries on.
  const lower = thin === rise
  const turnoverSalience = thin
    ? (P.turnoverThinBelow - turnoverRatio) / P.turnoverThinBelow
    : salienceOf(turnoverRatio, P.turnoverHeavyFrom)

  return {
    code,
    runKey: toRunKey(code),
    salience: Math.min(1, salienceOf(Math.abs(indexMovePct), P.turnoverMovePct), turnoverSalience),
    facts: [
      fact({ ticker: VN_INDEX_TICKER, changePct: indexMovePct }, 'supports'),
      ...turnoverFact(inputs, 'supports'),
      ...againstMoveFact(inputs),
    ],
    watches: buildWatches([
      {
        shape: lower ? 'indexToMa50Pct-below' : 'indexToMa50Pct-above',
        threshold: trend + (lower ? -1 : 1) * P.indexFollowThrough,
        effect: 'confirms',
      },
      {
        shape: lower ? 'indexToMa50Pct-above' : 'indexToMa50Pct-below',
        threshold: trend + (lower ? 1 : -1) * P.indexFollowThrough,
        effect: 'refutes',
      },
    ]),
  }
}

function detectLevelTest(inputs: StoryInputs): StoryCandidate | undefined {
  const { range, breadth } = inputs

  if (range === undefined) {
    return undefined
  }

  const nearSupport = range.supportPct >= 0 && range.supportPct <= P.levelNear
  const nearResistance = range.resistancePct >= 0 && range.resistancePct <= P.levelNear

  if (!(nearSupport || nearResistance)) {
    return undefined
  }

  const support = nearSupport && (!nearResistance || range.supportPct <= range.resistancePct)
  const distance = support ? range.supportPct : range.resistancePct
  const trend = breadth.indexToMa50Pct
  // A trend running against the level makes the test less likely to hold.
  const against = trend !== undefined && (support ? trend < 0 : trend > 0)
  const code = support ? 'support-test' : 'resistance-test'

  return {
    code,
    runKey: toRunKey(code),
    salience: (P.levelNear - distance) / P.levelNear,
    facts: [
      fact({ ticker: VN_INDEX_TICKER, changePct: inputs.indexMovePct }, 'supports'),
      fact(support ? { supportPct: distance } : { resistancePct: distance }, 'supports'),
      ...(against ? [fact({ indexToMa50Pct: trend }, 'contradicts')] : []),
    ],
    watches: buildWatches([
      {
        shape: support ? 'supportPct-above' : 'resistancePct-above',
        threshold: P.levelClear,
        effect: 'confirms',
      },
      {
        shape: support ? 'supportPct-below' : 'resistancePct-below',
        threshold: 0,
        effect: 'refutes',
      },
    ]),
  }
}

function detectBreadthShift(inputs: StoryInputs): StoryCandidate | undefined {
  const before = inputs.breadthBefore?.aboveMa50Ratio
  const { breadth } = inputs

  if (before === undefined) {
    return undefined
  }

  const now = breadth.aboveMa50Ratio
  const delta = now - before

  if (Math.abs(delta) < P.breadthShift) {
    return undefined
  }

  const widening = delta > 0
  const trend = breadth.indexToMa50Pct
  const code = widening ? 'breadth-widening' : 'breadth-narrowing'
  const against = trend !== undefined && (widening ? trend < 0 : trend > 0)

  return {
    code,
    runKey: toRunKey(code),
    salience: salienceOf(Math.abs(delta), P.breadthShift),
    facts: [
      fact({ aboveMa50Ratio: now, sessions: P.breadthShiftSessions }, 'supports'),
      ...(breadth.newHighs === undefined || breadth.newLows === undefined
        ? []
        : [fact({ newHighs: breadth.newHighs, newLows: breadth.newLows }, 'supports')]),
      ...(against ? [fact({ indexToMa50Pct: trend }, 'contradicts')] : []),
    ],
    watches: buildWatches([
      {
        shape: widening ? 'aboveMa50Ratio-above' : 'aboveMa50Ratio-below',
        threshold: now + (widening ? 1 : -1) * P.breadthFollowThrough,
        effect: 'confirms',
      },
      {
        shape: widening ? 'aboveMa50Ratio-below' : 'aboveMa50Ratio-above',
        threshold: before,
        effect: 'refutes',
      },
    ]),
  }
}

function detectSectorLeadership(inputs: StoryInputs): StoryCandidate | undefined {
  const top = strongestSector(vnRows(inputs.sections, 'sector-rotation'))

  if (top === undefined) {
    return undefined
  }

  const leading = top.strength > 0
  const code = leading ? 'sector-leading' : 'sector-lagging'
  const now = inputs.breadth.aboveMa50Ratio
  const narrowMarket = leading ? now < P.breadthMidline : now > P.breadthMidline
  const row: NonNullable<StoryWatch['row']> = { field: 'sector', value: top.sector }

  return {
    code,
    runKey: toRunKey(code, top.sector),
    salience: salienceOf(Math.abs(top.strength), P.sectorStrength),
    facts: [
      fact({ sector: top.sector, strength: top.strength }, 'supports'),
      ...sectorForeignFact(inputs, top.sector),
      ...(narrowMarket ? [fact({ aboveMa50Ratio: now }, 'contradicts')] : []),
    ],
    watches: buildWatches([
      {
        shape: leading ? 'strength-above' : 'strength-below',
        threshold: (leading ? 1 : -1) * P.sectorStrong,
        effect: 'confirms',
        row,
      },
      {
        shape: leading ? 'strength-below' : 'strength-above',
        threshold: 0,
        effect: 'refutes',
        row,
      },
    ]),
  }
}

function detectBasis(inputs: StoryInputs): StoryCandidate | undefined {
  const { basis } = inputs
  const trend = inputs.breadth.indexToMa50Pct
  const basisPct = basis?.basisPct

  if (typeof basisPct !== 'number' || trend === undefined) {
    return undefined
  }

  if (Math.abs(basisPct) < P.basisDislocation) {
    return undefined
  }

  const premium = basisPct > 0
  const code = premium ? 'basis-premium' : 'basis-discount'

  return {
    code,
    runKey: toRunKey(code),
    salience: salienceOf(Math.abs(basisPct), P.basisDislocation),
    facts: basisFacts(inputs, basisPct),
    watches: buildWatches([
      {
        shape: premium ? 'indexToMa50Pct-above' : 'indexToMa50Pct-below',
        threshold: trend + (premium ? 1 : -1) * P.indexFollowThrough,
        effect: 'confirms',
        horizonSessions: P.basisHorizonSessions,
      },
      {
        shape: premium ? 'basisPct-below' : 'basisPct-above',
        threshold: (premium ? 1 : -1) * (P.basisDislocation / 2),
        effect: 'refutes',
        horizonSessions: P.basisHorizonSessions,
      },
    ]),
  }
}

function basisFacts(inputs: StoryInputs, basisPct: number): readonly StoryFact[] {
  const contract = inputs.basis?.ticker
  const thinTrade =
    inputs.turnoverRatio !== undefined && inputs.turnoverRatio < CONFIRMING_TURNOVER_RATIO

  return [
    fact(typeof contract === 'string' ? { ticker: contract, basisPct } : { basisPct }, 'supports'),
    ...vn30Fact(inputs),
    ...(thinTrade ? turnoverFact(inputs, 'contradicts') : []),
  ]
}

function splitFacts(inputs: StoryInputs): readonly StoryFact[] {
  const { breadth } = inputs
  const counts = {
    advancers: breadth.advancers,
    decliners: breadth.decliners,
    measured: breadth.measured,
  }

  return [
    ...moveFacts(inputs),
    fact(counts, 'supports'),
    ...sessionForeignFact(inputs),
    ...turnoverFact(inputs, 'contradicts'),
    fact({ aboveMa50Ratio: breadth.aboveMa50Ratio }, 'contradicts'),
  ]
}

function sessionForeignFact(inputs: StoryInputs): readonly StoryFact[] {
  const net = inputs.sessionForeignNet

  return net === undefined ? [] : [fact({ foreignNetBase: net }, 'supports')]
}

/** The proprietary desks' window net, only when they stood on the other side of the foreign desks. */
function proprietaryFact(inputs: StoryInputs, foreignNet: number): readonly StoryFact[] {
  const net = vnRows(inputs.sections, 'proprietary-flow')
    .map((row) => row.net)
    .find((value) => typeof value === 'number')

  if (typeof net !== 'number' || Math.sign(net) * Math.sign(foreignNet) >= 0) {
    return []
  }

  return [fact({ proprietaryNetWindow: net, sessions: FLOW_DEVIATION_SESSIONS }, 'contradicts')]
}

/** Net advancers on the other side of the index move, so a reader sees the breadth disagree. */
function againstMoveFact(inputs: StoryInputs): readonly StoryFact[] {
  const { netAdvancers } = inputs.breadth

  if (Math.sign(netAdvancers) * Math.sign(inputs.indexMovePct) >= 0) {
    return []
  }

  return [fact({ netAdvancers }, 'contradicts')]
}

function sectorForeignFact(inputs: StoryInputs, sector: string): readonly StoryFact[] {
  const row = vnRows(inputs.sections, 'foreign-desk-flow').find(
    (candidate) => candidate.sector === sector && typeof candidate.foreignNetBase === 'number'
  )

  return row === undefined || typeof row.foreignNetBase !== 'number'
    ? []
    : [fact({ sector, foreignNetBase: row.foreignNetBase }, 'supports')]
}

/** The listed sector furthest from neutral, when it clears the floor. The section lists a top and a
 *  bottom regardless of how strong they are, so presence alone is not a signal. */
function strongestSector(rows: readonly BriefSectionRow[]): StrongSector | undefined {
  let strongest: StrongSector | undefined

  for (const row of rows) {
    const { sector, strength } = row

    if (typeof sector !== 'string' || typeof strength !== 'number') {
      continue
    }

    const beatsFloor = Math.abs(strength) >= P.sectorStrength

    if (
      beatsFloor &&
      (strongest === undefined || Math.abs(strength) > Math.abs(strongest.strength))
    ) {
      strongest = { sector, strength }
    }
  }

  return strongest
}

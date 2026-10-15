import type {
  AgentFocusRecord,
  AgentFocusStore,
} from '@/trading/features/suggestion/store/agent-focus'
import type { SuggestionStore } from '@/trading/features/suggestion/store/suggestion'
import type { FocusCount } from '@/trading/features/suggestion/store/suggestion-outcome'
import type {
  FocusAgreement,
  FocusOverlap,
} from '@/trading/features/suggestion/track-record/agreement'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { AgentFocus, FocusKey } from '@/trading/kernel/operator/focus'
import { ValidationError } from '@/core/errors'
import { dayInZone, MS_PER_DAY } from '@/core/utils/time'
import { MAXIMUM_OUTCOME_LOOKBACK_DAYS } from '@/trading/features/suggestion/pipeline/outcome-window'
import { MINIMUM_TRACK_RECORD_SAMPLE } from '@/trading/features/suggestion/pipeline/reporting'
import {
  isOverlapping,
  summarizeAgreement,
  summarizeOverlaps,
} from '@/trading/features/suggestion/track-record/agreement'
import { tradingDay } from '@/trading/kernel/instrument'
import { DEFAULT_FOCUS_KEY } from '@/trading/kernel/operator/focus'

interface AgentRecordDeps {
  readonly store: Pick<SuggestionStore, 'listFocusCounts' | 'listCallActions'>
  readonly agentFocuses: Pick<AgentFocusStore, 'listAll'>
}

interface ReadOptions {
  readonly now: number
  /** The operator's display zone, which reads every day this record names. */
  readonly timezone: string
  readonly signal: AbortSignal
}

/** An agent and the focus its `[focus]` configures now, which is what its comparisons speak for. */
export interface AgentFocusRef {
  readonly agentId: string
  readonly focusKey: FocusKey
}

interface BuildOptions extends ReadOptions {
  readonly agents: readonly AgentFocusRef[]
}

interface RecordCounts {
  readonly resolvedCount: number
  readonly winCount: number
  readonly winRate?: number
}

export interface FocusSummary extends RecordCounts {
  readonly focusKey: FocusKey
  readonly focus?: AgentFocus
}

interface AgentFocusView extends FocusSummary {
  readonly firstSeenAt: number
  readonly lastSeenAt: number
  readonly firstSeenDay: TradingDay
}

/** One agent's record: what every focus it has used earned together, each focus apart, and how its
 *  current focus compares with the other agents'. */
export interface AgentRecordView {
  readonly agentId: string
  /** Every focus the agent has used, so editing a focus never starts a fresh record. */
  readonly combined: RecordCounts
  readonly byFocus: readonly AgentFocusView[]
  /** The configured focus, or the last one called under for an agent the caller did not name. */
  readonly focusKey?: FocusKey
  /** That focus's own history; absent before the agent's first call under it. */
  readonly current?: AgentFocusView
  readonly agreement?: FocusAgreement
  /** Other agents whose current focus almost always reaches the same call. */
  readonly overlapsWith: readonly string[]
}

function toCounts(rows: readonly RecordCounts[]): RecordCounts {
  const resolvedCount = rows.reduce((sum, row) => sum + row.resolvedCount, 0)
  const winCount = rows.reduce((sum, row) => sum + row.winCount, 0)

  return {
    resolvedCount,
    winCount,
    ...(resolvedCount >= MINIMUM_TRACK_RECORD_SAMPLE ? { winRate: winCount / resolvedCount } : {}),
  }
}

function countsOf(counts: ReadonlyMap<FocusKey, FocusCount>, key: FocusKey): RecordCounts {
  const count = counts.get(key)

  return toCounts(count === undefined ? [] : [count])
}

/** For each focus, the other focuses a single agent has also used. */
function siblingsOf(
  focuses: readonly AgentFocusRecord[]
): ReadonlyMap<FocusKey, ReadonlySet<FocusKey>> {
  const byAgent = new Map<string, FocusKey[]>()

  for (const record of focuses) {
    byAgent.set(record.agentId, [...(byAgent.get(record.agentId) ?? []), record.focusKey])
  }

  const siblings = new Map<FocusKey, Set<FocusKey>>()

  for (const keys of byAgent.values()) {
    for (const key of keys) {
      siblings.set(key, new Set([...(siblings.get(key) ?? []), ...keys.filter((k) => k !== key)]))
    }
  }

  return siblings
}

function currentOf(views: readonly AgentFocusView[]): AgentFocusView | undefined {
  return [...views].sort((left, right) => right.lastSeenAt - left.lastSeenAt)[0]
}

interface RecordInputs {
  readonly focuses: readonly AgentFocusRecord[]
  readonly counts: ReadonlyMap<FocusKey, FocusCount>
  readonly agreements: ReadonlyMap<FocusKey, FocusAgreement>
  readonly overlapping: readonly FocusOverlap[]
}

/** Three reads, once per listing: the focuses agents have used, the scored calls counted per focus,
 *  and the lean call actions. Never one read per agent. */
async function readRecordInputs(
  deps: AgentRecordDeps,
  options: ReadOptions
): Promise<RecordInputs> {
  const { signal } = options
  const sinceDay = tradingDay(
    dayInZone(options.now - MAXIMUM_OUTCOME_LOOKBACK_DAYS * MS_PER_DAY, options.timezone)
  )
  const [focuses, counts, calls] = await Promise.all([
    deps.agentFocuses.listAll(signal),
    deps.store.listFocusCounts(signal),
    deps.store.listCallActions({ sinceDay, signal }),
  ])
  const comparisons = { calls, siblings: siblingsOf(focuses) }

  return {
    focuses,
    counts: new Map(counts.map((row) => [row.focusKey, row])),
    agreements: new Map(summarizeAgreement(comparisons).map((row) => [row.focusKey, row])),
    overlapping: summarizeOverlaps(comparisons).filter(isOverlapping),
  }
}

export async function buildAgentRecords(
  deps: AgentRecordDeps,
  options: BuildOptions
): Promise<readonly AgentRecordView[]> {
  const inputs = await readRecordInputs(deps, options)
  const configured = new Map(options.agents.map((agent) => [agent.agentId, agent.focusKey]))
  // Every agent with a history takes part, so a requested agent overlaps with one that was not.
  const agentIds = new Set([
    ...configured.keys(),
    ...inputs.focuses.map((record) => record.agentId),
  ])
  const views = [...agentIds].map((agentId) =>
    toView({ agentId, configured: configured.get(agentId), timezone: options.timezone, ...inputs })
  )

  return withComparisons(views, inputs).filter((view) => configured.has(view.agentId))
}

/** One focus as the operator reads it: what it earned, which agents use it, and how it sits beside
 *  the others. The operator's own focus is one of them. */
export interface FocusRecordView extends FocusSummary {
  /** Absent for a focus no agent has called under, such as the operator's own before any call. */
  readonly firstSeenAt?: number
  readonly lastSeenAt?: number
  readonly agentIds: readonly string[]
  readonly agreement?: FocusAgreement
  readonly overlapsWith: readonly FocusKey[]
}

export async function buildFocusRecords(
  deps: AgentRecordDeps,
  options: ReadOptions
): Promise<readonly FocusRecordView[]> {
  const inputs = await readRecordInputs(deps, options)
  const keys = [...new Set([DEFAULT_FOCUS_KEY, ...inputs.focuses.map((record) => record.focusKey)])]

  return keys.map((focusKey) => toFocusView(focusKey, inputs))
}

function toFocusView(focusKey: FocusKey, inputs: RecordInputs): FocusRecordView {
  const records = inputs.focuses.filter((record) => record.focusKey === focusKey)
  const agreement = inputs.agreements.get(focusKey)
  const focus = records.find((record) => record.focus !== undefined)?.focus

  return {
    ...countsOf(inputs.counts, focusKey),
    focusKey,
    ...(focus === undefined ? {} : { focus }),
    ...(records.length === 0
      ? {}
      : {
          firstSeenAt: Math.min(...records.map((record) => record.firstSeenAt)),
          lastSeenAt: Math.max(...records.map((record) => record.lastSeenAt)),
        }),
    agentIds: records.map((record) => record.agentId),
    ...(agreement === undefined ? {} : { agreement }),
    overlapsWith: inputs.overlapping.flatMap((pair) => partnerOf(focusKey, pair)),
  }
}

interface ViewInput {
  readonly agentId: string
  readonly configured: FocusKey | undefined
  readonly timezone: string
  readonly focuses: readonly AgentFocusRecord[]
  readonly counts: ReadonlyMap<FocusKey, FocusCount>
}

function toView(input: ViewInput): AgentRecordView {
  const byFocus = input.focuses
    .filter((record) => record.agentId === input.agentId)
    .map((record) => ({
      ...countsOf(input.counts, record.focusKey),
      focusKey: record.focusKey,
      ...(record.focus === undefined ? {} : { focus: record.focus }),
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      firstSeenDay: tradingDay(dayInZone(record.firstSeenAt, input.timezone)),
    }))
  const current =
    input.configured === undefined
      ? currentOf(byFocus)
      : byFocus.find((entry) => entry.focusKey === input.configured)
  const focusKey = input.configured ?? current?.focusKey

  return {
    agentId: input.agentId,
    combined: toCounts(byFocus),
    byFocus,
    ...(focusKey === undefined ? {} : { focusKey }),
    ...(current === undefined ? {} : { current }),
    overlapsWith: [],
  }
}

function withComparisons(
  views: readonly AgentRecordView[],
  inputs: RecordInputs
): readonly AgentRecordView[] {
  const { agreements, overlapping } = inputs

  return views.map((view) => {
    const key = view.focusKey
    const agreement = key === undefined ? undefined : agreements.get(key)

    return {
      ...view,
      ...(agreement === undefined ? {} : { agreement }),
      overlapsWith: key === undefined ? [] : overlapsOf(key, views, overlapping),
    }
  })
}

function partnerOf(key: FocusKey, pair: FocusOverlap): readonly FocusKey[] {
  if (pair.left === key) {
    return [pair.right]
  }

  return pair.right === key ? [pair.left] : []
}

function overlapsOf(
  key: FocusKey,
  views: readonly AgentRecordView[],
  overlapping: readonly FocusOverlap[]
): readonly string[] {
  const partners = new Set(overlapping.flatMap((pair) => partnerOf(key, pair)))

  return views
    .filter((other) => other.focusKey !== undefined && partners.has(other.focusKey))
    .map((other) => other.agentId)
}

/** The operator's own focus when none is named, else one some agent has actually called under: a
 *  key nothing ever stored would only list nothing, and reads as a typo. */
export async function parseListedFocus(
  deps: Pick<AgentRecordDeps, 'agentFocuses'>,
  raw: string | undefined,
  signal: AbortSignal
): Promise<FocusKey> {
  if (raw === undefined || raw === DEFAULT_FOCUS_KEY) {
    return DEFAULT_FOCUS_KEY
  }

  const known = await deps.agentFocuses.listAll(signal)
  const match = known.find((record) => record.focusKey === raw)

  if (match === undefined) {
    throw new ValidationError(`no agent has called under focus '${raw}'`)
  }

  return match.focusKey
}

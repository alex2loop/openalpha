import { z } from 'zod'

import type { AgentId, BrandTag } from '@/core/ids'
import type { ToolInvocationContext } from '@/core/tool'
import type { HoldReasonCode } from '@/trading/kernel/caveat'
import type { MarketRef, PortfolioSegment } from '@/trading/kernel/instrument'
import type {
  InvestmentGoal,
  InvestmentHorizon,
  UserProfile,
} from '@/trading/kernel/operator/profile'
import { ValidationError } from '@/core/errors'
import { canonicalJson, hashString } from '@/core/utils/hash'
import { marketRef } from '@/trading/kernel/instrument'
import {
  horizonFor,
  INVESTMENT_GOALS,
  INVESTMENT_HORIZONS,
} from '@/trading/kernel/operator/profile'

const DEFAULT_KEY = 'default'
const SECTOR_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const FOCUS_SCHEMA = z
  .strictObject({
    markets: z.array(z.string().min(1)).min(1).optional(),
    sectors: z.array(z.string().regex(SECTOR_SLUG)).min(1).optional(),
    horizon: z.enum(INVESTMENT_HORIZONS).optional(),
    goal: z.enum(INVESTMENT_GOALS).optional(),
  })
  .refine((focus) => Object.keys(focus).length > 0, 'an empty [focus] table narrows nothing')

/** Holds written about the operator's own book: what they hold, sold, can afford or asked never to
 *  see. A second opinion is the agent's view of a name, so none of these may leave with it. */
const BOOK_STATE_HOLD_REASONS: ReadonlySet<HoldReasonCode> = new Set<HoldReasonCode>([
  'zero-nav',
  'excluded-instrument',
  'segment-off',
  'segment-target-zero',
  'cap-exhausted',
  'sector-cap-exhausted',
  'etf-cap-exhausted',
  'segment-cap-exhausted',
  'cash-exhausted',
  'risk-budget-too-small',
  'open-risk-exhausted',
  'size-below-board-lot',
  'sale-below-board-lot',
  'position-unsettled',
  'increase-unfunded',
  'fully-invested',
  'no-rebalance-needed',
  'evidence-sold',
  'recorded-entry',
])

type ParsedFocus = z.infer<typeof FOCUS_SCHEMA>

export type FocusKey = string & BrandTag<'FocusKey'>

/** The operator's own focus: every agent with no `[focus]` shares it, and only its calls drive
 *  the book. */
export const DEFAULT_FOCUS_KEY = DEFAULT_KEY as FocusKey

export interface AgentFocus {
  readonly markets?: readonly MarketRef[]
  readonly sectors?: readonly string[]
  readonly horizon?: InvestmentHorizon
  /** What the agent hunts for, in the profile's goal words (`income` for dividends). A mark on the
   *  agent only: `resolveRunFocus` leaves it out, so it never changes, splits or labels a call. */
  readonly goal?: InvestmentGoal
}

export interface RunFocus {
  readonly key: FocusKey
  readonly focus?: AgentFocus
}

export const DEFAULT_RUN_FOCUS: RunFocus = Object.freeze({ key: DEFAULT_FOCUS_KEY })

export interface FocusScope {
  readonly markets: readonly MarketRef[]
  hasSectors(market: MarketRef): boolean
}

function toIssueText(issue: z.core.$ZodIssue): string {
  return issue.path.length === 0 ? issue.message : `${issue.path.join('.')} ${issue.message}`
}

function sortedUnique<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)].sort()
}

function validateScopeMarkets(focus: ParsedFocus, scope: FocusScope): readonly string[] {
  const known = new Set<string>(scope.markets)

  return (focus.markets ?? [])
    .filter((market) => !known.has(market))
    .map((market) => `markets ${market} is not a market this book trades`)
}

function validateSectorSupport(focus: ParsedFocus, scope: FocusScope): readonly string[] {
  if (focus.sectors === undefined) {
    return []
  }

  if (focus.markets === undefined) {
    const anySectors = scope.markets.some((market) => scope.hasSectors(market))

    return anySectors ? [] : ['sectors no market this book trades keeps sector data']
  }

  // Only markets the book trades: a raw string outside it is already an issue, and branding it
  // would throw before the agent could be skipped.
  const named = focus.markets

  return scope.markets
    .filter((market) => named.includes(market) && !scope.hasSectors(market))
    .map((market) => `sectors ${market} keeps no sector data`)
}

/** Issues with a raw `[focus]` table, empty when it is usable. */
export function validateAgentFocus(raw: unknown, scope: FocusScope): readonly string[] {
  const parsed = FOCUS_SCHEMA.safeParse(raw)

  if (!parsed.success) {
    return parsed.error.issues.map(toIssueText)
  }

  return [...validateScopeMarkets(parsed.data, scope), ...validateSectorSupport(parsed.data, scope)]
}

/** Both arrays are deduped and sorted, so `focusKey` is stable however the operator ordered them. */
export function toAgentFocus(raw: unknown): AgentFocus | undefined {
  if (raw === undefined) {
    return undefined
  }

  const parsed = FOCUS_SCHEMA.safeParse(raw)

  if (!parsed.success) {
    throw new ValidationError(
      `focus is invalid: ${parsed.error.issues.map(toIssueText).join('; ')}`
    )
  }

  const { markets, sectors, horizon, goal } = parsed.data

  return {
    ...(markets === undefined ? {} : { markets: sortedUnique(markets).map(marketRef) }),
    ...(sectors === undefined ? {} : { sectors: sortedUnique(sectors) }),
    ...(horizon === undefined ? {} : { horizon }),
    ...(goal === undefined ? {} : { goal }),
  }
}

/** Hashes the declared table only, never the merged profile: editing the profile must not orphan
 *  today's stored call or split a record. */
function focusKey(focus: AgentFocus | undefined): FocusKey {
  if (focus === undefined) {
    return DEFAULT_FOCUS_KEY
  }

  return `f-${hashString(canonicalJson(focus))}` as FocusKey
}

/** The focus a call is made, keyed and shared under: the declared table less `goal`, so agents that
 *  differ only in their goal share one call and one debate. A table holding only a goal narrows
 *  nothing, so it is the operator's own focus. */
export function resolveRunFocus(raw: unknown): RunFocus {
  const { goal: _goal, ...focus } = toAgentFocus(raw) ?? {}

  if (Object.keys(focus).length === 0) {
    return DEFAULT_RUN_FOCUS
  }

  return { key: focusKey(focus), focus }
}

/** A sector-less market is outside a sector focus: the call cannot prove it belongs. */
export function isOutsideFocus(run: RunFocus, market: MarketRef, sector?: string): boolean {
  const { markets, sectors } = run.focus ?? {}

  if (markets !== undefined && !markets.includes(market)) {
    return true
  }

  return sectors !== undefined && (sector === undefined || !sectors.includes(sector))
}

export function runHorizon(
  run: RunFocus,
  profile: UserProfile,
  segment: PortfolioSegment
): InvestmentHorizon {
  return run.focus?.horizon ?? horizonFor(profile, segment)
}

export function isBookFocus(run: RunFocus): boolean {
  return run.key === DEFAULT_FOCUS_KEY
}

export function isBookCall(call: { readonly focusKey: FocusKey }): boolean {
  return call.focusKey === DEFAULT_FOCUS_KEY
}

/** The hold reasons a second opinion may show: the book's own are dropped. */
export function withoutBookHoldReasons(
  codes: readonly HoldReasonCode[]
): readonly HoldReasonCode[] {
  return codes.filter((code) => !BOOK_STATE_HOLD_REASONS.has(code))
}

interface RootAgentFocus {
  readonly owner: AgentId
  readonly focus: RunFocus
}

/** The focus of the run tree, read from the registry and never from tool arguments: the outermost
 *  agent with a `[focus]` owns it, so a helper it delegates to keeps that focus and its call never
 *  becomes a book call that ratchets a stop. A tree with none is the operator's own, owned by its root. */
export function rootAgentFocus(
  ctx: Pick<ToolInvocationContext, 'agentId' | 'delegationChain' | 'services'>
): RootAgentFocus {
  const lineage = [...ctx.delegationChain, ctx.agentId]
  const owner = lineage.find((id) => ctx.services.agents.get(id)?.focus !== undefined)

  if (owner === undefined) {
    return { owner: ctx.delegationChain[0] ?? ctx.agentId, focus: DEFAULT_RUN_FOCUS }
  }

  return { owner, focus: resolveRunFocus(ctx.services.agents.get(owner)?.focus) }
}

import { type Signal, signal } from '@preact/signals'

import type { AgentDetailWire, AgentFocusWire } from '@/app/server/wire/agents'
import type { AgentDraft } from '@/web/state/agents'

// What the daemon takes as an id: lowercase letters, digits and dashes, at most this long.
const ID_MAX_LENGTH = 64
const MARKS = /\p{M}/gu
const NOT_ID = /[^a-z0-9]+/g
const EDGE_DASHES = /^-+|-+$/g
// Vietnamese "đ" has no decomposed form, so it is mapped before the marks are stripped.
const D_STROKE = /đ/g

type Horizon = NonNullable<AgentFocusWire['horizon']>

/** One open agent form: every field the operator edits, and what it held when it opened. */
export interface AgentForm {
  /** The agent edited; absent while one is being created. */
  readonly existing: AgentDetailWire | undefined
  readonly name: Signal<string>
  /** The id the operator typed; absent while it follows the name. */
  readonly typedId: Signal<string | undefined>
  readonly prompt: Signal<string>
  readonly markets: Signal<readonly string[]>
  readonly sectors: Signal<readonly string[]>
  /** The sectors the ticked markets file; a picked one outside them is not sent. */
  readonly sectorChoices: Signal<readonly string[]>
  readonly horizon: Signal<Horizon | undefined>
  readonly budget: Signal<string>
  /** Empty runs on the primary model. */
  readonly modelTier: Signal<string>
  /** 0 lets it start no child agents. */
  readonly maxSpawn: Signal<number>
  readonly failure: Signal<string | undefined>
  /** The daemon's sentence for each field it refused, by the path it named. */
  readonly fields: Signal<ReadonlyMap<string, string>>
  readonly isBusy: Signal<boolean>
}

export function createAgentForm(existing: AgentDetailWire | undefined): AgentForm {
  const focus = existing?.focus

  return {
    existing,
    name: signal(existing?.name ?? ''),
    typedId: signal(undefined),
    prompt: signal(existing?.systemPrompt ?? ''),
    markets: signal(focus?.markets ?? []),
    sectors: signal(focus?.sectors ?? []),
    sectorChoices: signal(focus?.sectors ?? []),
    horizon: signal(focus?.horizon),
    budget: signal(existing?.maxDailyUsd === undefined ? '' : String(existing.maxDailyUsd)),
    modelTier: signal(existing?.modelTier ?? ''),
    maxSpawn: signal(existing?.maxSpawn ?? 0),
    failure: signal(undefined),
    fields: signal(new Map()),
    isBusy: signal(false),
  }
}

/** What the operator has set so far, to tell an edited form from an untouched one. */
export function snapshotForm(form: AgentForm): string {
  return JSON.stringify([
    form.name.value,
    form.typedId.value,
    form.prompt.value,
    form.markets.value,
    form.sectors.value,
    form.horizon.value,
    form.budget.value,
    form.modelTier.value,
    form.maxSpawn.value,
  ])
}

/** The id the agent is saved under: fixed once it exists, else typed, else made from the name. */
export function resolveAgentId(form: AgentForm): string {
  return form.existing?.id ?? form.typedId.value ?? toAgentId(form.name.value)
}

/** "Săn cổ tức" becomes "san-co-tuc". */
function toAgentId(name: string): string {
  return name
    .toLowerCase()
    .replace(D_STROKE, 'd')
    .normalize('NFD')
    .replace(MARKS, '')
    .replace(NOT_ID, '-')
    .replace(EDGE_DASHES, '')
    .slice(0, ID_MAX_LENGTH)
}

/** What a save sends. A field the form does not show (the description, the goal, the look) goes
 *  back as it was, since an edit replaces every field. */
export function buildDraft(form: AgentForm): AgentDraft {
  const { existing } = form
  const budget = Number(form.budget.value)
  const focus = buildFocus(form)

  return {
    id: resolveAgentId(form),
    name: form.name.value.trim(),
    ...(existing?.description === undefined ? {} : { description: existing.description }),
    systemPrompt: form.prompt.value.trim(),
    ...(focus === undefined ? {} : { focus }),
    ...(Number.isFinite(budget) && budget > 0 ? { maxDailyUsd: budget } : {}),
    ...(form.modelTier.value === '' ? {} : { modelTier: form.modelTier.value }),
    ...(form.maxSpawn.value > 0 ? { maxSpawn: form.maxSpawn.value } : {}),
    ...(existing?.look === undefined ? {} : { look: existing.look }),
  }
}

function buildFocus(form: AgentForm): AgentFocusWire | undefined {
  const markets = form.markets.value
  const sectors = form.sectors.value.filter((sector) => form.sectorChoices.value.includes(sector))
  const horizon = form.horizon.value
  const goal = form.existing?.focus?.goal
  const focus: AgentFocusWire = {
    ...(markets.length === 0 ? {} : { markets }),
    ...(sectors.length === 0 ? {} : { sectors }),
    ...(horizon === undefined ? {} : { horizon }),
    ...(goal === undefined ? {} : { goal }),
  }

  return Object.keys(focus).length === 0 ? undefined : focus
}

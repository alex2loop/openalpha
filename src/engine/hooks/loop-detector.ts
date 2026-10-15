import type { Capability, ToolCall, ToolDefinition } from '@/core/tool'
import type { AfterToolHook, RunState, ToolGate, ToolGateResult } from '@/engine/types/run'
import { RunHalted, ToolError } from '@/core/errors'
import { hashString } from '@/core/utils/hash'
import {
  LOOP_DETECTOR_MATCHES,
  LOOP_DETECTOR_MIN_FUZZY_WORDS,
  LOOP_DETECTOR_NEAR_DUP_SIMILARITY,
  LOOP_DETECTOR_WINDOW,
} from '@/engine/constants'

const TOKEN_RE = /[^\p{L}\p{N}]+/u
const WORD_RE = /\s+/
const CLOSED_MESSAGE =
  'loop_detector: repeated near-identical calls - tools are closed for the rest of this run. Answer now from what you already have and say what is missing.'
const REDIRECT_MESSAGE =
  'loop_detector: this call repeats a near-identical earlier call. Change your approach or explain the repeat in your answer - one more identical call closes every tool.'
const RUNAWAY_MESSAGE = 'loop_detector: per-run tool-call budget exhausted - halting'
const EMPTY_TOKENS: ReadonlySet<string> = new Set()
const MUTATION_CAPABILITY: Capability = 'write'

interface CallEntry {
  readonly name: string
  readonly argsHash: string
  readonly fuzzy: boolean
  readonly argsTokens: ReadonlySet<string>
}

interface DetectorState {
  readonly recent: CallEntry[]
  toolCalls: number
  isClosed: boolean
}

// Per-run state, keyed on the run's own RunState object so it is collected with the run.
const states = new WeakMap<RunState, DetectorState>()

// Keyed on name + args, never the result (a dead endpoint returns a byte-different body each call).
// Three triggers: exact name+args repeats, near-duplicate multi-word queries (fuzzy), and a per-run
// volume cap that catches an agent fanning out distinct calls without converging — args-matching
// misses that. URLs/paths/ids stay exact-only for the first two: their shared structural tokens
// would false-trip distinct resources (two news-article URLs score ~0.8 Jaccard).
//
// Record this call, then detect against `recent` including it — an inclusive count, so MATCHES = 3
// halts on the third identical call. Recording here rather than in afterTool counts a call that a
// later gate blocks — capability/approval return before afterTool, so a blocked-call loop would
// otherwise never trip. The (MATCHES - 1)th repeat blocks with a redirect the model can read; the
// MATCHESth closes the tool surface for the rest of the run. Closing rather than halting: the
// transcript already holds every result the model fetched, and a run that ends in an answer built
// from them beats one that ends in a halt code. The tool-call budget still halts — it is a budget.
export const loopDetectorGate: ToolGate = async (run, call): Promise<ToolGateResult> => {
  const state = stateFor(run.state)

  if (state.isClosed) {
    return blocked(CLOSED_MESSAGE)
  }

  const entry = buildCallEntry(call)

  state.toolCalls += 1
  state.recent.push(entry)

  if (state.toolCalls > run.env.limits.maxToolCalls) {
    throw new RunHalted('loop', RUNAWAY_MESSAGE)
  }

  const repeats = repeatCount(state.recent, entry)

  if (repeats >= LOOP_DETECTOR_MATCHES) {
    state.isClosed = true
    run.state.toolExposure.close()

    return blocked(CLOSED_MESSAGE)
  }

  trimWindow(state.recent)

  return repeats === LOOP_DETECTOR_MATCHES - 1 ? blocked(REDIRECT_MESSAGE) : { action: 'allow' }
}

// A read repeated after a successful mutation asks a different question - the state it reads has
// changed - and a tool taking no arguments cannot say so in its arguments. So a mutation clears the
// window. A failed one does not: repeating that is the loop this gate exists to catch.
export const loopDetectorAfterTool: AfterToolHook = async (run, call, result): Promise<void> => {
  if (result.isError || !isMutation(run.env.tools, call.name)) {
    return
  }

  stateFor(run.state).recent.length = 0
}

function isMutation(tools: readonly ToolDefinition[], name: string): boolean {
  return tools.find((tool) => tool.name === name)?.capability === MUTATION_CAPABILITY
}

function blocked(message: string): ToolGateResult {
  return { action: 'block', message, error: new ToolError('repeated_call', message) }
}

function trimWindow(recent: CallEntry[]): void {
  if (recent.length > LOOP_DETECTOR_WINDOW) {
    recent.shift()
  }
}

function stateFor(key: RunState): DetectorState {
  const existing = states.get(key)

  if (existing !== undefined) {
    return existing
  }

  const fresh: DetectorState = { recent: [], toolCalls: 0, isClosed: false }
  states.set(key, fresh)

  return fresh
}

function buildCallEntry(call: ToolCall): CallEntry {
  const fuzzy = isFuzzy(call.input)

  return {
    name: call.name,
    argsHash: hashString(JSON.stringify(call.input) ?? ''),
    fuzzy,
    argsTokens: fuzzy ? tokenize(call.input) : EMPTY_TOKENS,
  }
}

// Inclusive count of window entries matching this call, exact hash first, fuzzy Jaccard second.
function repeatCount(recent: readonly CallEntry[], entry: CallEntry): number {
  const exact = recent.filter((e) => e.name === entry.name && e.argsHash === entry.argsHash).length

  if (exact >= LOOP_DETECTOR_MATCHES || !entry.fuzzy) {
    return exact
  }

  const nearDup = recent.filter(
    (e) =>
      e.name === entry.name &&
      e.fuzzy &&
      jaccard(e.argsTokens, entry.argsTokens) >= LOOP_DETECTOR_NEAR_DUP_SIMILARITY
  ).length

  return Math.max(exact, nearDup)
}

// Fuzzy-eligible only when a string arg is a multi-word query: those drift word-by-word across
// retries. An id or path does not, so it stays exact-match only.
function isFuzzy(args: unknown): boolean {
  return stringValues(args).some(
    (v) => v.trim().split(WORD_RE).length >= LOOP_DETECTOR_MIN_FUZZY_WORDS
  )
}

function tokenize(args: unknown): ReadonlySet<string> {
  return new Set(stringValues(args).join(' ').toLowerCase().split(TOKEN_RE).filter(Boolean))
}

function stringValues(args: unknown): readonly string[] {
  if (typeof args === 'string') {
    return [args]
  }

  if (args === null || typeof args !== 'object') {
    return []
  }

  return Object.values(args).filter((v): v is string => typeof v === 'string')
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0
  }

  let intersection = 0

  for (const token of a) {
    if (b.has(token)) {
      intersection += 1
    }
  }

  return intersection / (a.size + b.size - intersection)
}

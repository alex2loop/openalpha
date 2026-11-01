import type { TerminalInput } from '@/cli/terminal'
import type { PromptFn } from '@/cli/ui/prompt'
import type { Locale } from '@/core/types/locale'
import { suspendKeypressListeners } from '@/cli/ui/prompt'
import { t } from '@/i18n'

// Raw mode turns off ISIG, so Ctrl-C arrives as this byte instead of a signal.
const CTRL_C = '\x03'

type PlanSelectOutcome =
  | { readonly kind: 'start' }
  | { readonly kind: 'edit'; readonly instruction: string }
  | { readonly kind: 'cancel' }

interface PlanSelectDeps {
  readonly locale: Locale
  readonly input: TerminalInput
  readonly signal: AbortSignal
  readonly write: (line: string) => void
  readonly canEdit: boolean
  readonly prompt: PromptFn
}

// Single-key Start/Edit/Cancel over an interactive input stream. The signal is checked before raw
// mode and listener setup; Enter starts, `e` edits (the edit instruction is read with the existing
// PromptFn), `q` or Escape cancels. Raw mode, the data listener and the detached keypress listeners
// are restored in finally - the same finally runs on abort, the early-return path, and any throw.
export async function selectPlanAction(deps: PlanSelectDeps): Promise<PlanSelectOutcome> {
  if (deps.signal.aborted) {
    return { kind: 'cancel' }
  }

  deps.write(reviewPrompt(deps.locale, deps.canEdit))

  const first = await readSingleKey(deps)

  if (first === 'start' || first === 'cancel') {
    return { kind: first }
  }

  return await readEditOutcome(deps)
}

async function readSingleKey(deps: PlanSelectDeps): Promise<'start' | 'edit' | 'cancel'> {
  const wasRaw = deps.input.isTTY ? deps.input.isRaw : false
  const reattach = suspendKeypressListeners(deps.input)

  try {
    if (deps.input.isTTY) {
      deps.input.setRawMode(true)
      deps.input.resume()
    }

    return await readFirstKeypress(deps)
  } finally {
    if (deps.input.isTTY) {
      deps.input.setRawMode(wasRaw)
    }

    reattach()
  }
}

// Resolves on the first recognized key (Enter/e/q/Escape). The data listener settles the deferred
// promise exactly once and is removed right after, so no key is lost to a dangling subscription.
function readFirstKeypress(deps: PlanSelectDeps): Promise<'start' | 'edit' | 'cancel'> {
  if (deps.signal.aborted) {
    return Promise.resolve('cancel')
  }

  return new Promise((resolve) => {
    let settled = false

    const onData = (data: Buffer): void => {
      if (deps.signal.aborted) {
        settle('cancel')
        return
      }

      const key = resolveKeypress(data)
      if (key === 'ignore') {
        return
      }
      settle(key)
    }

    const onAbort = (): void => settle('cancel')

    const settle = (action: 'start' | 'edit' | 'cancel'): void => {
      if (settled) {
        return
      }
      settled = true
      deps.input.removeListener('data', onData)
      deps.signal.removeEventListener('abort', onAbort)
      resolve(action)
    }

    deps.input.on('data', onData)
    deps.signal.addEventListener('abort', onAbort)
    if (deps.signal.aborted) {
      onAbort()
    }
  })
}

async function readEditOutcome(deps: PlanSelectDeps): Promise<PlanSelectOutcome> {
  if (!deps.canEdit) {
    return { kind: 'start' }
  }

  const instruction = await deps.prompt(t(deps.locale, 'cli.researchPlanEditPrompt'), {
    signal: deps.signal,
  })
  const trimmed = instruction.trim()

  if (trimmed === '') {
    deps.write(t(deps.locale, 'cli.researchPlanEditEmpty'))
    return { kind: 'start' }
  }

  return { kind: 'edit', instruction: trimmed }
}

type ResolvedKeypress = 'start' | 'edit' | 'cancel' | 'ignore'

function resolveKeypress(data: Buffer): ResolvedKeypress {
  const text = data.toString('utf8')

  if (text === '\r' || text === '\n') {
    return 'start'
  }
  if (text === 'q' || text === 'Q' || text === '\x1b' || text === CTRL_C) {
    return 'cancel'
  }
  if (text === 'e' || text === 'E') {
    return 'edit'
  }
  return 'ignore'
}

function reviewPrompt(locale: Locale, canEdit: boolean): string {
  return canEdit
    ? t(locale, 'cli.researchPlanReviewPromptWithEdit')
    : t(locale, 'cli.researchPlanReviewPromptNoEdit')
}

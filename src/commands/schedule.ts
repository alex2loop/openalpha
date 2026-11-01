import type {
  CommandMessage,
  CommandMessageKey,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import type { Job, JobOwner, SchedulerRunNowInput } from '@/scheduler/api'

const USAGE: CommandMessage = { key: 'slash.scheduleUsage' }
const MESSAGE_KEYS: readonly CommandMessageKey[] = [
  'slash.scheduleActionFail',
  'slash.scheduleAmbiguous',
  'slash.scheduleEmpty',
  'slash.scheduleIdRequired',
  'slash.scheduleNotFound',
  'slash.schedulePaused',
  'slash.scheduleRemoved',
  'slash.scheduleResumed',
  'slash.scheduleRow',
  'slash.scheduleRunDone',
  'slash.scheduleRunRejected',
  'slash.scheduleTitle',
  USAGE.key,
]

const SCHEDULE_VERBS = Object.freeze(['show', 'pause', 'resume', 'run', 'remove'] as const)

// A bounded slice: the list is operator-owned and small, but the response is capped regardless.
const MAX_ROWS = 20
const MUTATION_COOLDOWN_MS = 5_000

const READ_POLICY = {
  surfaces: ['channel', 'repl'] as const,
  role: 'member' as const,
  action: 'read' as const,
}
const MUTATE_POLICY = {
  surfaces: ['channel', 'repl'] as const,
  role: 'operator' as const,
  action: 'mutate' as const,
  cooldownMs: MUTATION_COOLDOWN_MS,
  idempotencyKey: (ctx: SlashContext) => ctx.requestId,
}
const COSTLY_POLICY = {
  surfaces: ['channel', 'repl'] as const,
  role: 'operator' as const,
  action: 'costly' as const,
  cooldownMs: MUTATION_COOLDOWN_MS,
  idempotencyKey: (ctx: SlashContext) => ctx.requestId,
  execution: { progressKey: 'slash.scheduleProgress' } as const,
  selfContained: true as const,
}

type ScheduleOperation =
  | { readonly kind: 'list' }
  | { readonly kind: 'show'; readonly id: string }
  | { readonly kind: 'pause'; readonly id: string }
  | { readonly kind: 'resume'; readonly id: string }
  | { readonly kind: 'run'; readonly id: string }
  | { readonly kind: 'remove'; readonly id: string }
  | { readonly kind: 'invalid' }

interface SchedulerCommands {
  list(owner: JobOwner): Promise<readonly Job[]>
  show(owner: JobOwner, idOrPrefix: string): Promise<SchedulerCommandResult>
  pause(owner: JobOwner, idOrPrefix: string): Promise<SchedulerCommandResult>
  resume(owner: JobOwner, idOrPrefix: string): Promise<SchedulerCommandResult>
  runNow(input: SchedulerRunNowInput): Promise<SchedulerCommandResult>
  remove(owner: JobOwner, idOrPrefix: string): Promise<SchedulerCommandResult>
}

type SchedulerCommandResult =
  | { readonly kind: 'job'; readonly job: Job }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'alert_inactive' }

export function createScheduleCommand(commands: SchedulerCommands): SlashCommand {
  return {
    name: 'schedule',
    description: { kind: 'localized', key: 'slash.scheduleHelp' },
    messageKeys: [...MESSAGE_KEYS],
    usage: () => USAGE,
    policy: READ_POLICY,
    policyFor: (args) => policyForScheduleOperation(parseScheduleOperation(args)),
    // The verb only: a job id is a stored value, and a completer may not read a store.
    completeFor: (args) => (args.length === 1 ? SCHEDULE_VERBS : []),
    run: async (ctx): Promise<SlashResult> => runScheduleCommand(commands, ctx),
  }
}

function policyForScheduleOperation(operation: ScheduleOperation) {
  switch (operation.kind) {
    case 'list':
    case 'show':
      return READ_POLICY
    case 'pause':
    case 'resume':
    case 'remove':
      return MUTATE_POLICY
    case 'run':
      return COSTLY_POLICY
    case 'invalid':
      return READ_POLICY
  }
}

function parseScheduleOperation(args: readonly string[]): ScheduleOperation {
  const [rawVerb, id, ...rest] = args
  const verb = SCHEDULE_VERBS.find((name) => name === rawVerb)

  if (rawVerb === undefined) {
    return { kind: 'list' }
  }

  return verb === undefined || rest.length > 0 ? { kind: 'invalid' } : { kind: verb, id: id ?? '' }
}

async function runScheduleCommand(
  commands: SchedulerCommands,
  ctx: SlashContext
): Promise<SlashResult> {
  const operation = parseScheduleOperation(ctx.args)
  const owner = ownerOf(ctx)

  switch (operation.kind) {
    case 'list':
      return listResult(await commands.list(owner))
    case 'show': {
      const result = await commands.show(owner, operation.id)
      return result.kind === 'job' ? rowResult(result.job) : failureResult(result, operation.id)
    }
    case 'pause': {
      const result = await commands.pause(owner, operation.id)
      return result.kind === 'job'
        ? messageResult('slash.schedulePaused', { id: result.job.id })
        : failureResult(result, operation.id)
    }
    case 'resume': {
      const result = await commands.resume(owner, operation.id)
      return result.kind === 'job'
        ? messageResult('slash.scheduleResumed', { id: result.job.id })
        : failureResult(result, operation.id)
    }
    case 'run': {
      const result = await commands.runNow({
        owner,
        idOrPrefix: operation.id,
        requestId: ctx.requestId,
        signal: ctx.signal,
      })

      if (result.kind === 'job') {
        return messageResult('slash.scheduleRunDone', { id: result.job.id })
      }
      return result.kind === 'rejected'
        ? messageResult('slash.scheduleRunRejected')
        : failureResult(result, operation.id)
    }
    case 'remove': {
      const result = await commands.remove(owner, operation.id)
      return result.kind === 'job'
        ? messageResult('slash.scheduleRemoved', { id: result.job.id })
        : failureResult(result, operation.id)
    }
    case 'invalid':
      return messageResult('slash.scheduleIdRequired')
  }
}

function ownerOf(ctx: SlashContext): JobOwner {
  return { userId: ctx.userId, channel: ctx.channel, chatId: ctx.chatId }
}

function listResult(jobs: readonly Job[]): SlashResult {
  const visible = jobs.slice(0, MAX_ROWS)

  return visible.length === 0
    ? { kind: 'message', messages: [{ key: 'slash.scheduleEmpty' }] }
    : { kind: 'message', title: { key: 'slash.scheduleTitle' }, messages: visible.map(rowFor) }
}

function failureResult(
  result: Exclude<SchedulerCommandResult, { readonly kind: 'job' }>,
  id: string
): SlashResult {
  if (result.kind === 'invalid') {
    return messageResult('slash.scheduleIdRequired')
  }

  if (result.kind === 'not_found') {
    return messageResult('slash.scheduleNotFound', { id })
  }

  if (result.kind === 'ambiguous') {
    return messageResult('slash.scheduleAmbiguous', { id })
  }

  return messageResult('slash.scheduleActionFail')
}

function rowResult(job: Job): SlashResult {
  return { kind: 'message', messages: [rowFor(job)] }
}

function messageResult(
  key: CommandMessageKey,
  values?: Readonly<Record<string, string>>
): SlashResult {
  return {
    kind: 'message',
    messages: [{ key, ...(values === undefined ? {} : { values }) }],
  }
}

function rowFor(job: Job): {
  readonly key: 'slash.scheduleRow'
  readonly values: { readonly id: string; readonly prompt: string }
} {
  return { key: 'slash.scheduleRow', values: { id: job.id, prompt: job.prompt } }
}

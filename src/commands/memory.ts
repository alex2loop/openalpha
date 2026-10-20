import type { Logger } from '@/core/logging/logger'
import type { CommandMessage, SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import type { Memory, MemoryScope } from '@/core/types/memory'
import { ValidationError } from '@/core/errors'
import { isMemoryKey, MEMORY_KEY_MAX_LEN } from '@/core/memory-key'
import { formatErrForLog } from '@/core/security/credentials'

const USAGE: CommandMessage = { key: 'slash.memoryUsage' }
const MESSAGE_KEYS = [
  USAGE.key,
  'slash.memoryNone',
  'slash.memoryNoneKey',
  'slash.memoryFindNone',
  'slash.memoryRow',
  'slash.memoryRecall',
  'slash.memoryRememberStored',
  'slash.memoryForgetDone',
  'slash.memoryActionFail',
  'slash.memoryKeyInvalid',
  'slash.memoryRejected',
  'slash.memoryTitle',
] as const

const MEMORY_VERBS = Object.freeze(['find', 'remember', 'forget'] as const)

const DESCRIPTION = { kind: 'localized', key: 'slash.memoryHelp' } as const
const SURFACES = ['channel', 'repl'] as const
const READ_POLICY = {
  surfaces: [...SURFACES],
  role: 'member' as const,
  action: 'read' as const,
}
const WRITE_POLICY = {
  surfaces: [...SURFACES],
  role: 'member' as const,
  action: 'mutate' as const,
  idempotencyKey: (ctx: SlashContext) => ctx.requestId,
}
// A list/find result maps each row to its own message; cap the count so a huge memory
// never produces an unbounded response.
const MAX_ROWS = 20

type MemoryOperation =
  | { readonly kind: 'list' }
  | { readonly kind: 'find'; readonly query: string }
  | { readonly kind: 'remember'; readonly key: string; readonly value: string }
  | { readonly kind: 'forget'; readonly key: string }
  | { readonly kind: 'recall'; readonly key: string }
  | { readonly kind: 'usage' }

export function createMemoryCommand(
  memory: Memory,
  scopeFor: (ctx: SlashContext) => Promise<MemoryScope>,
  logger: Logger
): SlashCommand {
  return {
    name: 'memory',
    description: DESCRIPTION,
    messageKeys: [...MESSAGE_KEYS],
    policy: READ_POLICY,
    policyFor: (args) => {
      const operation = parseMemoryOperation(args)
      return operation.kind === 'remember' || operation.kind === 'forget'
        ? WRITE_POLICY
        : READ_POLICY
    },
    // The verb only: any other first word is a recall key, which lives in the store.
    completeFor: (args) => (args.length === 1 ? MEMORY_VERBS : []),
    usage: () => USAGE,
    run: async (ctx: SlashContext): Promise<SlashResult> => {
      const scope = await scopeFor(ctx)
      return runMemoryOperation({
        memory,
        scope,
        logger,
        operation: parseMemoryOperation(ctx.args),
      })
    },
  }
}

function parseMemoryOperation(args: readonly string[]): MemoryOperation {
  const [raw, ...rest] = args

  if (raw === undefined) {
    return { kind: 'list' }
  }

  const verb = MEMORY_VERBS.find((name) => name === raw)

  if (verb === 'find') {
    return { kind: 'find', query: rest.join(' ') }
  }

  if (verb === 'remember') {
    const value = rest.slice(1).join(' ')

    return value === '' ? { kind: 'usage' } : { kind: 'remember', key: rest[0] ?? '', value }
  }

  if (verb === 'forget') {
    return { kind: 'forget', key: rest[0] ?? '' }
  }

  return { kind: 'recall', key: raw }
}

async function runMemoryOperation(options: {
  memory: Memory
  scope: MemoryScope
  logger: Logger
  operation: MemoryOperation
}): Promise<SlashResult> {
  const { memory, scope, logger, operation } = options

  if ('key' in operation && operation.key !== '' && !isMemoryKey(operation.key)) {
    return keyInvalidResult()
  }

  switch (operation.kind) {
    case 'list':
      return listMemory(memory, scope)
    case 'find':
      return findMemory(memory, scope, operation.query)
    case 'remember':
      return operation.key === ''
        ? usageResult()
        : rememberMemory({ memory, scope, key: operation.key, value: operation.value, logger })
    case 'forget':
      return operation.key === ''
        ? usageResult()
        : forgetMemory({ memory, scope, key: operation.key, logger })
    case 'recall':
      return recallMemory(memory, scope, operation.key)
    case 'usage':
      return usageResult()
  }
}

async function listMemory(memory: Memory, scope: MemoryScope): Promise<SlashResult> {
  const entries = await memory.list(scope, { limit: MAX_ROWS })

  return entries.length === 0
    ? { kind: 'message', messages: [{ key: 'slash.memoryNone' }] }
    : { kind: 'message', title: { key: 'slash.memoryTitle' }, messages: rowsToMessages(entries) }
}

async function findMemory(memory: Memory, scope: MemoryScope, query: string): Promise<SlashResult> {
  const hits = await memory.search(scope, query, MAX_ROWS)

  return hits.length === 0
    ? { kind: 'message', messages: [{ key: 'slash.memoryFindNone' }] }
    : { kind: 'message', title: { key: 'slash.memoryTitle' }, messages: rowsToMessages(hits) }
}

async function rememberMemory(options: {
  memory: Memory
  scope: MemoryScope
  key: string
  value: string
  logger: Logger
}): Promise<SlashResult> {
  const { memory, scope, key, logger } = options
  try {
    await memory.store(scope, key, { value: options.value })
  } catch (err: unknown) {
    logger.warn('commands.memory_store_failed', { err: formatErrForLog(err) })
    const failure =
      err instanceof ValidationError ? 'slash.memoryRejected' : 'slash.memoryActionFail'

    return { kind: 'message', messages: [{ key: failure }] }
  }

  return {
    kind: 'message',
    messages: [{ key: 'slash.memoryRememberStored', values: { key } }],
  }
}

async function forgetMemory(options: {
  memory: Memory
  scope: MemoryScope
  key: string
  logger: Logger
}): Promise<SlashResult> {
  const { memory, scope, key, logger } = options
  try {
    const removed = await memory.remove(scope, key)
    return {
      kind: 'message',
      messages: [{ key: 'slash.memoryForgetDone', values: { n: removed } }],
    }
  } catch (err: unknown) {
    logger.warn('commands.memory_remove_failed', { err: formatErrForLog(err) })
    return { kind: 'message', messages: [{ key: 'slash.memoryActionFail' }] }
  }
}

async function recallMemory(memory: Memory, scope: MemoryScope, key: string): Promise<SlashResult> {
  const recalled = await memory.recall(scope, key)

  return recalled === null
    ? { kind: 'message', messages: [{ key: 'slash.memoryNoneKey', values: { key } }] }
    : {
        kind: 'message',
        messages: [{ key: 'slash.memoryRecall', values: { key, value: recalled.value } }],
      }
}

function usageResult(): SlashResult {
  return { kind: 'message', messages: [USAGE] }
}

function keyInvalidResult(): SlashResult {
  return {
    kind: 'message',
    messages: [{ key: 'slash.memoryKeyInvalid', values: { max: MEMORY_KEY_MAX_LEN } }],
  }
}

// Each bounded row becomes one message with primitive values only — never a nested object or
// JSON blob — so the renderer applies the same scrub/escape path to every field.
function rowsToMessages(
  rows: readonly { readonly key: string; readonly value: string }[]
): readonly {
  readonly key: 'slash.memoryRow'
  readonly values: Readonly<Record<string, string>>
}[] {
  return rows.map((row) => ({ key: 'slash.memoryRow', values: { key: row.key, value: row.value } }))
}

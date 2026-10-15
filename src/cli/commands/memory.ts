import type { Locale } from '@/core/types/locale'
import type { MemoryListOptions, MemoryScope } from '@/memory/api'
import { createCommand, createGroup, type Group } from '@/cli/command'
import { terminalErrorMessage, usage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { flagString, type ParsedArgs, parseIntFlagStrict } from '@/cli/parsing/args'
import { fail, hint, success } from '@/cli/ui/colors'
import { agentId, DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@/core/ids'
import { t } from '@/i18n'
import { MEMORY_SEARCH_LIMIT_MAX, resolveSearchLimit } from '@/memory/api'

const DEFAULT_SEARCH_LIMIT = 10
const AGENT_FLAG = {
  type: 'string',
  describe: { key: 'cliHelp.flagMemoryAgentScope' },
} as const

interface ScopeResolved {
  readonly kind: 'value'
  readonly scope: MemoryScope
}

interface ScopeError {
  readonly kind: 'error'
  readonly error: string
}

type ScopeResult = ScopeResolved | ScopeError

function resolveScope(args: ParsedArgs, locale: Locale): ScopeResult {
  const raw = flagString(args, 'agent')

  if (raw === undefined) {
    return { kind: 'value', scope: { agentId: DEFAULT_AGENT_ID, userId: LOCAL_USER_ID } }
  }

  try {
    return { kind: 'value', scope: { agentId: agentId(raw), userId: LOCAL_USER_ID } }
  } catch (err: unknown) {
    return { kind: 'error', error: terminalErrorMessage(err, locale) }
  }
}

const memoryStoreCommand = createCommand({
  name: 'store',
  summary: { key: 'cliHelp.memoryPutSummary' },
  spec: { positional: ['key', 'value'], flags: { agent: AGENT_FLAG } },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const key = flagString(args, 'key')
    const value = flagString(args, 'value')

    if (key === undefined || value === undefined) {
      return usage(app, t(locale, 'cli.memoryStoreUsage'))
    }

    const scope = resolveScope(args, locale)

    if (scope.kind === 'error') {
      return usage(app, `--agent: ${scope.error}`)
    }

    try {
      // The Memory interface rejects secret-looking values (and other invalid input) by throwing; that must surface as a usage error.
      await app.resolve('memory').store(scope.scope, key, { value })
    } catch (err: unknown) {
      app.err(fail(terminalErrorMessage(err, locale)))

      return 1
    }

    app.out(success(t(locale, 'cli.memoryStored', { key })))

    return 0
  },
})

const memoryRecallCommand = createCommand({
  name: 'recall',
  summary: { key: 'cliHelp.memoryGetSummary' },
  spec: { positional: ['key'], flags: { agent: AGENT_FLAG } },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const key = flagString(args, 'key')

    if (key === undefined) {
      return usage(app, t(locale, 'cli.memoryRecallUsage'))
    }

    const scope = resolveScope(args, locale)

    if (scope.kind === 'error') {
      return usage(app, `--agent: ${scope.error}`)
    }

    const entry = await app.resolve('memory').recall(scope.scope, key)

    if (entry === null) {
      app.out(hint(t(locale, 'cli.memoryNoEntry', { key })))

      return 1
    }

    app.out(entry.value)

    return 0
  },
})

const memorySearchCommand = createCommand({
  name: 'search',
  summary: { key: 'cliHelp.memorySearchSummary' },
  spec: {
    positional: ['query'],
    flags: {
      agent: AGENT_FLAG,
      limit: { type: 'string', describe: { key: 'cliHelp.flagMemoryLimit' } },
    },
  },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const query = flagString(args, 'query')

    if (query === undefined) {
      return usage(app, t(locale, 'cli.memorySearchUsage'))
    }

    const scope = resolveScope(args, locale)

    if (scope.kind === 'error') {
      return usage(app, `--agent: ${scope.error}`)
    }

    const limit = parseSearchLimit(flagString(args, 'limit'))

    if (limit === null) {
      return usage(app, t(locale, 'cli.memorySearchLimitError', { max: MEMORY_SEARCH_LIMIT_MAX }))
    }

    const hits = await app.resolve('memory').search(scope.scope, query, limit)

    if (hits.length === 0) {
      app.out(t(locale, 'cli.memoryNoMatches'))

      return 0
    }

    for (const hit of hits) {
      app.out(`${hit.key}\t${hit.value}`)
    }

    return 0
  },
})

const memoryListCommand = createCommand({
  name: 'list',
  summary: { key: 'cliHelp.memoryListSummary' },
  spec: {
    flags: {
      agent: AGENT_FLAG,
      prefix: { type: 'string', describe: { key: 'cliHelp.flagMemoryPrefix' } },
    },
  },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const scope = resolveScope(args, locale)

    if (scope.kind === 'error') {
      return usage(app, `--agent: ${scope.error}`)
    }

    const prefix = flagString(args, 'prefix')
    const listOptions: MemoryListOptions = {
      limit: MEMORY_SEARCH_LIMIT_MAX,
      ...(prefix === undefined ? {} : { prefix }),
    }
    const entries = await app.resolve('memory').list(scope.scope, listOptions)

    if (entries.length === 0) {
      app.out(t(locale, 'cli.memoryNoEntries'))

      return 0
    }

    for (const entry of entries) {
      app.out(`${entry.key}\t${entry.value}`)
    }

    return 0
  },
})

const memoryRemoveCommand = createCommand({
  name: 'remove',
  summary: { key: 'cliHelp.memoryRemoveSummary' },
  spec: { positional: ['key'], flags: { agent: AGENT_FLAG } },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const key = flagString(args, 'key')

    if (key === undefined) {
      return usage(app, t(locale, 'cli.memoryRemoveUsage'))
    }

    const scope = resolveScope(args, locale)

    if (scope.kind === 'error') {
      return usage(app, `--agent: ${scope.error}`)
    }

    const removed = await app.resolve('memory').remove(scope.scope, key)

    if (removed === 0) {
      app.err(fail(t(locale, 'cli.memoryNotFound', { key })))

      return 1
    }

    app.out(success(t(locale, 'cli.memoryRemoved', { key })))

    return 0
  },
})

export const memoryCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.memory,
  subcommands: [
    memoryStoreCommand,
    memoryRecallCommand,
    memorySearchCommand,
    memoryListCommand,
    memoryRemoveCommand,
  ],
})

// `undefined` means "use the default"; anything that is not a clean integer in [1, MAX] is a usage
// error the caller reports, never a silently-clamped value.
function parseSearchLimit(raw: string | undefined): number | null {
  if (raw === undefined) {
    return DEFAULT_SEARCH_LIMIT
  }
  const parsed = parseIntFlagStrict(raw, '--limit')

  if (parsed.kind !== 'value') {
    return null
  }
  return resolveSearchLimit(parsed.value)
}

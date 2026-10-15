import { realpathSync } from 'node:fs'
import { basename, dirname } from 'node:path'

import type { DestinationStream } from 'pino'

import type { ResolvedLog } from '@/core/config/resolve'
import { ConfigError } from '@/core/errors'
import { scrubCredentials } from '@/core/security/credentials'

import type { LogDestinationHooks } from './files'
import type { OwnedLogDestination } from './types'
import { openInitialSegment, preparePrivateParent, secureSegments } from './files'
import { inspectLogDestination } from './inspection'
import { AsyncLogWriter } from './writer'

// pino writes to fd 1 when handed no stream, and fd 1 is the JSON-RPC channel under `mcp serve`.
export const STDERR_LOG_STREAM: DestinationStream = {
  write: (record: string): void => {
    process.stderr.write(record)
  },
}

const BYTES_PER_MB = 1_048_576

export async function createOwnedLogDestination(
  options: ResolvedLog,
  hooks?: LogDestinationHooks
): Promise<OwnedLogDestination> {
  const file = options.file

  try {
    return await openDestination(file, options, hooks)
  } catch (err: unknown) {
    throw new ConfigError(`cannot open log destination: ${scrubCredentials(file)}`, err)
  }
}

async function openDestination(
  file: string,
  options: ResolvedLog,
  hooks: LogDestinationHooks | undefined
): Promise<OwnedLogDestination> {
  const parent = preparePrivateParent(dirname(file))
  const parentRealpath = realpathSync(parent)
  const base = basename(file)
  inspectLogDestination(file)
  const segments = secureSegments(parent, base)
  const initial = openInitialSegment(parent, base, segments)
  const maxBytes = options.maxFileMb * BYTES_PER_MB
  const writer = new AsyncLogWriter({
    parent,
    base,
    parentRealpath,
    maxBytes,
    maxRetained: options.maxFiles,
    initial,
    ...(hooks === undefined ? {} : { hooks }),
  })

  try {
    await writer.prune()

    if (initial.size >= maxBytes) {
      await writer.rotate()
    }

    return writer.destination()
  } catch (err: unknown) {
    writer.forceClose()
    throw err
  }
}

import { rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import type { LocalizedText } from '@/cli/types'
import type { CliCommandDef } from '@/core/types/cli-command'
import { type Command, createCommand } from '@/cli/command'

const CACHE_FILE_NAME = 'cli-commands.json'
const NAME_RE = /^[a-z][a-z0-9]*$/
const SUMMARY_KEY_RE = /^cliHelp\.[A-Za-z][A-Za-z0-9]*$/
// A stub swallows every positional rather than declaring a grammar it cannot know: rejecting an
// argument the real command accepts would make the cache an authority over admission.
const STUB_REST = 'args'

interface CachedCommand {
  readonly name: string
  readonly summaryKey: string
}

/** Display data for pre-boot help, never an admission authority: a missing name still reaches the
 *  booted root through the preflight defer path, and a stale one fails there with the normal
 *  unknown-command error. One boot of staleness is the contract. */
export async function readCommandCacheStubs(dataDir: string): Promise<readonly Command[]> {
  const entries = await readEntries(join(dataDir, CACHE_FILE_NAME))

  return entries.map(toStub)
}

/** Best-effort: the caller logs a failure and continues, since a missing cache only costs
 *  discoverability. */
export async function writeCommandCache(
  dataDir: string,
  defs: readonly CliCommandDef[]
): Promise<void> {
  const path = join(dataDir, CACHE_FILE_NAME)
  const temp = `${path}.${process.pid}.tmp`
  const entries: readonly CachedCommand[] = defs.map((def) => ({
    name: def.name,
    summaryKey: def.summary.key,
  }))

  try {
    await Bun.write(temp, `${JSON.stringify(entries, null, 2)}\n`)
    await rename(temp, path)
  } catch (err: unknown) {
    await unlink(temp).catch(() => undefined)
    throw err
  }
}

async function readEntries(path: string): Promise<readonly CachedCommand[]> {
  const file = Bun.file(path)

  if (!(await file.exists())) {
    return []
  }

  try {
    const parsed: unknown = await file.json()

    return Array.isArray(parsed) ? parsed.filter(isCachedCommand) : []
  } catch {
    // A corrupt cache costs discoverability only; the next boot rewrites it.
    return []
  }
}

function isCachedCommand(value: unknown): value is CachedCommand {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const entry: { readonly name?: unknown; readonly summaryKey?: unknown } = value

  return (
    typeof entry.name === 'string' &&
    NAME_RE.test(entry.name) &&
    typeof entry.summaryKey === 'string' &&
    SUMMARY_KEY_RE.test(entry.summaryKey)
  )
}

function toStub(entry: CachedCommand): Command {
  // why-safe: isCachedCommand validated the key shape, and `t` renders the raw key if a catalog
  // ever drops it.
  const summary: LocalizedText = { key: entry.summaryKey as LocalizedText['key'] }

  return createCommand({
    name: entry.name,
    summary,
    spec: { positionalRest: STUB_REST },
    // Only help rendering reaches a stub: any other path needs boot, and the booted root is built
    // from the live registry.
    run: () => 0,
  })
}

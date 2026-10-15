import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import type { UnrecordedSpend, UnrecordedSpendLoad, UnrecordedSpendLog } from '@/engine/types/cost'
import { isErrno } from '@/core/errors'
import { llmAttemptId } from '@/core/ids'
import { PRIVATE_FILE_MODE, replacePrivateFileAtomic } from '@/core/security/private-files'
import { monthBoundsInZone } from '@/core/utils/time'

const LOG_FILE = 'unrecorded-spend.jsonl'

const ENTRY = z.object({
  id: z.string().min(1).transform(llmAttemptId),
  costUsd: z.number().finite().nonnegative(),
  settledAt: z.number().int().nonnegative(),
})

interface ReadLog {
  readonly entries: readonly UnrecordedSpend[]
  readonly corrupt: readonly string[]
}

// A file, not a table: this holds spend the attempt store itself refused. Entries live until the
// monthly cap window rolls over — exactly as long as a cap can still be affected by them — so every
// restart inside that window charges the same money again. That window is the configured zone's; a
// UTC boundary would delete spend the zoned cap is still counting.
export function createUnrecordedSpendLog(dataDir: string, timeZone: string): UnrecordedSpendLog {
  const path = join(dataDir, LOG_FILE)

  return {
    append: (entry) => appendDurably(path, entry),
    async load(now: number): Promise<UnrecordedSpendLoad> {
      const log = await readLog(path)
      const month = monthBoundsInZone(now, timeZone)
      const entries = log.entries.filter(
        (entry) => entry.settledAt >= month.fromMs && entry.settledAt < month.toMs
      )

      // Temp-and-rename, not truncate-in-place: a crash mid-prune would otherwise erase the only
      // record of spend the attempt store already refused, handing that money back to the caps.
      if (entries.length !== log.entries.length) {
        await replacePrivateFileAtomic({
          path,
          content: serialize(entries) + log.corrupt.join(''),
        })
      }

      return { entries, damaged: log.corrupt.length > 0, path }
    },
  }
}

// fsync before returning: the caller has already paid the provider, and an entry still sitting in
// the page cache when the machine dies is exactly the spend this log exists to survive.
async function appendDurably(path: string, entry: UnrecordedSpend): Promise<void> {
  const handle = await open(path, 'a', PRIVATE_FILE_MODE)

  try {
    await handle.writeFile(serialize([entry]), 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

// A crash mid-append can truncate the last line into an unreadable amount. Unreadable lines are
// kept — including across a prune rewrite — because dropping one would erase the only evidence that
// paid spend is missing, and the caps would silently come back a boot later.
async function readLog(path: string): Promise<ReadLog> {
  const text = await readFile(path, 'utf8').catch((err: unknown) => {
    if (isErrno(err, 'ENOENT')) {
      return ''
    }

    throw err
  })
  const entries: UnrecordedSpend[] = []
  const corrupt: string[] = []

  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue
    }

    const parsed = parseEntry(line)

    if (parsed === undefined) {
      corrupt.push(`${line}\n`)
      continue
    }

    entries.push(parsed)
  }

  return { entries, corrupt }
}

function parseEntry(line: string): UnrecordedSpend | undefined {
  let json: unknown

  try {
    json = JSON.parse(line)
  } catch {
    return undefined
  }

  const result = ENTRY.safeParse(json)

  return result.success ? result.data : undefined
}

function serialize(entries: readonly UnrecordedSpend[]): string {
  return entries.map((entry) => `${JSON.stringify(entry)}\n`).join('')
}

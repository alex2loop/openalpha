import type { ResolvedMemory } from '@/core/config/resolve'
import type {
  Memory,
  MemoryEntry,
  MemoryImportance,
  MemoryListOptions,
  MemoryScope,
  MemoryWrite,
} from '@/core/types/memory'
import type { Dialect, FtsSearch, Storage } from '@/core/types/storage'
import { ValidationError } from '@/core/errors'
import { isMemoryKey } from '@/core/memory-key'
import { rejectIfSecret } from '@/core/security/credentials'
import { hasBlockingThreat, scanOutput } from '@/core/security/sanitize'
import { MS_PER_DAY } from '@/core/utils/time'

const IMPORTANCE_VALUES = Object.freeze({
  observation: 0,
  decision: 5,
} satisfies Readonly<Record<MemoryImportance, number>>)
// A LIMIT of 0 returns every row (a memory-scan amplification) and a negative one is a silent
// no-op on both dialects — neither is ever wanted. The FTS layer repeats this same bound.
export const MEMORY_SEARCH_LIMIT_MAX = 100
// LF, CR, and tab are intentionally allowed so multi-line values and indented content can be
// stored; only the truly dangerous control/plane characters are rejected before I/O.
// biome-ignore lint/suspicious/noControlCharactersInRegex: explicit C0/C1 control-plane ranges per remediation plan
const DISALLOWED_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u

interface EntryRow {
  readonly key: string
  readonly value: string
  readonly updated_at: number
}

interface StoreMemoryInput {
  readonly db: Storage
  readonly sql: string
  readonly limits: ResolvedMemory
  readonly scope: MemoryScope
  readonly key: string
  readonly entry: MemoryWrite
}

interface RemoveMemoryInput {
  readonly db: Storage
  readonly sql: string
  readonly scope: MemoryScope
  readonly key: string
}

interface RecallInput {
  readonly db: Storage
  readonly sql: string
  readonly scope: MemoryScope
  readonly key: string
}

async function recallMemory(input: RecallInput): Promise<MemoryEntry | null> {
  const { db, scope } = input
  const now = Date.now()
  const rows = await db.query<EntryRow>(input.sql, [
    now,
    scope.agentId,
    scope.userId,
    now,
    input.key,
  ])

  return rows[0] ? toEntry(rows[0]) : null
}

interface ListInput {
  readonly db: Storage
  readonly sql: ReturnType<typeof buildSql>
  readonly scope: MemoryScope
  readonly options: MemoryListOptions
}

async function listMemories(input: ListInput): Promise<readonly MemoryEntry[]> {
  const { db, sql, scope, options } = input
  const bounded = resolveSearchLimit(options.limit)

  if (bounded === null) {
    throw new ValidationError(
      `memory list limit must be a safe integer from 1 to ${MEMORY_SEARCH_LIMIT_MAX}`
    )
  }

  const base = [scope.agentId, scope.userId, Date.now()]
  const rows = options.prefix
    ? await db.query<EntryRow>(sql.listPrefixed, [
        ...base,
        options.prefix.length,
        options.prefix,
        bounded,
      ])
    : await db.query<EntryRow>(sql.list, [...base, bounded])

  return rows.map(toEntry)
}

export function createMemory(
  db: Storage,
  dialect: Dialect,
  options: { readonly limits: ResolvedMemory; readonly fts: FtsSearch }
): Memory {
  const { limits, fts } = options
  const sql = buildSql(dialect)

  return {
    async store(scope: MemoryScope, key: string, entry: MemoryWrite): Promise<void> {
      await storeMemory({ db, sql: sql.store, limits, scope, key, entry })
    },

    recall: (scope, key) => recallMemory({ db, sql: sql.recall, scope, key }),

    list: (scope, listOptions) => listMemories({ db, sql, scope, options: listOptions }),

    remove: (scope, key) => removeMemory({ db, sql: sql.remove, scope, key }),

    // biome-ignore lint/complexity/useMaxParams: this is the public Memory interface contract.
    async search(scope: MemoryScope, query: string, limit: number, keyPrefix?: string) {
      const bounded = resolveSearchLimit(limit)

      if (bounded === null) {
        throw new ValidationError(
          `memory search limit must be a safe integer from 1 to ${MEMORY_SEARCH_LIMIT_MAX}`
        )
      }

      return fts.search(
        {
          agentId: scope.agentId,
          userId: scope.userId,
          ...(keyPrefix === undefined ? {} : { keyPrefix }),
        },
        query,
        bounded
      )
    },
  }
}

async function removeMemory(input: RemoveMemoryInput): Promise<number> {
  const rows = await input.db.query<{ readonly key: string }>(input.sql, [
    Date.now(),
    input.scope.agentId,
    input.scope.userId,
    input.key,
  ])

  return rows.length
}

async function storeMemory(input: StoreMemoryInput): Promise<void> {
  const value = input.entry.value
  const importance = input.entry.importance ?? 'observation'

  assertKey(input.key)
  assertStorable(value)
  assertWithinLimit(value, input.limits.maxValueBytes)
  // Key and value both round-trip back into a prompt, so both are scanned for secrets and injection
  // before any durable I/O. Secrets and injection are both hard rejections at this boundary.
  rejectIfSecret(input.key)
  rejectIfSecret(value)
  assertNoPromptInjection(input.key, value)

  const now = Date.now()
  const expiresAt = importance === 'decision' ? null : now + input.limits.ttlDays * MS_PER_DAY

  await input.db.execute(
    input.sql,
    storeParams({
      scope: input.scope,
      key: input.key,
      value,
      importance: IMPORTANCE_VALUES[importance],
      expiresAt,
      now,
    })
  )
}

// The store UPSERT binds nine columns; the array is built once here so the interface method stays small.
function storeParams(input: {
  readonly scope: MemoryScope
  readonly key: string
  readonly value: string
  readonly importance: number
  readonly expiresAt: number | null
  readonly now: number
}): readonly unknown[] {
  return [
    input.scope.agentId,
    input.scope.userId,
    input.key,
    input.value,
    input.importance,
    input.expiresAt,
    input.now,
    input.now,
    input.now,
  ]
}

// Every read filters on BOTH scope columns; one alone leaks another user's memory into this scope.
function buildSql(d: Dialect) {
  const scoped = `agent_id = ${d.param(1)} AND user_id = ${d.param(2)}`
  const live = `deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ${d.param(3)})`

  return {
    // Hand-written rather than dialect.upsert: created_at survives an update, version increments,
    // and deleted_at resets so a store() on a soft-deleted key resurrects it.
    store:
      `INSERT INTO memory_kv ` +
      `(agent_id, user_id, key, value, importance, expires_at, created_at, updated_at, last_accessed_at) ` +
      `VALUES (${d.paramList(9)}) ` +
      `ON CONFLICT (agent_id, user_id, key) DO UPDATE SET ` +
      `value = excluded.value, importance = excluded.importance, ` +
      `expires_at = excluded.expires_at, updated_at = excluded.updated_at, ` +
      `last_accessed_at = excluded.last_accessed_at, ` +
      `version = memory_kv.version + 1, deleted_at = NULL`,
    // A single statement advances last_accessed_at and returns the row; RETURNING is supported by
    // both sqlite and postgres, so a missing/expired/deleted key resolves to null without a second
    // query.
    recall:
      `UPDATE memory_kv SET last_accessed_at = ${d.param(1)} ` +
      `WHERE agent_id = ${d.param(2)} AND user_id = ${d.param(3)} AND deleted_at IS NULL ` +
      `AND (expires_at IS NULL OR expires_at > ${d.param(4)}) AND key = ${d.param(5)} ` +
      `RETURNING key, value, updated_at`,
    list: `SELECT key, value, updated_at FROM memory_kv WHERE ${scoped} AND ${live} ORDER BY key LIMIT ${d.param(4)}`,
    // substr equality is a literal prefix match — no LIKE wildcard or ESCAPE concerns.
    listPrefixed:
      `SELECT key, value, updated_at FROM memory_kv WHERE ${scoped} AND ${live} ` +
      `AND substr(key, 1, ${d.param(4)}) = ${d.param(5)} ORDER BY key LIMIT ${d.param(6)}`,
    remove:
      `UPDATE memory_kv SET deleted_at = ${d.param(1)} ` +
      `WHERE agent_id = ${d.param(2)} AND user_id = ${d.param(3)} AND key = ${d.param(4)} ` +
      `AND deleted_at IS NULL RETURNING key`,
  }
}

// A disallowed control byte (including NUL) can silently truncate or corrupt a sqlite TEXT column and
// can hide injection delimiters, so reject any such character before DB I/O. LF, CR, and tab are
// deliberately permitted so indented or multi-line values survive the round-trip.
function assertStorable(text: string): void {
  if (DISALLOWED_CONTROL_RE.test(text)) {
    throw new ValidationError('memory value contains a disallowed control character')
  }
}

// Keys are addressed by exact string in SQL and interpolated into prompts, so constrain them to a
// safe charset and bound before any round-trip.
function assertKey(key: string): void {
  if (!isMemoryKey(key)) {
    throw new ValidationError('memory key is invalid')
  }
}

// Bound the stored value: an unbounded write per key is a growth leak. Byte length, not char
// count, because the column is sized in bytes and multi-byte text would exceed a char-based cap.
function assertWithinLimit(value: string, maxValueBytes: number): void {
  const bytes = Buffer.byteLength(value, 'utf8')

  if (bytes > maxValueBytes) {
    throw new ValidationError(
      `memory value is ${bytes} bytes, over the ${maxValueBytes}-byte limit`
    )
  }
}

// Only the block tier refuses a write. The notice tier is heuristic — it fires on ordinary prose
// like a person's name or a mention of a config file — and rejecting on it loses real facts.
function assertNoPromptInjection(key: string, value: string): void {
  if (hasBlockingThreat(scanOutput(key)) || hasBlockingThreat(scanOutput(value))) {
    throw new ValidationError('memory contains prompt injection')
  }
}

function toEntry(row: EntryRow): MemoryEntry {
  return { key: row.key, value: row.value, updatedAt: row.updated_at }
}

// Shared by the Memory interface and the CLI: returns the clamped limit, or null when it falls outside
// [1, MEMORY_SEARCH_LIMIT_MAX] (non-integer, zero, negative, or over the cap).
export function resolveSearchLimit(limit: number): number | null {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MEMORY_SEARCH_LIMIT_MAX) {
    return null
  }

  return limit
}

import type { LLMAttemptId, RunId, SessionId } from '@/core/ids'
import type { LLMMessage, ProviderAttemptOutcome, SessionMessageWrite } from '@/core/llm'
import type { CommandExchange } from '@/core/types/command'
import type { Storage, Transaction } from '@/core/types/storage'
import type { LLMAttemptRow } from '@/persistence/stores/llm-attempt'
import type { SessionSql } from '@/persistence/stores/session/sql'
import type { HistoryPage, HistoryPageQuery, SessionSnapshot } from '@/persistence/types'
import { ConflictError, StorageError } from '@/core/errors'
import { isShownMessage } from '@/core/utils/message'
import { withRetry } from '@/core/utils/retry'
import { toLlmAttempt } from '@/persistence/stores/llm-attempt'
import {
  type MessagePayloadRow,
  type SessionRow,
  type StoredMessageRow,
  type TotalsRow,
  type TranscriptRow,
  toMessage,
  toSessionDetails,
  toStoredMessage,
  toTotals,
  toTranscriptMessage,
} from '@/persistence/stores/session/mapping'

const APPEND_MAX_ATTEMPTS = 3
// The conflicting winner has already committed by the time the PK error arrives — retry at once.
const APPEND_RETRY_INITIAL_MS = 0

type AssistantWrite = Extract<
  SessionMessageWrite,
  { readonly message: { readonly role: 'assistant' } }
>

/** What the insert needs from either writer: the row's run, when one owns it, the message, and
 *  whether only the reader sees it. */
interface TailWrite {
  readonly runId: RunId | null
  readonly message: LLMMessage
  readonly displayOnly?: true
}

export interface StoreDeps {
  readonly db: Storage
  readonly sql: SessionSql
}

export async function loadSessionHistory(
  store: StoreDeps,
  id: SessionId,
  limit?: number
): Promise<readonly LLMMessage[]> {
  const rows =
    limit === undefined
      ? await store.db.query<MessagePayloadRow>(store.sql.loadPayloads, [id])
      : await store.db.query<MessagePayloadRow>(store.sql.loadPayloadTail, [id, limit])
  return rows.map(toMessage)
}

export async function loadSessionHistoryPage(
  store: StoreDeps,
  id: SessionId,
  query: HistoryPageQuery
): Promise<HistoryPage> {
  const rows = await readTranscriptRows(store, id, query)
  const { limit } = query
  const hasMore = rows.length > limit
  const page = rows.slice(0, isSplitExchange(rows, limit) ? limit - 1 : limit).reverse()

  return {
    messages: page.map(toTranscriptMessage),
    hasMore,
    nextBefore: hasMore ? (page[0]?.idx ?? null) : null,
  }
}

// An answer whose question falls past the page waits for the older page, so a line and the answer
// to it always land together.
function isSplitExchange(rows: readonly TranscriptRow[], limit: number): boolean {
  return limit > 1 && rows[limit - 1]?.role === 'assistant' && rows[limit]?.role === 'user'
}

// One row past the page tells whether older ones remain.
function readTranscriptRows(
  store: StoreDeps,
  id: SessionId,
  query: HistoryPageQuery
): Promise<readonly TranscriptRow[]> {
  const { before, limit, runId } = query

  if (runId !== undefined) {
    return store.db.query<TranscriptRow>(store.sql.loadTranscriptRun, [id, runId, limit + 1])
  }

  return before === undefined
    ? store.db.query<TranscriptRow>(store.sql.loadTranscriptNewest, [id, limit + 1])
    : store.db.query<TranscriptRow>(store.sql.loadTranscriptBefore, [id, before, limit + 1])
}

export async function loadSessionDetails(
  store: StoreDeps,
  id: SessionId
): Promise<SessionSnapshot | null> {
  const sessions = await store.db.query<SessionRow>(store.sql.loadSession, [id])
  const session = sessions[0]

  if (session === undefined) {
    return null
  }

  const [messages, attempts, totals] = await Promise.all([
    store.db.query<StoredMessageRow>(store.sql.loadMessages, [id]),
    store.db.query<LLMAttemptRow>(store.sql.loadAttempts, [id]),
    store.db.query<TotalsRow>(store.sql.loadTotals, [id]),
  ])

  return {
    session: toSessionDetails(session),
    messages: messages.map(toStoredMessage),
    attempts: attempts.map(toLlmAttempt),
    totals: toTotals(totals[0]),
  }
}

export async function appendSessionMessages(
  store: StoreDeps,
  id: SessionId,
  writes: readonly SessionMessageWrite[]
): Promise<void> {
  if (writes.length === 0) {
    return
  }

  const now = Date.now()

  await withAppendRetry(() =>
    store.db.transaction(async (tx) => {
      await assertHolder({ tx, sql: store.sql, id, writes })

      const base = await insertTail({ tx, sql: store.sql, id, writes, now })

      await linkAttemptGroups({ tx, sql: store.sql, sessionId: id, writes, base })
      await tx.execute(store.sql.touchActivity, [now, id])
    })
  )
}

/** A slash command's own exchange. No agent turn produced it: the rows name the command's run
 *  when it ran as one, no attempt group is linked, and the holder check does not apply — a command
 *  may record while a run holds the session. */
export async function appendCommandExchange(
  store: StoreDeps,
  id: SessionId,
  exchange: CommandExchange
): Promise<void> {
  const now = Date.now()
  const runId = exchange.runId ?? null
  const shared: Omit<TailWrite, 'message'> =
    exchange.displayOnly === true ? { runId, displayOnly: true } : { runId }
  const writes: readonly TailWrite[] = [
    { ...shared, message: { role: 'user', content: exchange.invocation } },
    { ...shared, message: { role: 'assistant', content: exchange.output } },
  ]

  await withAppendRetry(() =>
    store.db.transaction(async (tx) => {
      await insertTail({ tx, sql: store.sql, id, writes, now })
      await tx.execute(store.sql.touchActivity, [now, id])
    })
  )
}

interface AssertHolderInput {
  readonly tx: Transaction
  readonly sql: SessionSql
  readonly id: SessionId
  readonly writes: readonly SessionMessageWrite[]
}

// Every write in one flush carries the run's own id; the row must still name that run. A run
// whose lease expired and was reclaimed learns it here, before it can append a stale turn.
async function assertHolder(input: AssertHolderInput): Promise<void> {
  const runId = input.writes[0]?.runId

  if (runId === undefined) {
    return
  }

  const rows = await input.tx.query<{ readonly active_run_id: string | null }>(
    input.sql.selectOwner,
    [input.id]
  )

  if (rows[0]?.active_run_id !== runId) {
    throw new ConflictError(`session ${input.id} is not held by run ${runId}`)
  }
}

async function linkAttemptGroups(input: {
  readonly tx: Transaction
  readonly sql: SessionSql
  readonly sessionId: SessionId
  readonly writes: readonly SessionMessageWrite[]
  readonly base: number
}): Promise<void> {
  const { tx, sql, writes, base } = input

  for (const [offset, write] of writes.entries()) {
    if (!isAssistantWrite(write)) {
      continue
    }

    assertUniqueAttemptIds(write.llmAttemptIds)
    const target = { sessionId: input.sessionId, messageIdx: base + offset }

    for (const attemptId of write.llmAttemptIds) {
      const { changes } = await tx.execute(sql.linkAttempt, [
        target.messageIdx,
        attemptId,
        input.sessionId,
      ])

      if (changes !== 1) {
        throw new StorageError(`llm_attempt ${attemptId} is not a linkable turn attempt`)
      }
    }

    await assertOneSuccess(tx, sql, target)
  }
}

async function assertOneSuccess(
  tx: Transaction,
  sql: SessionSql,
  target: { readonly sessionId: SessionId; readonly messageIdx: number }
): Promise<void> {
  const rows = await tx.query<{ readonly outcome: ProviderAttemptOutcome }>(sql.linkedGroup, [
    target.sessionId,
    target.messageIdx,
  ])

  if (rows.filter((row) => row.outcome === 'success').length !== 1) {
    throw new StorageError(
      `assistant attempt group for message ${target.messageIdx} must contain exactly one success`
    )
  }
}

function isAssistantWrite(write: SessionMessageWrite): write is AssistantWrite {
  return write.message.role === 'assistant'
}

function assertUniqueAttemptIds(ids: readonly LLMAttemptId[]): void {
  if (new Set(ids).size !== ids.length) {
    throw new StorageError('duplicate llm attempt id in one assistant write')
  }
}

interface TailInsert {
  readonly tx: Transaction
  readonly sql: SessionSql
  readonly id: SessionId
  readonly writes: readonly TailWrite[]
  readonly now: number
}

/** Appends at the session's current tail and returns the first index written, which the attempt
 *  linker needs to address each row it just inserted. A row the conversation page shows dates the
 *  session in its list. */
async function insertTail(input: TailInsert): Promise<number> {
  const { tx, sql, id, writes, now } = input
  const rows = await tx.query<{ readonly next: number | null }>(sql.nextIdx, [id])
  const base = rows[0]?.next ?? 0

  for (const [offset, write] of writes.entries()) {
    await tx.execute(sql.insertMessage, toMessageParams(id, write, { idx: base + offset, now }))
  }

  if (writes.some((write) => isShownMessage(write.message))) {
    await tx.execute(sql.touchLastMessage, [now, id])
  }

  return base
}

function withAppendRetry(run: () => Promise<void>): Promise<void> {
  return withRetry(run, {
    maxAttempts: APPEND_MAX_ATTEMPTS,
    initialMs: APPEND_RETRY_INITIAL_MS,
    isRetryable: isUniqueViolation,
  })
}

function toMessageParams(
  id: SessionId,
  write: TailWrite,
  at: { readonly idx: number; readonly now: number }
): readonly unknown[] {
  const { message } = write

  return [
    id,
    at.idx,
    write.runId,
    message.role,
    JSON.stringify(message.content),
    message.toolCallId ?? null,
    message.reasoningBlocks ? JSON.stringify(message.reasoningBlocks) : null,
    message.isError === true ? 1 : 0,
    write.displayOnly === true ? 1 : 0,
    at.now,
  ]
}

// Two appends racing one session can read the same MAX(idx); the PK makes the loser retryable.
function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof StorageError)) {
    return false
  }

  const cause = err.cause

  if (cause === null || typeof cause !== 'object' || !('code' in cause)) {
    return false
  }

  const code = cause.code

  return (
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === '23505'
  )
}

import type { ChannelId } from '@/core/channels'
import type { AgentId, JobId, UserId } from '@/core/ids'
import type {
  EventRow,
  StoredEventFire,
  StoredEventMatch,
  StoredJobEvent,
} from '@/persistence/stores/scheduler/job/event'
import { channelId } from '@/core/channels'
import { StorageError } from '@/core/errors'
import { agentId, jobId, userId } from '@/core/ids'
import { toJobEvent } from '@/persistence/stores/scheduler/job/event'

const ENABLED = 1

type StoredJobSchedule =
  | { readonly kind: 'cron'; readonly expr: string; readonly timezone: string }
  | { readonly kind: 'interval'; readonly everyMs: number }
  | { readonly kind: 'once'; readonly at: number }

interface StoredJobTarget {
  readonly channel: ChannelId
  readonly chatId: string
}

export interface StoredJobOwner {
  readonly userId: UserId
  readonly channel: ChannelId
  readonly chatId: string
}

export interface StoredJob {
  readonly id: JobId
  readonly agentId: AgentId
  readonly prompt: string
  readonly allowedTools?: readonly string[]
  readonly schedule: StoredJobSchedule
  readonly target?: StoredJobTarget
  readonly enabled: boolean
  readonly nextRunAt: number
  readonly consecutiveFailures: number
  readonly owner?: StoredJobOwner
  readonly event?: StoredJobEvent
}

export interface StoredJobStore {
  due(nowMs: number, limit: number, runNowClaimStaleBeforeMs: number): Promise<readonly StoredJob[]>
  advance(id: JobId, nextRunAt: number): Promise<void>
  disable(id: JobId): Promise<void>
  deferRetry(id: JobId, failures: number, nextRunAt: number): Promise<void>
  create(job: StoredJob): Promise<boolean>
  put(job: StoredJob): Promise<void>
  list(): Promise<readonly StoredJob[]>
  listEnabledOfAgent(agentId: string): Promise<readonly StoredJob[]>
  find(id: JobId): Promise<StoredJob | undefined>
  findByPrefix(prefix: string, limit: number): Promise<readonly StoredJob[]>
  remove(id: JobId): Promise<void>
  pause(id: JobId): Promise<boolean>
  resume(id: JobId, nextRunAt: number): Promise<boolean>
  listOwned(owner: StoredJobOwner): Promise<readonly StoredJob[]>
  findOwned(owner: StoredJobOwner, id: JobId): Promise<StoredJob | undefined>
  findOwnedByPrefix(
    owner: StoredJobOwner,
    prefix: string,
    limit: number
  ): Promise<readonly StoredJob[]>
  pauseOwned(owner: StoredJobOwner, id: JobId): Promise<boolean>
  resumeOwned(owner: StoredJobOwner, id: JobId, nextRunAt: number): Promise<boolean>
  claimRunNow(id: JobId, token: string, claimedAtMs: number): Promise<StoredJob | undefined>
  releaseRunNowClaim(id: JobId, token: string): Promise<void>
  claimRunNowOwned(
    owner: StoredJobOwner,
    id: JobId,
    token: string,
    claimedAtMs: number
  ): Promise<StoredJob | undefined>
  releaseRunNowClaimOwned(owner: StoredJobOwner, id: JobId, token: string): Promise<void>
  matchEvent(match: StoredEventMatch): Promise<readonly StoredJob[]>
  claimEventFire(fire: StoredEventFire): Promise<boolean>
  clearRunNowClaims(claimedBeforeMs: number): Promise<void>
}

export interface JobRow extends EventRow {
  readonly id: string
  readonly agent_id: string
  readonly prompt: string
  readonly allowed_tools: string | null
  readonly schedule_kind: string
  readonly cron_expr: string | null
  readonly cron_tz: string | null
  readonly every_ms: number | null
  readonly run_at: number | null
  readonly next_run_at: number
  readonly target_channel: string | null
  readonly target_chat_id: string | null
  readonly enabled: number
  readonly consecutive_failures: number
  readonly user_id: string | null
  readonly channel: string | null
  readonly chat_id: string | null
}

export function toJob(row: JobRow): StoredJob {
  try {
    return toStoredJob(row)
  } catch (err: unknown) {
    if (err instanceof StorageError) {
      throw err
    }

    throw new StorageError('invalid persisted job')
  }
}

export function toJobParams(job: StoredJob, now: number): readonly unknown[] {
  const { schedule } = job
  const timezone = schedule.kind === 'cron' ? canonicalTimeZone(schedule.timezone) : null

  return [
    job.id,
    job.agentId,
    job.prompt,
    job.allowedTools !== undefined && job.allowedTools.length > 0
      ? JSON.stringify(job.allowedTools)
      : null,
    schedule.kind,
    schedule.kind === 'cron' ? schedule.expr : null,
    timezone,
    schedule.kind === 'interval' ? schedule.everyMs : null,
    schedule.kind === 'once' ? schedule.at : null,
    job.nextRunAt,
    job.target?.channel ?? null,
    job.target?.chatId ?? null,
    job.enabled ? ENABLED : 0,
    job.consecutiveFailures,
    job.owner?.userId ?? null,
    job.owner?.channel ?? null,
    job.owner?.chatId ?? null,
    now,
  ]
}

export function ownerParams(owner: StoredJobOwner): readonly unknown[] {
  return [owner.userId, owner.channel, owner.chatId]
}

function toStoredJob(row: JobRow): StoredJob {
  const job: {
    id: JobId
    agentId: AgentId
    prompt: string
    allowedTools?: readonly string[]
    schedule: StoredJobSchedule
    target?: StoredJobTarget
    enabled: boolean
    nextRunAt: number
    consecutiveFailures: number
    owner?: StoredJobOwner
    event?: StoredJobEvent
  } = {
    id: jobId(row.id),
    agentId: agentId(row.agent_id),
    prompt: row.prompt,
    schedule: toSchedule(row),
    enabled: row.enabled === ENABLED,
    nextRunAt: row.next_run_at,
    consecutiveFailures: row.consecutive_failures,
  }

  if (row.target_channel !== null && row.target_chat_id !== null) {
    job.target = { channel: channelId(row.target_channel), chatId: row.target_chat_id }
  }

  if (row.allowed_tools !== null) {
    const parsed: unknown = JSON.parse(row.allowed_tools)

    if (Array.isArray(parsed) && parsed.every((item): item is string => typeof item === 'string')) {
      job.allowedTools = parsed
    }
  }

  const owner = toOwner(row)

  if (owner !== undefined) {
    job.owner = owner
  }

  const event = toJobEvent(row)

  if (event !== undefined) {
    job.event = event
  }

  return job
}

function toSchedule(row: JobRow): StoredJobSchedule {
  if (
    row.schedule_kind === 'cron' &&
    row.cron_expr !== null &&
    row.cron_tz !== null &&
    row.every_ms === null &&
    row.run_at === null
  ) {
    return { kind: 'cron', expr: row.cron_expr, timezone: canonicalTimeZone(row.cron_tz) }
  }

  if (
    row.schedule_kind === 'interval' &&
    row.cron_expr === null &&
    row.cron_tz === null &&
    row.every_ms !== null &&
    row.run_at === null
  ) {
    return { kind: 'interval', everyMs: row.every_ms }
  }

  if (
    row.schedule_kind === 'once' &&
    row.cron_expr === null &&
    row.cron_tz === null &&
    row.every_ms === null &&
    row.run_at !== null
  ) {
    return { kind: 'once', at: row.run_at }
  }

  throw new StorageError('invalid persisted job schedule')
}

function toOwner(row: JobRow): StoredJobOwner | undefined {
  if (row.user_id === null && row.channel === null && row.chat_id === null) {
    return undefined
  }

  if (row.user_id === null || row.channel === null || row.chat_id === null) {
    throw new StorageError('invalid persisted job owner')
  }

  return { userId: userId(row.user_id), channel: channelId(row.channel), chatId: row.chat_id }
}

function canonicalTimeZone(timezone: string): string {
  try {
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions()
      .timeZone

    if (canonical !== timezone) {
      throw new StorageError('invalid persisted job schedule')
    }

    return canonical
  } catch (err: unknown) {
    if (err instanceof StorageError) {
      throw err
    }

    throw new StorageError('invalid persisted job schedule')
  }
}

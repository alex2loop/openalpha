import type { DestinationStream, Logger as PinoLogger } from 'pino'
import pino from 'pino'

import type { ResolvedLog } from '@/core/config/resolve'
import type { AgentId } from '@/core/ids'
import { ConfigError } from '@/core/errors'
import { isPathId, agentId as toAgentId } from '@/core/ids'
import { prepareAgentLogFile } from '@/core/security/agent-directories'
import {
  formatErrForLog,
  isSensitiveKey,
  REDACT_FIELD_PATHS,
  scrubCredentials,
} from '@/core/security/credentials'

import type { AgentLogRouter, AgentLogSink } from './agent-router'
import type { LogDestinationHooks } from './files'
import type { OwnedLogDestination } from './types'
import { AGENT_LOG_DROP_POLICY, createAgentLogRouter } from './agent-router'
import { currentCorrelation } from './correlation'
import { createOwnedLogDestination, STDERR_LOG_STREAM } from './destination'

const LOG_SCRUB_MAX_DEPTH = 8
const LOGGER_SHUTDOWN_MS = 2_000

// scrubLogValue has already turned every Error into a formatErrForLog payload, so pino's stock err
// serializer would only overwrite our `type` with the literal 'Object' and graft an empty `stack`.
const PASS_THROUGH_ERR_SERIALIZER = { err: (value: unknown) => value }

const REDACT_CONFIG = {
  paths: [...REDACT_FIELD_PATHS],
  censor: (value: unknown, path: string[]) => {
    const lastKey = path[path.length - 1]

    if (lastKey && isSensitiveKey(lastKey)) {
      return '***'
    }
    if (typeof value === 'string') {
      return scrubCredentials(value)
    }
    return value
  },
}

/** Scopes a synchronous pino write so the agent-log router can read the active agentId directly,
 *  instead of re-parsing every serialized record to recover it. */
type WithAgentId = <T>(id: AgentId | undefined, fn: () => T) => T

/** Carried down a `wrap()` `.child()` chain as one unit — `withAgentId` is fixed per logger
 *  instance, `currentAgentId` accumulates with each child's own binding. */
interface AgentLogScope {
  readonly withAgentId: WithAgentId
  readonly currentAgentId?: AgentId
}

const ROOT_AGENT_SCOPE: AgentLogScope = { withAgentId: (_id, fn) => fn() }

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
  fatal(msg: string, fields?: Record<string, unknown>): void
  debug(msg: string, fields?: Record<string, unknown>): void
  child(bindings: Record<string, unknown>): Logger
}

export interface LoggerResource {
  readonly logger: Logger
  configureAgentRegistry(agentIds: Iterable<string>): Promise<void>
  /** Routes for agents a live reload added; an agent that already has one keeps it open. */
  addAgentRoutes(agentIds: Iterable<AgentId>): Promise<void>
  isAvailable(): boolean
  flush(): Promise<void>
  close(): Promise<void>
}

interface LoggerResourceHooks {
  readonly createLogger?: (stream?: DestinationStream) => PinoLogger
  readonly destination?: LogDestinationHooks
  readonly flush?: () => Promise<void>
  readonly end?: () => Promise<void>
}

interface AgentLogRoutingOptions {
  readonly dataDir: string
}

interface LifecyclePlan {
  readonly logger?: PinoLogger
  readonly destination: OwnedLogDestination | undefined
  readonly flushHook: (() => Promise<void>) | undefined
  readonly endHook?: () => Promise<void>
  readonly closeDestination?: boolean
  readonly onTerminal: () => void
  readonly onComplete?: () => void
}

export const silentLogger: Logger = {
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op
  info() {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op
  warn() {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op
  error() {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op
  fatal() {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op
  debug() {},
  child(): Logger {
    return this
  },
}

export async function createLoggerResource(
  options: ResolvedLog,
  hooks?: LoggerResourceHooks,
  agentLogs?: AgentLogRoutingOptions
): Promise<LoggerResource> {
  let destination: OwnedLogDestination | undefined

  try {
    destination = await createOwnedLogDestination(options, hooks?.destination)
    const router =
      agentLogs === undefined
        ? undefined
        : createAgentLogRouter(destination, (agentId) =>
            openAgentSink(options, agentLogs.dataDir, agentId)
          )
    const stream = router?.destination.stream ?? destination?.stream ?? STDERR_LOG_STREAM
    const root =
      hooks?.createLogger?.(stream) ??
      pino(
        { level: options.level, redact: REDACT_CONFIG, serializers: PASS_THROUGH_ERR_SERIALIZER },
        stream
      )
    const resource = loggerResource({
      logger: root,
      destination: router?.destination ?? destination,
      hooks,
      ...(router === undefined ? {} : { agentRouting: router }),
    })

    router?.setDropWarning(() =>
      resource.logger.warn('logging.agent_record_dropped', {
        ...AGENT_LOG_DROP_POLICY,
      })
    )

    return resource
  } catch (err: unknown) {
    destination?.stopWrites()

    try {
      await destination?.close()
    } catch {
      // Construction failure remains the primary error; cleanup is best-effort.
    }

    if (err instanceof ConfigError) {
      throw err
    }

    throw new ConfigError('cannot construct logger', err)
  }
}

// A sink that receives already-serialized records has no pino of its own: it omits `logger` and
// gets the destination lifecycle alone.
function loggerResource(options: {
  readonly logger?: PinoLogger
  readonly destination: OwnedLogDestination | undefined
  readonly hooks: LoggerResourceHooks | undefined
  readonly agentRouting?: Pick<AgentLogRouter, 'configure' | 'addAgentRoutes' | 'withAgentId'>
}): LoggerResource {
  const { logger, destination, hooks } = options
  const planLogger = logger === undefined ? {} : { logger }
  let terminal = false
  let accepting = true
  let closePromise: Promise<void> | undefined
  const closeTerminal = (): void => {
    if (terminal) {
      return
    }

    terminal = true
    accepting = false
    destination?.stopWrites()
    destination?.forceClose()
  }
  const isAvailable = (): boolean => accepting && !terminal && (destination?.isAvailable() ?? true)

  const agentScope = options.agentRouting

  return {
    logger: logger === undefined ? silentLogger : wrap(logger, isAvailable, agentScope),
    configureAgentRegistry: options.agentRouting?.configure ?? (async () => undefined),
    addAgentRoutes: options.agentRouting?.addAgentRoutes ?? (async () => undefined),
    isAvailable,
    flush: () =>
      runLifecycle({
        ...planLogger,
        destination,
        flushHook: hooks?.flush,
        onTerminal: closeTerminal,
      }),
    close: () => {
      if (closePromise === undefined) {
        accepting = false
        destination?.stopWrites()
        closePromise = runLifecycle({
          ...planLogger,
          destination,
          flushHook: hooks?.flush,
          ...(hooks?.end === undefined ? {} : { endHook: hooks.end }),
          closeDestination: true,
          onTerminal: closeTerminal,
          onComplete: closeTerminal,
        })
      }

      return closePromise
    },
  }
}

async function openAgentSink(
  options: ResolvedLog,
  dataDir: string,
  agentId: AgentId
): Promise<AgentLogSink> {
  const file = await prepareAgentLogFile(dataDir, agentId)
  const destination = await createOwnedLogDestination({ ...options, file })
  const resource = loggerResource({ destination, hooks: undefined })

  return {
    write: (record) => destination.stream.write(record),
    flush: resource.flush,
    close: resource.close,
    forceClose: destination.forceClose,
  }
}

function flushPino(logger: PinoLogger): Promise<void> {
  return new Promise((resolve) => {
    try {
      logger.flush(() => resolve())
    } catch {
      resolve()
    }
  })
}

async function runLifecycle(plan: LifecyclePlan): Promise<void> {
  const deadline = performance.now() + LOGGER_SHUTDOWN_MS
  const phases = lifecyclePhases(plan)

  try {
    for (const phase of phases) {
      if (!(await runPhase(deadline, phase, plan.onTerminal))) {
        return
      }
    }
  } catch {
    plan.onTerminal()
  } finally {
    plan.onComplete?.()
  }
}

function lifecyclePhases(plan: LifecyclePlan): readonly ((() => Promise<void>) | undefined)[] {
  const { destination, logger } = plan
  const pinoFlush = logger === undefined ? undefined : () => flushPino(logger)
  const destinationFlush = destination === undefined ? undefined : () => destination.flush()
  const destinationClose =
    plan.closeDestination === true && destination !== undefined
      ? () => destination.close()
      : undefined

  return [pinoFlush, destinationFlush, plan.flushHook, plan.endHook, destinationClose]
}

function runPhase(
  deadline: number,
  phase: (() => Promise<void>) | undefined,
  closeTerminal: () => void
): Promise<boolean> {
  if (phase === undefined) {
    const inTime = performance.now() < deadline

    if (!inTime) {
      closeTerminal()
    }

    return Promise.resolve(inTime)
  }

  const remainingMs = deadline - performance.now()

  if (remainingMs <= 0) {
    closeTerminal()
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (completed: boolean): void => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      const inTime = completed && performance.now() < deadline

      if (!inTime) {
        closeTerminal()
      }

      resolve(inTime)
    }
    const timer = setTimeout(() => finish(false), remainingMs)
    timer.unref()

    let pending: Promise<void>

    try {
      pending = phase()
    } catch {
      finish(false)
      return
    }

    pending.then(
      () => finish(true),
      () => finish(false)
    )
  })
}

type LogLevelMethod = 'info' | 'warn' | 'error' | 'fatal' | 'debug'

// `currentAgentId` accumulates down a `.child()` chain (a deeper binding overrides a shallower
// one, mirroring pino's own field-merge order) so the router can read it via `withAgentId`
// instead of re-parsing the record `.child()` eventually serializes.
function wrap(
  p: PinoLogger,
  isAvailable: () => boolean,
  scope: AgentLogScope = ROOT_AGENT_SCOPE
): Logger {
  const { withAgentId, currentAgentId } = scope
  const emit =
    (level: LogLevelMethod) =>
    (msg: string, fields?: Record<string, unknown>): void => {
      writeIfAvailable(isAvailable, () =>
        withAgentId(currentAgentId, () =>
          p[level](stampCorrelation(scrubLogFields(fields)), scrubCredentials(msg))
        )
      )
    }

  return {
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    fatal: emit('fatal'),
    debug: emit('debug'),
    child: (bindings) => {
      const scrubbed = scrubLogFields(bindings)
      const currentId = extractAgentId(scrubbed) ?? currentAgentId
      const nextScope: AgentLogScope = {
        withAgentId,
        ...(currentId === undefined ? {} : { currentAgentId: currentId }),
      }

      return wrap(p.child(scrubbed), isAvailable, nextScope)
    },
  }
}

/** An explicit field wins: a caller naming its own correlation is describing work the ambient scope
 *  does not own. */
function stampCorrelation(fields: Record<string, unknown>): Record<string, unknown> {
  const id = currentCorrelation()

  return id === undefined || fields.correlationId !== undefined
    ? fields
    : { ...fields, correlationId: id }
}

function extractAgentId(bindings: Record<string, unknown>): AgentId | undefined {
  const raw = bindings.agentId

  return typeof raw === 'string' && isPathId(raw) ? toAgentId(raw) : undefined
}

function writeIfAvailable(isAvailable: () => boolean, write: () => void): void {
  if (isAvailable()) {
    write()
  }
}

function scrubLogFields(fields?: Record<string, unknown>): Record<string, unknown> {
  if (fields === undefined) {
    return {}
  }

  const scrubbed = scrubLogValue(fields, new WeakSet(), 0)
  return isLogRecord(scrubbed) ? scrubbed : {}
}

function scrubLogValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === 'string') {
    return scrubCredentials(value)
  }

  if (value instanceof Error) {
    return scrubLogValue(formatErrForLog(value), seen, depth)
  }

  if (depth >= LOG_SCRUB_MAX_DEPTH) {
    return '[Truncated]'
  }

  if (typeof value !== 'object' || value === null) {
    return value
  }

  if (seen.has(value)) {
    return '[Circular]'
  }

  if (!(Array.isArray(value) || isLogRecord(value))) {
    return '[Unsupported]'
  }

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => scrubLogValue(item, seen, depth + 1))
    }

    const entries: [string, unknown][] = []
    for (const [key, item] of Object.entries(value)) {
      entries.push([key, isSensitiveKey(key) ? '[REDACTED]' : scrubLogValue(item, seen, depth + 1)])
    }

    return Object.fromEntries(entries)
  } finally {
    seen.delete(value)
  }
}

function isLogRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

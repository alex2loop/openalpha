import { randomUUID } from 'node:crypto'
import { mkdtemp, open, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import type { Booted } from '@/app/types'
import type { ServiceProvider } from '@/core/container'
import { boot, passThroughBootGate } from '@/app/boot'
import { LOCAL_CHANNEL_ID } from '@/core/channels'
import { loadConfig } from '@/core/config/load'
import { expandHome } from '@/core/config/resolve'
import { DEFAULT_AGENT_ID, LOCAL_USER_ID, sessionId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { DEFAULT_MAX_TOKENS } from '@/core/stream-events'
import { toToolSchema } from '@/core/tool'
import { createBudget } from '@/engine/api'

import type {
  EvaluatedRecord,
  EvaluateOneInput,
  Manifest,
  ManifestInput,
  WriteRunOutputInput,
} from './model'
import {
  DIRECT_INSTRUCTION,
  loadRoutingTaskSet,
  MODES,
  OUTPUT_SCHEMA_VERSION,
  RoutingEvalError,
  stableHash,
} from './model'
import {
  citationUrls,
  createObservation,
  observeEvent,
  pairInvariantHash,
  selectedRoutingMode,
  streamTotals,
} from './records'

export async function runCommand(options: ReadonlyMap<string, string>): Promise<void> {
  const outputPath = requiredPath(options, 'output')
  const configPath = options.get('config')
  const loadedConfig = await loadConfig(
    configPath === undefined ? undefined : { configPath: resolve(expandHome(configPath)) }
  )
  assertEphemeralStorage(loadedConfig.raw.storage)
  const { taskSet, raw } = await loadRoutingTaskSet()
  const directSessions = new Set<string>()
  const shutdown = new AbortController()
  const abort = (): void => shutdown.abort()
  let tempDir: string | undefined
  let booted: Booted | undefined

  try {
    tempDir = await mkdtemp(join(tmpdir(), 'routing-eval-'))
    // The log destination requires real directory components; macOS TMPDIR is a symlink chain.
    const dataDir = await realpath(tempDir)

    process.once('SIGINT', abort)
    process.once('SIGTERM', abort)
    process.stderr.write(
      `LIVE routing evaluation: ${taskSet.cases.length * MODES.length} runs -> ${outputPath}\n`
    )
    booted = await boot({
      mode: 'cli',
      env: process.env,
      configPath: loadedConfig.configPath,
      dataDir,
      logLevel: 'error',
      shutdownSignal: shutdown.signal,
      features: [directPromptProvider(directSessions)],
      bootGate: passThroughBootGate,
      err: (line) => process.stderr.write(`${line}\n`),
    })
    await writeRunOutput({
      app: booted.app,
      taskSet,
      raw,
      outputPath,
      directSessions,
      signal: shutdown.signal,
    })
  } finally {
    process.removeListener('SIGINT', abort)
    process.removeListener('SIGTERM', abort)
    await cleanupRun(booted, tempDir)
  }
}

async function cleanupRun(booted: Booted | undefined, dataDir: string | undefined): Promise<void> {
  const removeDataDir =
    dataDir === undefined ? Promise.resolve() : rm(dataDir, { recursive: true, force: true })
  const results = await Promise.allSettled([booted?.dispose() ?? Promise.resolve(), removeDataDir])

  for (const result of results) {
    if (result.status === 'rejected') {
      reportCleanupFailure(result.reason)
    }
  }
}

function reportCleanupFailure(error: unknown): void {
  try {
    process.stderr.write(`routing evaluation cleanup failed: ${formatErrForLog(error).message}\n`)
  } catch {
    // Cleanup diagnostics must not mask the original evaluation failure.
  }
}

async function writeRunOutput(input: WriteRunOutputInput): Promise<void> {
  const { app, taskSet, raw, outputPath, directSessions, signal } = input
  const agent = app.resolve('agents').get(DEFAULT_AGENT_ID)
  if (agent === undefined) {
    throw new RoutingEvalError('profile_missing', 'chat profile is unavailable')
  }
  if (taskSet.runProfile.maxTokens !== DEFAULT_MAX_TOKENS) {
    throw new RoutingEvalError('token_cap', 'task-set maxTokens does not match the engine cap')
  }

  const manifest = createManifest({ app, taskSet, raw, agent })
  const handle = await open(outputPath, 'wx')

  try {
    await handle.write(`${JSON.stringify(manifest)}\n`)
    for (const evalCase of taskSet.cases) {
      for (const mode of MODES) {
        if (signal.aborted) {
          throw new RoutingEvalError('aborted', 'evaluation aborted')
        }
        process.stderr.write(`${evalCase.id} ${mode}\n`)
        const record = await evaluateOne({
          runner: app.resolve('runner'),
          evalCase,
          mode,
          profile: taskSet.runProfile,
          agent,
          manifest,
          directSessions,
        })
        await handle.write(`${JSON.stringify(record)}\n`)
      }
    }
  } finally {
    await handle.close()
  }
}

export async function evaluateOne(input: EvaluateOneInput): Promise<EvaluatedRecord> {
  const { runner, evalCase, mode, profile, agent, manifest, directSessions } = input
  const freshSession = sessionId(randomUUID())
  const direct = mode === 'direct_baseline'
  if (direct) {
    directSessions.add(freshSession)
  }
  const observation = createObservation()
  const started = performance.now()

  try {
    const result = await runner.run(
      {
        agentId: DEFAULT_AGENT_ID,
        sessionId: freshSession,
        userId: LOCAL_USER_ID,
        channel: LOCAL_CHANNEL_ID,
        userMessage: evalCase.prompt,
        onChunk: (event) => observeEvent(observation, event),
      },
      {
        approvalMode: 'unavailable',
        billingSessionId: null,
        budgetSlice: createBudget(profile.maxCostUsd),
        maxDurationMs: profile.maxDurationMs,
        maxTurns: profile.maxTurns,
        persistence: 'ephemeral',
      }
    )
    const systemPrompt = effectiveSystemPrompt(agent.systemPrompt, direct)
    const selectedTools = [...observation.selectedTools]

    return {
      recordType: 'routing_eval',
      schemaVersion: OUTPUT_SCHEMA_VERSION,
      manifestId: manifest.manifestId,
      caseId: evalCase.id,
      family: evalCase.family,
      mode,
      expectedMode: evalCase.expectedMode,
      selectedMode: selectedRoutingMode(selectedTools),
      answer: result.text,
      selectedTools,
      toolCalls: observation.toolCalls,
      totals: result.totals,
      elapsedMs: performance.now() - started,
      modelLatencyMs: observation.modelLatencyMs,
      streamTotals: streamTotals(observation),
      citationUrls: citationUrls(observation.text),
      reason: result.reason,
      pairInvariantHash: pairInvariantHash({ evalCase, profile, agent, manifest }),
      systemPromptHash: stableHash(systemPrompt),
    }
  } finally {
    directSessions.delete(freshSession)
  }
}

export function createManifest(input: ManifestInput): Manifest {
  const { app, taskSet, raw, agent } = input
  const roster = [...app.resolve('agents').values()]
    .map((entry) => ({
      id: entry.id,
      description: entry.description ?? '',
      delegates: [...entry.delegates],
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const schemas = [...app.resolve('tools').values()]
    .map(toToolSchema)
    .sort((left, right) => left.name.localeCompare(right.name))
  const modelSelector =
    app.config.models.find(
      (entry) =>
        entry.provider === agent.preferredProviderModel?.provider &&
        entry.model === agent.preferredProviderModel.model
    )?.selector ?? agent.model
  const base: Omit<Manifest, 'manifestId'> = {
    recordType: 'manifest',
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    taskSetVersion: taskSet.version,
    createdAt: Date.now(),
    modelSelector,
    caseCount: taskSet.cases.length,
    runProfile: taskSet.runProfile,
    hashes: {
      routingPrompt: stableHash(agent.systemPrompt),
      rosterDescriptions: stableHash(roster),
      toolSchemas: stableHash(schemas),
      budgetProfile: stableHash(taskSet.runProfile),
      taskSetData: stableHash(raw),
      rubric: stableHash(taskSet.cases.map((entry) => [entry.id, entry.rubric])),
      directInstruction: stableHash(DIRECT_INSTRUCTION),
    },
  }

  return { ...base, manifestId: stableHash(base) }
}

function directPromptProvider(directSessions: ReadonlySet<string>): ServiceProvider {
  return {
    name: 'routing-evaluation',
    register(_bind, extend): void {
      extend('agentForRun', (current) => (input, fallback) => {
        const selected = current(input, fallback)
        if (!directSessions.has(input.sessionId)) {
          return selected
        }
        return { ...selected, systemPrompt: effectiveSystemPrompt(selected.systemPrompt, true) }
      })
    },
  }
}

export function effectiveSystemPrompt(base: string, direct: boolean): string {
  return direct ? `${base}\n\n${DIRECT_INSTRUCTION}` : base
}

export function requiredPath(options: ReadonlyMap<string, string>, name: string): string {
  const value = options.get(name)
  if (value === undefined || value.trim() === '') {
    throw new RoutingEvalError('explicit_output', `--${name} is required`)
  }
  return resolve(expandHome(value))
}

function assertEphemeralStorage(
  storage: { engine: 'sqlite'; path?: string | undefined } | { engine: 'postgres' } | undefined
): void {
  if (storage === undefined) {
    return
  }
  if (storage.engine === 'postgres') {
    throw new RoutingEvalError('live_storage', 'routing evaluation refuses PostgreSQL storage')
  }
  if (storage.path !== undefined && isAbsolute(expandHome(storage.path))) {
    throw new RoutingEvalError(
      'live_storage',
      'routing evaluation requires default or relative SQLite storage'
    )
  }
}

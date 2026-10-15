#!/usr/bin/env bun
// Vendors a pruned models.dev price snapshot (MIT-licensed) into the repo so pricing never depends
// on a second runtime fetch (OpenRouter's B.1 payload is the only live feed). Re-run on demand to
// refresh. The full upstream api.json is ~3.4 MB; this keeps only the providers this codebase's
// catalog can actually be configured with, so the committed snapshot stays small.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { PROVIDERS } from '@/ai/catalog'

const MODELSDEV_URL = 'https://models.dev/api.json'
const FETCH_TIMEOUT_MS = 30_000
const SNAPSHOT_PATH = resolve(
  import.meta.dir,
  '../src/ai/cost/modelsdev-snapshot.json'
)

const ModelsDevModelSchema = z.object({
  id: z.string(),
  cost: z
    .object({
      input: z.number().optional(),
      output: z.number().optional(),
      cache_read: z.number().optional(),
      cache_write: z.number().optional(),
    })
    .optional(),
})

const ModelsDevProviderSchema = z.object({
  models: z.record(z.string(), z.unknown()).optional(),
})

const ModelsDevPayloadSchema = z.record(z.string(), z.unknown())

interface SnapshotRow {
  readonly id: string
  readonly cost: {
    readonly input: number
    readonly output: number
    readonly cache_read?: number
    readonly cache_write?: number
  }
}

async function main(): Promise<void> {
  const payload = await fetchPayload()
  const registryIds = new Set(PROVIDERS.map((provider) => provider.id))
  const rows = pruneToSnapshot(payload, registryIds)

  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(rows, null, 2)}\n`)
  console.log(`wrote ${rows.length} model price rows -> ${SNAPSHOT_PATH}`)
}

async function fetchPayload(): Promise<Record<string, unknown>> {
  const response = await fetch(MODELSDEV_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })

  if (!response.ok) {
    throw new Error(`models.dev fetch failed: status ${response.status}`)
  }

  return ModelsDevPayloadSchema.parse(await response.json())
}

// Exact provider-id match against the catalog registry (no aliasing — e.g. catalog's `gemini` vs
// models.dev's `google` are deliberately left unmatched). Providers walked in sorted-id order and
// first-occurrence-wins on a duplicate model id, so a re-vendor is byte-for-byte reproducible.
function pruneToSnapshot(
  payload: Record<string, unknown>,
  registryIds: ReadonlySet<string>
): readonly SnapshotRow[] {
  const seen = new Map<string, SnapshotRow>()

  for (const providerId of Object.keys(payload).sort()) {
    if (!registryIds.has(providerId)) {
      continue
    }

    collectProviderModels(payload[providerId], seen)
  }

  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function collectProviderModels(raw: unknown, seen: Map<string, SnapshotRow>): void {
  const provider = ModelsDevProviderSchema.safeParse(raw)

  if (!provider.success) {
    return
  }

  for (const rawModel of Object.values(provider.data.models ?? {})) {
    const model = ModelsDevModelSchema.safeParse(rawModel)

    if (!model.success || seen.has(model.data.id)) {
      continue
    }

    const row = toSnapshotRow(model.data)

    if (row !== undefined) {
      seen.set(row.id, row)
    }
  }
}

function toSnapshotRow(model: z.infer<typeof ModelsDevModelSchema>): SnapshotRow | undefined {
  if (model.cost?.input === undefined || model.cost.output === undefined) {
    return undefined
  }

  return {
    id: model.id,
    cost: {
      input: model.cost.input,
      output: model.cost.output,
      ...(model.cost.cache_read !== undefined ? { cache_read: model.cost.cache_read } : {}),
      ...(model.cost.cache_write !== undefined ? { cache_write: model.cost.cache_write } : {}),
    },
  }
}

await main()

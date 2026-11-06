import { createScopedValue } from '@/core/scoped-value'

/** Which MCP job a model call belongs to, without threading the id through the pipeline. */
const storage = createScopedValue<string>()

export function withClientModelJob<T>(jobId: string, fn: () => T): T {
  return storage.run(jobId, fn)
}

export function currentClientModelJob(): string | undefined {
  return storage.get()
}

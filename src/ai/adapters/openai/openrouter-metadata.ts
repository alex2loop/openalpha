import type { Logger } from '@/core/logging/logger'
import { isPlainRecord } from '@/core/utils/collections'

export function logOpenRouterMetadata(logger: Logger, value: unknown): boolean {
  const metadata = toOpenRouterMetadata(value)

  if (metadata === undefined) {
    return false
  }

  logger.debug('openrouter.routing_metadata', metadata)
  return true
}

function toOpenRouterMetadata(value: unknown): Record<string, string | number> | undefined {
  if (!isPlainRecord(value)) {
    return undefined
  }

  const fields: Record<string, string | number> = {}
  const requested = value.requested
  const strategy = value.strategy
  const attempt = value.attempt

  if (typeof requested === 'string') {
    fields.requested = requested
  }
  if (typeof strategy === 'string') {
    fields.strategy = strategy
  }
  if (typeof attempt === 'number' && Number.isSafeInteger(attempt) && attempt >= 0) {
    fields.attempt = attempt
  }

  addSelectedEndpoint(fields, value.endpoints)
  return Object.keys(fields).length === 0 ? undefined : fields
}

function addSelectedEndpoint(fields: Record<string, string | number>, value: unknown): void {
  if (!(isPlainRecord(value) && Array.isArray(value.available))) {
    return
  }

  for (const endpoint of value.available) {
    if (!isPlainRecord(endpoint) || endpoint.selected !== true) {
      continue
    }

    if (typeof endpoint.provider === 'string') {
      fields.selectedProvider = endpoint.provider
    }
    if (typeof endpoint.model === 'string') {
      fields.selectedModel = endpoint.model
    }
    return
  }
}

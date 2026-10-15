import type { ProviderRouting } from '@/core/llm'

/** OpenRouter's `provider` request object. Only the keys the entry set travel: an unset
 *  `allow_fallbacks` keeps the router's default. */
export function toWireProviderRouting(routing: ProviderRouting): Record<string, unknown> {
  return {
    ...(routing.sort === undefined ? {} : { sort: routing.sort }),
    ...(routing.only === undefined ? {} : { only: routing.only }),
    ...(routing.order === undefined ? {} : { order: routing.order }),
    ...(routing.allowFallbacks === undefined ? {} : { allow_fallbacks: routing.allowFallbacks }),
  }
}

export function isOpenRouterHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).host
    return host === 'openrouter.ai' || host.endsWith('.openrouter.ai')
  } catch {
    return false
  }
}

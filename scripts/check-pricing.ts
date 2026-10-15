#!/usr/bin/env bun
// Dynamic LLM pricing gate (Part C). No network: these checks call `createPricing` directly (never
// `createConfiguredPricing`, which is the only thing that warms the live OpenRouter cache), and
// `toModelPrice`/`modelsdevPriceOf` are pure/vendored. Guards the precedence chain (override ->
// OpenRouter -> models.dev -> fallback), the two feed parsers, the loopback privacy gate, and that
// a provider-reported cost bypasses the estimate entirely.
import { modelsdevPriceOf } from '@/ai/cost/modelsdev-prices'
import { toModelPrice } from '@/ai/cost/openrouter-prices'
import { createPricing, FALLBACK_PRICE } from '@/ai/cost/pricing'
import { createCostTracker } from '@/engine/budget/cost-tracker'

let failures = 0

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`ok   ${name}`)
    return
  }

  failures++
  console.error(`FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

const overridePricing = createPricing(
  new Map([['anthropic/claude-sonnet-4-6', { inPerM: 1, outPerM: 2 }]])
)
const overrideResolution = overridePricing.priceOf({
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
})

check(
  'override wins over feeds',
  overrideResolution.source === 'override' &&
    overrideResolution.price.inPerM === 1 &&
    overrideResolution.price.outPerM === 2,
  JSON.stringify(overrideResolution)
)

const openRouterPrice = toModelPrice({
  id: 'fixture/model',
  pricing: {
    prompt: '0.000002',
    completion: '0.000006',
    input_cache_read: '0.00000025',
  },
})

check(
  'OpenRouter fixture parses per-token strings x1e6 plus cache rates',
  openRouterPrice?.inPerM === 2 &&
    openRouterPrice.outPerM === 6 &&
    openRouterPrice.cacheReadPerM === 0.25 &&
    openRouterPrice.cacheWritePerM === undefined,
  JSON.stringify(openRouterPrice)
)

const modelsdevPrice = modelsdevPriceOf('claude-fable-5')

check(
  'models.dev row maps 1:1 against the committed snapshot (per-million, no conversion)',
  modelsdevPrice?.inPerM === 10 &&
    modelsdevPrice.outPerM === 50 &&
    modelsdevPrice.cacheReadPerM === 1 &&
    modelsdevPrice.cacheWritePerM === 12.5,
  JSON.stringify(modelsdevPrice)
)

const unknownPricing = createPricing(new Map())
const unknownResolution = unknownPricing.priceOf({
  provider: 'anthropic',
  model: 'totally-unknown-model-xyz',
})

check(
  'an unknown model falls back to FALLBACK_PRICE with source "fallback"',
  unknownResolution.source === 'fallback' &&
    unknownResolution.price.inPerM === FALLBACK_PRICE.inPerM &&
    unknownResolution.price.outPerM === FALLBACK_PRICE.outPerM,
  JSON.stringify(unknownResolution)
)

const loopbackPricing = createPricing(new Map(), new Set(['local-fixture']))
const loopbackResolution = loopbackPricing.priceOf({
  provider: 'local-fixture',
  // Real model the committed snapshot prices — proves the gate suppresses the lookup rather
  // than missing it by coincidence.
  model: 'claude-fable-5',
})

check(
  'a loopback-flagged provider skips both feeds and bills nothing (source "local", price 0)',
  loopbackResolution.source === 'local' &&
    loopbackResolution.price.inPerM === 0 &&
    loopbackResolution.price.outPerM === 0,
  JSON.stringify(loopbackResolution)
)

const tracker = createCostTracker({
  pricing: createPricing(new Map()),
  maxDailyUsd: 0,
  maxMonthlyUsd: 0,
})
const providerReportedCharge = tracker.record(
  { provider: 'openrouter', model: 'claude-sonnet-4-6' },
  { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, costUsd: 0.0123 },
  Date.now()
)

check(
  'usage.costUsd present marks the charge provider_reported and is used verbatim',
  providerReportedCharge.costSource === 'provider_reported' && providerReportedCharge.costUsd === 0.0123,
  JSON.stringify(providerReportedCharge)
)

if (failures > 0) {
  console.error(`\npricing: ${failures} failure(s)`)
  process.exit(1)
}

console.log('\npricing: PASS')

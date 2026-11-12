import { type ReadonlySignal, useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { ModelEntryWire } from '@/app/server/wire/models'
import type { LoadState } from '@/web/ui/kit/use-load'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { formatAmount, formatUsd } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'

type ModelPrices = ReadonlyMap<string, ModelEntryWire>

/** What the app prices `provider`'s `models` at, read again when either changes and aborted when
 *  they change again or the row goes. An empty list asks nothing. */
function useModelPrices(
  provider: string,
  models: readonly string[]
): ReadonlySignal<LoadState<ModelPrices>> {
  const result = useSignal<LoadState<ModelPrices>>({ status: 'loading' })
  const names = JSON.stringify(models)

  useEffect(() => {
    result.value = { status: 'loading' }

    if (provider === '' || models.length === 0) {
      return
    }

    const controller = new AbortController()

    getJson(ROUTES.modelPrices, {
      query: { provider, models: names },
      signal: controller.signal,
    }).then(
      (answer) => {
        result.value = {
          status: 'ready',
          value: new Map(answer.models.map((entry) => [entry.model, entry])),
        }
      },
      (error: unknown) => {
        // Anything but an `ApiFailure` is this effect's own abort.
        if (error instanceof ApiFailure) {
          result.value = { status: 'failed', failure: error }
        }
      }
    )

    return () => controller.abort()
  }, [provider, names])

  return result
}

/** The price of each model a list offers, as one line under its name; a model the lookup has not
 *  answered for yet has none. */
export function useOptionHints(
  provider: string,
  options: readonly string[]
): (option: string) => string | undefined {
  const prices = useModelPrices(provider, options).value

  return (option) => {
    const entry = prices.status === 'ready' ? prices.value.get(option) : undefined

    return entry === undefined ? undefined : joinInline([priceText(entry), ...toolsParts(entry)])
  }
}

/** What the chosen model costs and whether it can call tools: under its row, so the price is read
 *  before the model is picked. A line that has not answered yet shows nothing. */
export function ModelPriceLine({
  provider,
  model,
}: {
  readonly provider: string
  readonly model: string
}) {
  const name = model.trim()
  const prices = useModelPrices(provider, name === '' ? [] : [name]).value

  if (prices.status === 'failed') {
    return <p class="meta model-price">{tr('ui.office.settings.modelPriceFailed')}</p>
  }

  const entry = prices.status === 'ready' ? prices.value.get(name) : undefined

  if (entry === undefined) {
    return null
  }

  return (
    <p class="meta model-price">
      {joinInline([
        isPriced(entry) ? priceText(entry) : unknownPriceText(entry),
        ...toolsParts(entry),
        ...(entry.perRunUsd === undefined
          ? []
          : [tr('ui.office.form.modelCost', { cost: formatUsd(entry.perRunUsd) })]),
      ])}
    </p>
  )
}

// A model nothing lists is counted at the highest rate, which is a stand-in and not its price.
function isPriced({ price }: ModelEntryWire): boolean {
  return price.source !== 'fallback'
}

function priceText(entry: ModelEntryWire): string {
  const { inPerM, outPerM } = entry.price

  if (!isPriced(entry)) {
    return tr('ui.office.settings.modelPriceUnknown')
  }

  if (inPerM === 0 && outPerM === 0) {
    return tr('ui.office.settings.modelPriceFree')
  }

  return tr('ui.office.settings.modelPrice', {
    input: formatAmount(inPerM),
    output: formatAmount(outPerM),
  })
}

function unknownPriceText({ price }: ModelEntryWire): string {
  return tr('ui.office.settings.modelPriceUnknownCounted', {
    input: formatAmount(price.inPerM),
    output: formatAmount(price.outPerM),
  })
}

// A model nothing prices is not known either, so what it can call would be a guess.
function toolsParts(entry: ModelEntryWire): readonly string[] {
  if (!isPriced(entry)) {
    return []
  }

  return [
    tr(entry.supportsTools ? 'ui.office.settings.modelTools' : 'ui.office.settings.modelNoTools'),
  ]
}

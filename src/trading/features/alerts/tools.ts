import { z } from 'zod'

import type { ToolDefinition } from '@/core/tool'
import type { Locale } from '@/core/types/locale'
import type { AlertService } from '@/trading/features/alerts/types'
import type { MarketSchema } from '@/trading/kernel/surface/surface'
import { createTool } from '@/core/tool'
import { ALERT_CONDITIONS } from '@/trading/kernel/operator/alert'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import {
  alertIdInput,
  instrumentQueryInput,
  PRICE_INPUT_UNITS,
  priceConfirmedInput,
  toTypedPrice,
} from '@/trading/kernel/surface/surface'
import { invocationAddress, isManagedMutation } from '@/trading/kernel/surface/tool-approval'
import { joinToolDetail, renderMarketName, renderToolAction } from '@/trading/render/tool-detail'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

const alertLimit = z
  .int()
  .positive()
  .max(SURFACE_LIMITS.maximumAlertItems)
  .optional()
  .describe(`Alerts to list, up to ${SURFACE_LIMITS.maximumAlertItems}.`)

export function createAlertManageTool(alerts: AlertService, markets: MarketSchema): ToolDefinition {
  return createTool({
    name: 'alert_manage',
    description:
      'List, create, or disable price alerts. Listing spans every alert this operator has, in every state and every chat; a new one is always delivered to the chat it was created from.',
    inputSchema: alertActionInputOf(markets),
    inputExamples: [
      { action: 'list' },
      { action: 'create', ticker: 'FPT', condition: 'below', threshold: 120000 },
    ],
    capability: 'read',
    requiresApproval: isManagedMutation,
    presentation: { label: 'Alerts', emoji: '🔔', detail: alertDetail },
    async execute(args, ctx): Promise<string> {
      if (args.action === 'list') {
        const page = await alerts.list({
          limit: args.limit ?? SURFACE_LIMITS.maximumAlertItems,
          signal: ctx.signal,
        })

        return toAgentJson(page)
      }

      if (args.action === 'disable') {
        const result = await alerts.disable({
          alertId: args.alertId,
          now: Date.now(),
          signal: ctx.signal,
        })

        return toAgentJson({ action: 'disable', result })
      }

      // `create` resolves where the alert can be delivered and refuses an address nothing serves.
      const alert = await alerts.create({
        draft: {
          instrument: {
            ticker: args.ticker,
            ...(args.market === undefined ? {} : { market: args.market }),
          },
          condition: args.condition,
          threshold: args.threshold,
          delivery: invocationAddress(ctx),
        },
        typedPrice: toTypedPrice(args.priceConfirmed),
        now: Date.now(),
        signal: ctx.signal,
      })

      return toAgentJson(alert)
    },
  })
}

type AlertManageInput = z.infer<ReturnType<typeof alertActionInputOf>>

// The arm is what separates a read from a mutation, and the approval prompt renders this same
// line: without it, creating an alert and disabling one both read as a listing.
function alertDetail(input: AlertManageInput, locale: Locale): string | undefined {
  const action = renderToolAction(locale, input.action)

  if (input.action === 'create') {
    return joinToolDetail([
      action,
      input.ticker,
      input.market === undefined ? undefined : renderMarketName(locale, input.market),
    ])
  }

  return input.action === 'disable' ? joinToolDetail([action, input.alertId]) : action
}

function alertActionInputOf(markets: MarketSchema) {
  return z.discriminatedUnion('action', [
    z.strictObject({
      action: z.literal('list').describe('List every alert this operator has.'),
      limit: alertLimit,
    }),
    z.strictObject({
      action: z.literal('create').describe('Create one alert delivered to this chat.'),
      ...instrumentQueryInput(markets),
      condition: z
        .enum(ALERT_CONDITIONS)
        .describe(
          'above fires when the price rises to or past the threshold, below when it falls to or past it.'
        ),
      threshold: z.number().positive().describe(`The price level. ${PRICE_INPUT_UNITS}`),
      priceConfirmed: priceConfirmedInput,
    }),
    z.strictObject({
      action: z.literal('disable').describe('Disable one alert by id.'),
      alertId: alertIdInput,
    }),
  ])
}

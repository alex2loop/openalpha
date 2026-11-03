import type { SlashCommand, SlashContext, SlashResult } from '@/core/types/command'
import type { MarketRef, PortfolioSegment } from '@/trading/kernel/instrument'
import { BRAND } from '@/core/brand'
import { t } from '@/i18n'
import { renderMarketName } from '@/trading/render/tool-detail'

// The prompt is the model's input, not a rendered list, so a plain comma join is enough.
const MARKET_SEPARATOR = ', '

/** A market the operator can trade, as the question names it and the segment it switches. */
interface SetupMarket {
  readonly market: MarketRef
  readonly segment: PortfolioSegment
}

/** `/setup` calls no service because it exists to onboard, not to act: it hands the agent one
 *  localized instruction and the agent does the talking.
 *
 *  The instruction is rendered here, not by a surface. An `agent` result re-enters the run as a
 *  user turn, so `retryMessage` is the text the model reads — a key would reach it verbatim. The
 *  key stays in `messageKeys` so the locale gate still requires both translations. `markets` puts
 *  the home market first, then every other one a venue trades. */
export function createSetupCommand(markets: readonly SetupMarket[]): SlashCommand {
  return {
    name: 'setup',
    description: { kind: 'localized', key: 'slash.tradingSetupHelp' },
    messageKeys: ['slash.tradingSetupPrompt'],
    policy: { surfaces: ['channel', 'repl'], role: 'member', action: 'read' },
    run: async (ctx: SlashContext): Promise<SlashResult> => ({
      kind: 'agent',
      retryMessage: t(ctx.locale, 'slash.tradingSetupPrompt', {
        brand: BRAND.display,
        markets: markets
          .map(({ market, segment }) => `${renderMarketName(ctx.locale, market)} (${segment})`)
          .join(MARKET_SEPARATOR),
      }),
    }),
  }
}

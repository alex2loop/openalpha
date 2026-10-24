import type { OutboundHostWire, OutboundPurpose } from '@/app/server/wire/outbound'
import type { App } from '@/core/container'
import type { MessageKey } from '@/i18n'
import { listPricingHosts, resolveModelHost } from '@/ai/api'
import { enabledChannels } from '@/app/views'
import { UPDATE_CHECK_HOST } from '@/cli/api'
import { hostOfUrl } from '@/core/utils/url'
import { t } from '@/i18n'
import { listSearchHosts } from '@/tools/api'
import { resolveTradingConfig } from '@/trading/api'

/** In the order a reader weighs them: what carries their question, their orders and their
 *  messages before the data fetches. */
const PURPOSES = [
  'model',
  'exchange',
  'channel',
  'social',
  'mcp',
  'plugin',
  'search',
  'web',
  'data',
  'news',
  'pricing',
  'update',
  'reachability',
] as const satisfies readonly OutboundPurpose[]

/** Headlines say what data does, and a plugin source is called with whatever its author's code
 *  sends, which is what an MCP tool is. */
const SENDS_KEYS = {
  data: 'ui.outbound.sends.data',
  news: 'ui.outbound.sends.data',
  model: 'ui.outbound.sends.model',
  pricing: 'ui.outbound.sends.pricing',
  channel: 'ui.outbound.sends.channel',
  exchange: 'ui.outbound.sends.exchange',
  plugin: 'ui.outbound.sends.mcp',
  mcp: 'ui.outbound.sends.mcp',
  search: 'ui.outbound.sends.search',
  web: 'ui.outbound.sends.web',
  update: 'ui.outbound.sends.update',
  social: 'ui.outbound.sends.social',
  reachability: 'ui.outbound.sends.reachability',
} as const satisfies Readonly<Record<OutboundPurpose, MessageKey>>

/** `web` goes wherever a page is pointed, so it names no host. */
const WEB_HOST = ''

interface FoundHost {
  readonly host: string
  readonly purpose: OutboundPurpose
}

/** Every host this config can call, each read from the module that owns it: the sources' pinned
 *  endpoints, the models and their price feed, the started channels, the venues holding a key, the
 *  MCP servers, the search backends, the update check, the joined social networks and the
 *  reachability probe. A host two purposes share is listed once under each, since what is sent
 *  there differs. */
export async function buildOutboundHosts(
  app: App,
  signal: AbortSignal
): Promise<readonly OutboundHostWire[]> {
  const locale = app.config.locale.language
  const found = [...configHosts(app), ...(await ownedHosts(app, signal))]
  const unique = new Map(found.map((entry) => [`${entry.purpose}|${entry.host}`, entry]))

  return [...unique.values()]
    .toSorted((left, right) => PURPOSES.indexOf(left.purpose) - PURPOSES.indexOf(right.purpose))
    .map(({ host, purpose }) => ({ host, purpose, sends: t(locale, SENDS_KEYS[purpose]) }))
}

/** What the config and the modules' own constants name, with no store to ask. */
function configHosts(app: App): readonly FoundHost[] {
  const { config } = app
  const client = config.modelSource === 'client'

  return [
    ...(client ? [] : config.models.flatMap((model) => asHost('model', resolveModelHost(model)))),
    ...(client ? [] : listPricingHosts().map((host) => ({ host, purpose: 'pricing' as const }))),
    ...enabledChannels(app).flatMap((channel) =>
      (channel.apiHosts ?? []).map((host) => ({ host, purpose: 'channel' as const }))
    ),
    ...config.mcp.servers.flatMap((server) =>
      server.transport === 'http' ? asHost('mcp', hostOfUrl(server.url)) : []
    ),
    ...listSearchHosts(config.webSearch).map((host) => ({ host, purpose: 'search' as const })),
    { host: WEB_HOST, purpose: 'web' },
    ...app.resolve('sourceHosts').map(({ host, kind }) => ({ host, purpose: kind })),
    ...(config.update.check ? [{ host: UPDATE_CHECK_HOST, purpose: 'update' as const }] : []),
    {
      host: resolveTradingConfig({ extensions: config.extensions, locale: config.locale })
        .operations.reachabilityHost,
      purpose: 'reachability',
    },
  ]
}

/** What only a store or a running service knows: the venues holding a key and the social networks
 *  an agent has joined. */
async function ownedHosts(app: App, signal: AbortSignal): Promise<readonly FoundHost[]> {
  const venues = await app.resolve('tradingHost').listVenues({ signal })
  const exchanges = venues.flatMap((venue) =>
    venue.apiHosts.map((host) => ({ host, purpose: 'exchange' as const }))
  )

  return [...exchanges, ...(await socialHosts(app))]
}

/** The API base of each network an active agent is a member of. */
async function socialHosts(app: App): Promise<readonly FoundHost[]> {
  if (!app.has('socialService')) {
    return []
  }

  const service = app.resolve('socialService')
  const [members, networks] = await Promise.all([service.listMembers(), service.listNetworks()])
  const joined = new Set(
    members.filter((member) => member.state === 'active').map((member) => member.network)
  )

  return networks
    .filter((network) => network.state === 'active' && joined.has(network.name))
    .flatMap((network) =>
      network.apiBase === undefined ? [] : asHost('social', hostOfUrl(network.apiBase))
    )
}

function asHost(purpose: OutboundPurpose, host: string | undefined): readonly FoundHost[] {
  return host === undefined ? [] : [{ host, purpose }]
}

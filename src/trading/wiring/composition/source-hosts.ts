import type { LoadedSourceModule } from '@/trading/sources/plugin-module'
import { hostOfUrl } from '@/core/utils/url'
import { sourceId } from '@/trading/kernel/source/source-id'
import { BROWSER_FEEDS, RSS_FEEDS } from '@/trading/sources/adapters/rss'
import { SOURCE_ROUTES } from '@/trading/sources/routes'
import {
  BROWSER_REACHABLE_SOURCES,
  SOURCE_ENDPOINTS,
} from '@/trading/wiring/composition/source-facts'
import { splitPluginModules } from '@/trading/wiring/composition/source-registry'

type SourceHostKind = 'data' | 'news' | 'plugin'

export interface SourceHost {
  readonly host: string
  readonly kind: SourceHostKind
}

const NEWS_KIND = 'news'
/** A host two kinds share answers to the first, so a provider that serves bars and headlines is
 *  listed once, as data. */
const KIND_ORDER: readonly SourceHostKind[] = ['data', 'news', 'plugin']

/** Every host a source can reach: the endpoints each adapter pins, the news feeds, and the
 *  endpoints of the plugin sources the registry keeps. Read from the same facts the transport is
 *  built from, so a provider added there appears here. */
export function listSourceHosts(
  pluginModules: readonly LoadedSourceModule[]
): readonly SourceHost[] {
  const newsOnly = newsOnlyIds()
  const builtIn = Object.entries(SOURCE_ENDPOINTS).flatMap(([id, endpoint]) =>
    toHosts(endpoint, newsOnly.has(id) ? 'news' : 'data')
  )
  const feeds = Object.values(RSS_FEEDS).flatMap((feed) => toHosts(feed, 'news'))
  const plugins = splitPluginModules(pluginModules).usable.flatMap((module) =>
    toHosts(module.manifest.endpoint, 'plugin')
  )
  const ranked = [...builtIn, ...feeds, ...plugins].toSorted(
    (left, right) => KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind)
  )
  const byHost = new Map<string, SourceHost>()

  for (const entry of ranked) {
    if (!byHost.has(entry.host)) {
      byHost.set(entry.host, entry)
    }
  }

  return [...byHost.values()]
}

/** The hosts a page may reach: the endpoints of the sources a browser answers and the news feeds it
 *  can read, from the same tables the page's routes are built from. */
export function listBrowserSourceHosts(): readonly string[] {
  const endpoints = Object.entries(SOURCE_ENDPOINTS)
    .filter(([id]) => BROWSER_REACHABLE_SOURCES.has(sourceId(id)))
    .flatMap(([, endpoint]) => toHosts(endpoint, 'data'))
  const feeds = Object.values(BROWSER_FEEDS).flatMap((feed) => toHosts(feed, 'news'))

  return [...new Set([...endpoints, ...feeds].map((entry) => entry.host))]
}

function toHosts(
  endpoint: string | readonly string[],
  kind: SourceHostKind
): readonly SourceHost[] {
  return [endpoint].flat().flatMap((url) => {
    const host = hostOfUrl(url)

    return host === undefined ? [] : [{ host, kind }]
  })
}

/** Ids routed for headlines and for nothing else. */
function newsOnlyIds(): ReadonlySet<string> {
  const other = idsRoutedFor((kind) => kind !== NEWS_KIND)

  return new Set([...idsRoutedFor((kind) => kind === NEWS_KIND)].filter((id) => !other.has(id)))
}

function idsRoutedFor(isKind: (kind: string) => boolean): ReadonlySet<string> {
  return new Set(
    Object.entries(SOURCE_ROUTES)
      .filter(([kind]) => isKind(kind))
      .flatMap(([, scopes]) => Object.values(scopes).flat())
  )
}

// Bound beside the plugin source modules it is built from, which only the registration sees.
declare module '@/core/container' {
  interface Services {
    sourceHosts: readonly SourceHost[]
  }
}

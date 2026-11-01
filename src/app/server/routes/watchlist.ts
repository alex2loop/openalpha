import { z } from 'zod'

import type { WatchlistUpdateBody, WatchlistUpdateResponse } from '@/app/server/wire/watchlist'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { Caveat, InstrumentRef, TradingHost } from '@/trading/api'
import { apiError, json } from '@/app/server/http/dispatch'
import { toInstrumentWire } from '@/app/server/mappers/trading'
import { hostOf, localeOf, readJsonBody } from '@/app/server/routes/params'
import { t } from '@/i18n'
import { buildInstrumentKey } from '@/trading/api'

const MAX_NAMES = 50
const NAMES = z.array(z.string().min(1)).max(MAX_NAMES).exactOptional()
const WATCHLIST_BODY: z.ZodType<WatchlistUpdateBody> = z.object({ add: NAMES, remove: NAMES })

// A name two markets claim, which a surface asks the operator to qualify rather than call unknown.
const AMBIGUOUS_CODES: ReadonlySet<Caveat['code']> = new Set([
  'market.ticker-ambiguous',
  'market.ticker-shared',
])

type WatchlistChange = Awaited<ReturnType<TradingHost['updateWatchlist']>>

/** `remove` first, then `add`, each a save of its own. The names resolve as `/watchlist` resolves
 *  them, so one nothing matches comes back in `unknown` rather than as an error. */
async function handleWatchlistUpdate(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const parsed = WATCHLIST_BODY.safeParse(await readJsonBody(req))
  const { add = [], remove = [] } = parsed.success ? parsed.data : {}

  if (!parsed.success || add.length + remove.length === 0) {
    return apiError('invalid_body')
  }

  const host = hostOf(ctx)
  const { signal } = req
  const before = (await host.getProfile(signal)).watchlist
  const removal =
    remove.length === 0
      ? undefined
      : await host.updateWatchlist({ kind: 'remove', names: remove, signal })
  const afterRemove = removal?.kind === 'watchlist' ? removal.instruments : before
  const addition =
    add.length === 0 ? undefined : await host.updateWatchlist({ kind: 'add', names: add, signal })

  const refused = addition?.kind === 'unresolved' ? classify(addition.caveats) : undefined
  // A refusal that names no name (the market list is not loaded, a detector failed) must not read
  // as an empty answer: every requested name goes back as unknown, with the reason.
  const nameless = refused !== undefined && refused.unknown.length + refused.ambiguous.length === 0

  return json({
    added: listedIn(addition, afterRemove).map(toInstrumentWire),
    removed: difference(before, afterRemove).map(toInstrumentWire),
    unknown: nameless ? add : (refused?.unknown ?? []),
    ambiguous: refused?.ambiguous ?? [],
    ...(nameless ? { message: t(localeOf(ctx), 'errors.watchlistNotLoaded') } : {}),
  } satisfies WatchlistUpdateResponse)
}

/** What a save put on the list that was not there before it. */
function listedIn(
  change: WatchlistChange | undefined,
  before: readonly InstrumentRef[]
): readonly InstrumentRef[] {
  return change?.kind === 'watchlist' ? difference(change.instruments, before) : []
}

function difference(
  list: readonly InstrumentRef[],
  other: readonly InstrumentRef[]
): readonly InstrumentRef[] {
  const known = new Set(other.map(buildInstrumentKey))

  return list.filter((entry) => !known.has(buildInstrumentKey(entry)))
}

/** The names the registry could not place, told apart by what its caveat says: a name two markets
 *  claim, and a name nothing lists. */
function classify(caveats: readonly Caveat[]): {
  readonly unknown: readonly string[]
  readonly ambiguous: readonly string[]
} {
  const named = caveats.flatMap(({ code, detail }) =>
    typeof detail?.ticker === 'string' ? [{ ticker: detail.ticker, code }] : []
  )
  const isAmbiguous = (code: Caveat['code']): boolean => AMBIGUOUS_CODES.has(code)

  return {
    unknown: unique(named.filter(({ code }) => !isAmbiguous(code)).map(({ ticker }) => ticker)),
    ambiguous: unique(named.filter(({ code }) => isAmbiguous(code)).map(({ ticker }) => ticker)),
  }
}

function unique(names: readonly string[]): readonly string[] {
  return [...new Set(names)]
}

export const WATCHLIST_ROUTES = [
  { method: 'POST', path: '/v1/watchlist', auth: true, handler: handleWatchlistUpdate },
] as const satisfies readonly ApiRouteSpec[]

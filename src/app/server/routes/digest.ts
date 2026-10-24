import type { DigestWire } from '@/app/server/wire/digest'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import { apiError, json } from '@/app/server/http/dispatch'
import { toCallNote, toStopNote } from '@/app/server/mappers/digest'
import { STOP_BREACHED_KIND } from '@/app/server/mappers/notices'
import { hostOf, localeOf, parseOptionalBranded } from '@/app/server/routes/params'
import { dayInZone, dayRangeInZone } from '@/core/utils/time'
import { DEEP_RESEARCHER_ID } from '@/engine/api'
import { tradingDay } from '@/trading/api'

const DIGEST_NOTABLE = 2
const DIGEST_PER_KIND = 1

/** The operator's day, in `[locale] timezone`, as `/v1/activity` and the cost caps count it. */
async function handleDigest(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const zone = ctx.app.config.locale.timezone
  const requested = parseOptionalBranded(new URL(req.url).searchParams.get('day'), tradingDay)

  if (requested === null) {
    return apiError('invalid_body')
  }

  const day = requested ?? tradingDay(dayInZone(Date.now(), zone))
  const range = dayRangeInZone({ fromDay: day, toDay: day }, zone)

  if (range === undefined) {
    return apiError('invalid_body')
  }

  const host = hostOf(ctx)
  const [facts, researchCount, spendUsd, stops] = await Promise.all([
    host.getDayDigest({ day, range, limit: DIGEST_PER_KIND, signal: req.signal }),
    ctx.app.resolve('runLogStore').countResearch(DEEP_RESEARCHER_ID, range.fromMs, range.toMs),
    ctx.app.resolve('spendReader').forRange({ fromDay: day, toDay: day }),
    ctx.app.resolve('noticeStore').listOfKind(STOP_BREACHED_KIND, range, DIGEST_NOTABLE),
  ])
  const locale = localeOf(ctx)
  const context = { locale, timezone: zone, markets: host.describeMarkets().markets }
  const notable = [
    ...stops.flatMap((row) => toStopNote(row, context) ?? []).slice(0, DIGEST_PER_KIND),
    ...facts.closed.slice(0, DIGEST_PER_KIND).map((call) => toCallNote(call, locale)),
  ].slice(0, DIGEST_NOTABLE)

  return json({
    day,
    suggestions: facts.suggestionCount,
    reports: (facts.hasBrief ? 1 : 0) + researchCount,
    spendUsd,
    notable,
  } satisfies DigestWire)
}

export const DIGEST_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'GET', path: '/v1/digest', auth: true, handler: handleDigest },
]

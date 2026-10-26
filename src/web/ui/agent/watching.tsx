import type { StopsResponse } from '@/app/server/wire/money'
import type { NoticeWire } from '@/app/server/wire/notices'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { openBook } from '@/web/state/book'
import { useNow } from '@/web/state/clock'
import { openTicker } from '@/web/state/known-tickers'
import { alertsCheckedAt } from '@/web/state/live'
import { findQuote, heldPositions, keyOf, stopsBlock } from '@/web/state/market'
import { notices } from '@/web/state/notices'
import { state } from '@/web/state/session'
import { useAlerts } from '@/web/state/watch'
import { formatPercent } from '@/web/text/figures'
import { ABSENT_CELL, joinInline } from '@/web/text/glyphs'
import { formatMarketPrice } from '@/web/text/market-price'
import { sourceLabel } from '@/web/text/source'
import { buildDayKey, formatClock, MS_PER_MINUTE } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { toNoticeText } from '@/web/ui/bell/notice-row'
import { AlertRow } from '@/web/ui/book/alert-row'
import { formatAlertSeconds } from '@/web/ui/jobs/schedule-sections'
import { Button } from '@/web/ui/kit/button'
import { useLoad } from '@/web/ui/kit/use-load'

type StopRow = StopsResponse['stops'][number]

// The notices the alert pass files.
const FIRED_KINDS: ReadonlySet<string> = new Set(['alert_fired', 'stop_breached'])
// Today's list turns over within this long of midnight.
const DAY_TICK_MS = MS_PER_MINUTE

/** "Đang canh": when the alert pass last looked, every held name's stop, the price alerts you set,
 *  and what fired today and where it went. It costs no AI. Every row opens its ticker. */
export function Watching() {
  const tasks = useLoad((signal) => getJson(ROUTES.tasks, { signal })).value
  const alerts = useAlerts().data?.alerts ?? []
  const timeZone = state.value?.timeZone
  const checkedAt = alertsCheckedAt.value
  const fired = listFiredToday(useNow(DAY_TICK_MS).value)

  return (
    <>
      <p class="meta">
        {tr('ui.office.agent.watchLast', {
          time:
            checkedAt === undefined || timeZone === undefined
              ? ABSENT_CELL
              : formatClock(checkedAt, timeZone),
          seconds: formatAlertSeconds(tasks),
        })}
      </p>
      <section class="agent-section">
        {listHeldStops().map((stop) => (
          <StopLine key={keyOf(stop.instrument)} stop={stop} fired={fired} />
        ))}
      </section>
      <section class="agent-section">
        <h3 class="sub-head">{tr('ui.office.common.priceAlerts')}</h3>
        {alerts.map((alert) => (
          <AlertRow key={alert.id} alert={alert} withTicker />
        ))}
      </section>
      <FiredToday fired={fired} />
      <Button size="small" onClick={() => openBook('watch')}>
        {tr('ui.office.agent.watchOpen')}
      </Button>
    </>
  )
}

function StopLine({
  stop,
  fired,
}: {
  readonly stop: StopRow
  readonly fired: readonly NoticeWire[]
}) {
  const { market, ticker } = stop.instrument
  const kind = findQuote(ticker, market)?.kind
  const isBreached = stop.distanceToStopPct !== undefined && stop.distanceToStopPct <= 0

  return (
    <button type="button" class="row-button agent-stop" onClick={() => openTicker(ticker, market)}>
      <span class={isBreached ? 'is-breached' : undefined}>
        {tr('ui.office.agent.watchStop', {
          ticker,
          stop: formatMarketPrice(market, stop.stop, kind),
          distance: isBreached
            ? tr('ui.office.agent.watchBreached', { time: breachTime(ticker, fired) })
            : joinInline([
                formatMarketPrice(market, stop.price, kind),
                tr('ui.office.agent.watchDistance', {
                  distance: formatPercent(stop.distanceToStopPct),
                }),
              ]),
        })}
      </span>
    </button>
  )
}

function FiredToday({ fired }: { readonly fired: readonly NoticeWire[] }) {
  const timeZone = state.value?.timeZone

  if (fired.length === 0 || timeZone === undefined) {
    return null
  }

  return (
    <section class="agent-section">
      <h3 class="sub-head">{tr('ui.office.agent.watchFired')}</h3>
      {fired.map((notice) => (
        <FiredLine key={notice.id} notice={notice} timeZone={timeZone} />
      ))}
    </section>
  )
}

function FiredLine({
  notice,
  timeZone,
}: {
  readonly notice: NoticeWire
  readonly timeZone: string
}) {
  const ticker = notice.event.alert?.instrument.ticker
  const market = notice.event.alert?.instrument.market
  const where = notice.deliveredTo.map(sourceLabel)
  const line = joinInline([
    formatClock(notice.createdAt, timeZone),
    toNoticeText(notice.event)?.title ?? ticker ?? ABSENT_CELL,
    ...where,
  ])

  return ticker === undefined ? (
    <p class="meta">{line}</p>
  ) : (
    <button type="button" class="row-button agent-stop" onClick={() => openTicker(ticker, market)}>
      {line}
    </button>
  )
}

// A fund's lower level is a review, not a stop, and a name below the venue minimum is not held.
function listHeldStops(): readonly StopRow[] {
  const held = new Set(heldPositions.value.map((position) => keyOf(position.instrument)))

  return (stopsBlock.view.value.data?.stops ?? []).filter(
    (stop) => held.has(keyOf(stop.instrument)) && stop.stop !== undefined && !stop.review
  )
}

function listFiredToday(nowMs: number): readonly NoticeWire[] {
  const timeZone = state.value?.timeZone

  if (timeZone === undefined) {
    return []
  }

  const today = buildDayKey(nowMs, timeZone)

  return notices.value.filter(
    (notice) =>
      FIRED_KINDS.has(notice.event.kind) && buildDayKey(notice.createdAt, timeZone) === today
  )
}

// When today's breach of this name was filed; the bell holds the time, the stop row does not.
function breachTime(ticker: string, fired: readonly NoticeWire[]): string {
  const timeZone = state.value?.timeZone
  const notice = fired.find(
    (held) => held.event.kind === 'stop_breached' && held.event.alert?.instrument.ticker === ticker
  )

  return notice === undefined || timeZone === undefined
    ? ABSENT_CELL
    : formatClock(notice.createdAt, timeZone)
}

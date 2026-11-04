import { useSignal } from '@preact/signals'

import type { TradingNewsItemWire, TradingNewsResponse } from '@/app/server/wire/trading'
import { formatDay } from '@/i18n'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { useBlockRead } from '@/web/state/block'
import { isAnalysisOnly } from '@/web/state/edition'
import { marketRegions } from '@/web/state/market-tab'
import { locale, state } from '@/web/state/session'
import { buildDayKey } from '@/web/text/time'
import { shiftDay } from '@/web/text/time-units'
import { tr } from '@/web/text/tr'
import { NewsIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'
import { NewsItem } from '@/web/ui/today/blocks/news'

interface DayGroup {
  readonly day: string
  readonly items: readonly TradingNewsItemWire[]
}

/** Tin tức: every headline the daemon serves for the region, read once on open, grouped by day on
 *  the daemon's calendar and filtered in place. A region this edition does not serve says so. */
export function NewsList({ region }: { readonly region: string }) {
  const reading = useBlockRead((abort) => loadNews(region, abort))
  const label = marketRegions.value.find((choice) => choice.region === region)?.label ?? region

  return (
    <BlockFrame
      title={tr('ui.office.market.tab.news')}
      colour="teal"
      icon={<NewsIcon />}
      reading={reading}
      failedText={tr('ui.office.news.failed')}
    >
      {(news) => (news === null ? <Unserved region={label} /> : <NewsBody news={news} />)}
    </BlockFrame>
  )
}

// The web edition's routes lose the feeds a page cannot read, so a region left with none answers
// not found: not served, never a failed read. A daemon's not found stays a failure.
async function loadNews(region: string, abort: AbortSignal): Promise<TradingNewsResponse | null> {
  try {
    return await getJson(ROUTES.news, { query: { region }, signal: abort })
  } catch (error: unknown) {
    if (isAnalysisOnly.value && error instanceof ApiFailure && error.code === 'not_found') {
      return null
    }

    throw error
  }
}

function Unserved({ region }: { readonly region: string }) {
  return <p class="empty-note">{tr('ui.office.news.unserved', { region })}</p>
}

function NewsBody({ news }: { readonly news: TradingNewsResponse }) {
  const query = useSignal('')

  if (news.items.length === 0) {
    return <p class="empty-note">{tr('ui.office.news.none')}</p>
  }

  return (
    <>
      <input
        type="search"
        class="market-filter"
        placeholder={tr('ui.office.news.filter')}
        aria-label={tr('ui.office.news.filter')}
        value={query.value}
        onInput={(event) => (query.value = event.currentTarget.value)}
      />
      <NewsGroups items={news.items} query={query.value.trim()} />
    </>
  )
}

function NewsGroups({
  items,
  query,
}: {
  readonly items: readonly TradingNewsItemWire[]
  readonly query: string
}) {
  const needle = query.toLocaleLowerCase(locale.value)
  const shown = items.filter((item) => item.title.toLocaleLowerCase(locale.value).includes(needle))
  const timeZone = state.value?.timeZone

  if (shown.length === 0) {
    return <p class="empty-note">{tr('ui.office.news.noMatch', { query })}</p>
  }

  // Without the daemon's zone no day can be placed, so the headlines stand in one list.
  if (timeZone === undefined) {
    return <NewsItems items={shown} />
  }

  const today = buildDayKey(Date.now(), timeZone)

  return (
    <>
      {toDayGroups(shown, timeZone).map((group) => (
        <section key={group.day}>
          <h3 class="sub-head">{dayLabel(group.day, today)}</h3>
          <NewsItems items={group.items} />
        </section>
      ))}
    </>
  )
}

function NewsItems({ items }: { readonly items: readonly TradingNewsItemWire[] }) {
  return (
    <>
      {items.map((item) => (
        <NewsItem key={item.url} item={item} />
      ))}
    </>
  )
}

// The daemon sends the newest first, so each day's group keeps that order.
function toDayGroups(items: readonly TradingNewsItemWire[], timeZone: string): readonly DayGroup[] {
  const groups = new Map<string, TradingNewsItemWire[]>()

  for (const item of items) {
    const day = buildDayKey(item.publishedAt, timeZone)

    groups.set(day, [...(groups.get(day) ?? []), item])
  }

  return [...groups].map(([day, held]) => ({ day, items: held }))
}

function dayLabel(day: string, today: string): string {
  if (day === today) {
    return tr('ui.office.common.today')
  }

  return day === shiftDay(today, -1) ? tr('ui.office.news.yesterday') : formatDay(locale.value, day)
}

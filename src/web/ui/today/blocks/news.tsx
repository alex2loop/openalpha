import type { TradingNewsItemWire } from '@/app/server/wire/trading'
import { ROUTES } from '@/web/api/routes'
import { useBlock } from '@/web/state/block'
import { openMarketTab } from '@/web/state/market-tab'
import { state } from '@/web/state/session'
import { joinInline } from '@/web/text/glyphs'
import { formatClock, formatWhen } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { NewsIcon } from '@/web/ui/kit/icons'
import { toSafeHref } from '@/web/ui/markdown/inline'
import { BlockFrame } from '@/web/ui/today/block-frame'

const NEWS_LIMIT = 5
const NEWS_POLL_MS = 300_000

/** "Tin nổi bật": the newest headlines; a source opens in a new tab. */
export function News() {
  const reading = useBlock(ROUTES.news, { query: { limit: NEWS_LIMIT }, everyMs: NEWS_POLL_MS })

  return (
    <BlockFrame
      title={tr('ui.office.today.news')}
      colour="teal"
      icon={<NewsIcon />}
      reading={reading}
      action={
        <Button kind="tertiary" size="small" onClick={() => openMarketTab('news')}>
          {tr('ui.office.market.seeAll')}
        </Button>
      }
    >
      {(news) =>
        news.items.length === 0 ? (
          <p class="empty-note">{tr('ui.office.today.empty')}</p>
        ) : (
          news.items.slice(0, NEWS_LIMIT).map((item) => <NewsItem key={item.url} item={item} />)
        )
      }
    </BlockFrame>
  )
}

interface NewsItemProps {
  readonly item: TradingNewsItemWire
  /** The item sits under its day's heading, so only the time of day is left to say. */
  readonly isDated?: boolean
}

/** One headline with its publisher and time; it opens the article in a new tab. */
export function NewsItem({ item, isDated }: NewsItemProps) {
  const timeZone = state.value?.timeZone
  const href = toSafeHref(item.url)
  const when =
    timeZone === undefined
      ? []
      : [
          isDated === true
            ? formatClock(item.publishedAt, timeZone)
            : formatWhen(item.publishedAt, timeZone),
        ]
  const facts = [...(item.publisher === undefined ? [] : [item.publisher]), ...when]
  const body = (
    <>
      <b>{item.title}</b>
      <span class="meta"> {joinInline(facts)}</span>
    </>
  )

  return href !== undefined ? (
    <a class="news-item" href={href} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  ) : (
    <div class="news-item">{body}</div>
  )
}

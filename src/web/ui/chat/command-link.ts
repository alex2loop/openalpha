import type { MessageKey } from '@/i18n'
import { openBook } from '@/web/state/book'
import { openIdeas } from '@/web/state/ideas'
import { openTicker } from '@/web/state/known-tickers'
import { callsBlock } from '@/web/state/market'
import { COST_POPOVER_ID } from '@/web/ui/cost/cost-popover'
import { togglePopover } from '@/web/ui/kit/popover'
import { openReader } from '@/web/ui/reader/reader'
import { openWhy } from '@/web/ui/ticker/why-dialog'

const WORD_BREAK = /\s+/
// `market:ticker` names the market when two claim a ticker.
const MARKET_SEPARATOR = ':'

interface CommandLink {
  readonly label: MessageKey
  readonly params?: Readonly<Record<string, string>>
  readonly open: () => void
}

type LinkBuilder = (args: readonly string[]) => CommandLink | undefined

// The screen that holds the rest of a command's answer, by the command as typed.
const COMMAND_LINKS: Readonly<Record<string, LinkBuilder>> = Object.freeze({
  '/cost': () => linkTo('ui.office.chat.link.cost', () => togglePopover(COST_POPOVER_ID)),
  '/price': linkPrice,
  '/brief': () => linkTo('ui.office.chat.link.brief', () => openReader({ kind: 'brief' })),
  '/screen': linkScreen,
  '/debate': linkDebate,
  '/portfolio': () => linkTo('ui.office.common.seeBook', () => openBook('overview')),
  '/watchlist': () => linkTo('ui.office.chat.link.watchlist', () => openBook('watch')),
  '/rebalance': () => linkTo('ui.office.chat.link.rebalance', () => openBook('rebalance')),
})

/** The link for the command `text` starts with; none for a question or an unlisted command. */
export function resolveCommandLink(text: string): CommandLink | undefined {
  const [name = '', ...args] = text.trim().split(WORD_BREAK)

  return Object.hasOwn(COMMAND_LINKS, name) ? COMMAND_LINKS[name]?.(args) : undefined
}

function linkTo(label: MessageKey, open: () => void): CommandLink {
  return { label, open }
}

// `/screen crypto` lands on that market's board; a bare `/screen` on the one last open.
function linkScreen([first]: readonly string[]): CommandLink {
  return linkTo('ui.office.chat.link.screen', () => openIdeas('screen', first))
}

// The standing plan on the name the command asked about, its debate in "Vì sao?"; a name with no
// plan opens its card instead.
function linkDebate([first]: readonly string[]): CommandLink | undefined {
  const name = parseName(first)

  if (name === undefined) {
    return undefined
  }

  return linkTo('ui.office.chat.link.debate', () => {
    const call = callsBlock.view.value.data?.suggestions.find(
      (held) =>
        held.instrument.ticker === name.ticker &&
        (name.market === undefined || held.instrument.market === name.market)
    )

    if (call === undefined) {
      openTicker(name.ticker, name.market)
    } else {
      openWhy({ kind: 'plan', call })
    }
  })
}

// The first name the command asked about.
function linkPrice([first]: readonly string[]): CommandLink | undefined {
  const name = parseName(first)

  if (name === undefined) {
    return undefined
  }

  return {
    label: 'ui.office.chat.link.price',
    params: { ticker: name.ticker },
    open: () => openTicker(name.ticker, name.market),
  }
}

// `ticker` or `market:ticker`, the ticker upper-cased.
function parseName(argument: string | undefined): { ticker: string; market?: string } | undefined {
  if (argument === undefined || argument === '') {
    return undefined
  }

  const [market, ticker] = argument.includes(MARKET_SEPARATOR)
    ? argument.split(MARKET_SEPARATOR)
    : [undefined, argument]

  if (ticker === undefined || ticker === '') {
    return undefined
  }

  return { ticker: ticker.toUpperCase(), ...(market === undefined ? {} : { market }) }
}

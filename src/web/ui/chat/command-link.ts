import type { MessageKey } from '@/i18n'
import { openBook } from '@/web/state/book'
import { openIdeas } from '@/web/state/ideas'
import { openTicker } from '@/web/state/known-tickers'
import { COST_POPOVER_ID } from '@/web/ui/cost/cost-popover'
import { openAlertDialog } from '@/web/ui/dialogs/alert-dialog'
import { openTradeDialog } from '@/web/ui/dialogs/trade-dialog'
import { togglePopover } from '@/web/ui/kit/popover'
import { openReader } from '@/web/ui/reader/reader'

const WORD_BREAK = /\s+/
// `market:ticker` names the market when two claim a ticker.
const MARKET_SEPARATOR = ':'
// The word after `/alert` that sets a new alert.
const ALERT_CREATE_WORD = 'create'

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
  '/portfolio': () => linkTo('ui.office.common.seeBook', () => openBook('overview')),
  '/watchlist': () => linkTo('ui.office.chat.link.watchlist', () => openBook('watch')),
  '/rebalance': () => linkTo('ui.office.chat.link.rebalance', () => openBook('rebalance')),
  '/alert': linkAlert,
  '/record': () => linkTo('ui.office.chat.link.record', () => openTradeDialog()),
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

// `/alert create FPT ...` opens the form for the name it asked about; any other `/alert` has none.
function linkAlert([action, first]: readonly string[]): CommandLink | undefined {
  const name = action?.toLowerCase() === ALERT_CREATE_WORD ? parseName(first) : undefined

  if (name === undefined) {
    return undefined
  }

  return {
    label: 'ui.office.chat.link.alert',
    open: () => openAlertDialog(name),
  }
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

// "fpt" or "crypto:hdb" as a name in capitals and the market it named, if any.
function parseName(arg: string | undefined): { ticker: string; market?: string } | undefined {
  if (arg === undefined || arg === '') {
    return undefined
  }

  const [market, ticker] = arg.includes(MARKET_SEPARATOR)
    ? arg.split(MARKET_SEPARATOR)
    : [undefined, arg]

  if (ticker === undefined || ticker === '') {
    return undefined
  }

  return market === undefined
    ? { ticker: ticker.toUpperCase() }
    : { ticker: ticker.toUpperCase(), market }
}

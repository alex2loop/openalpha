import type { Logger } from '@/core/logging/logger'
import type {
  PublicBriefRender,
  PublicBriefRow,
  PublicScreenText,
} from '@/trading/features/brief/public/types'
import type { BriefText } from '@/trading/features/brief/surface'
import type { TradingServices } from '@/trading/wiring/composition/service-aggregate'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { LOCALES } from '@/core/types/locale'
import { exemptTickers } from '@/trading/features/brief/public/scope'

/** A ticker this long or longer may stand glued to a word of the other case: a short one (`T`,
 *  `VN`) is the start of an ordinary capitalised word. */
const GLUED_MIN_LENGTH = 3
const SEPARATOR_RE = /[._-]/
const SEPARATOR_CLASS = '[._-]'
/** A glued word ends where its case turns: `HPGvà`, `fooHPG`. */
const GLUED_START = '(?:(?<![A-Za-z0-9])|(?<=[a-z])(?=[A-Z]))'
const GLUED_END = '(?:(?![A-Za-z0-9])|(?<=[A-Z])(?=[a-z])|(?<=[a-z])(?=[A-Z]))'
const WORD_START = '(?<![A-Za-z0-9])'
const WORD_END = '(?![A-Za-z0-9])'

type GuardServices = Pick<TradingServices, 'portfolio' | 'profiles'>

type GuardVerdict =
  | { readonly kind: 'publish' }
  | { readonly kind: 'refuse'; readonly leaked: readonly string[] }
  | { readonly kind: 'unread' }

interface PublicBriefGuard {
  judge(row: PublicBriefRow, render: PublicBriefRender, signal: AbortSignal): Promise<GuardVerdict>
}

/** The last lock before a brief leaves the daemon, and the one public-brief file that reads the
 *  book. It refuses the day when a held or watched ticker stands in the text outside the rows the
 *  brief prints for its own markets. A failed read of the book publishes nothing either, and says
 *  so apart from a refusal, because a later attempt may read it. An abort is not a failed read: it
 *  goes up to the tick, which tells its deadline from a shutdown. A name leaves only the owner's
 *  log, never the verdict's wording. */
export function createPublicBriefGuard(services: GuardServices, logger: Logger): PublicBriefGuard {
  return {
    async judge(row, render, signal) {
      const followed = await readFollowed(services, signal).catch((err: unknown) => {
        if (isAbortError(err)) {
          throw err
        }

        logger.error('trading.public_brief_guard_unread', {
          day: row.day,
          err: formatErrForLog(err),
        })

        return undefined
      })

      if (followed === undefined) {
        return { kind: 'unread' }
      }

      const leaked = leakedTickers(textOf(render), followed, exemptTickers(row))

      if (leaked.length === 0) {
        return { kind: 'publish' }
      }

      logger.error('trading.public_brief_refused', { day: row.day, leaked })

      return { kind: 'refuse', leaked }
    },
  }
}

/** The held tickers with residue included, and the watchlist. */
async function readFollowed(
  services: GuardServices,
  signal: AbortSignal
): Promise<ReadonlySet<string>> {
  const now = Date.now()
  const [positions, profile] = await Promise.all([
    services.portfolio.positionsAt({ now, signal }),
    services.profiles.get({ signal }),
  ])

  return new Set(
    [...positions.map((position) => position.instrument), ...profile.watchlist].map(
      (instrument) => instrument.ticker
    )
  )
}

/** The followed tickers that stand in the text as a whole word and are not exempt, in the order
 *  followed. A ticker is read in capitals only, with `.`, `-` and `_` as one separator (`BRK.B` is
 *  `BRK-B`): `GAS` is a ticker and `gas` is a word. */
function leakedTickers(
  text: readonly string[],
  followed: ReadonlySet<string>,
  exempt: ReadonlySet<string>
): readonly string[] {
  return [...followed]
    .filter((ticker) => !exempt.has(ticker))
    .filter((ticker) => {
      const word = toWordPattern(ticker)

      return text.some((line) => word.test(line))
    })
}

function toWordPattern(ticker: string): RegExp {
  const body = ticker.split(SEPARATOR_RE).map(escapeRegExp).join(SEPARATOR_CLASS)

  return ticker.length >= GLUED_MIN_LENGTH
    ? new RegExp(`${GLUED_START}${body}${GLUED_END}`)
    : new RegExp(`${WORD_START}${body}${WORD_END}`)
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Every line a reader sees, in both languages: the brief, the headline, the screen lists. */
function textOf(render: PublicBriefRender): readonly string[] {
  return LOCALES.flatMap((locale) => [
    ...briefLines(render.texts[locale]),
    render.headline[locale],
    ...render.screens[locale].flatMap(screenLines),
  ])
}

function briefLines(text: BriefText): readonly string[] {
  return [
    text.title,
    ...text.strip,
    text.verdictTitle,
    ...text.verdict,
    ...text.nextActions,
    ...text.story.map((line) => line.text),
    ...text.sections.flatMap((section) => [
      section.block,
      section.heading,
      ...(section.market === undefined ? [] : [section.market]),
      ...section.lines,
    ]),
    ...text.caveats,
  ]
}

function screenLines(screen: PublicScreenText): readonly string[] {
  return [screen.title, screen.note, ...screen.rows.flatMap((row) => [row.ticker, row.line])]
}

// The market side of the public-brief gate (`check-public-brief`): what the composition file, the
// screen and the US board may know of the operator. Each check answers the messages it found.
import { Glob } from 'bun'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import { PUBLIC_BRIEF_MARKETS, PUBLIC_US_MARKET } from '@/trading/features/brief/public/reads'

const REPO = resolve(import.meta.dir, '..')
const TRADING = `${REPO}/src/trading`

export const MARKETS_DIR = `${TRADING}/markets`
export const COMPOSITION_FILE = `${TRADING}/wiring/composition/public-brief.ts`
export const BOOK_FREE_SCREEN_FILE = `${TRADING}/features/market-data/ops/book-free-screen.ts`

const CRYPTO_SCREEN_FILE = `${MARKETS_DIR}/crypto/screen-run.ts`
const US_DIR = `${MARKETS_DIR}/equity-us`
const US_BOARD_FILE = `${US_DIR}/board.ts`
const VENUE_BLIND_SET_RE = /\bvenueBlind:\s*true\b/
const VENUE_BLIND_READ_RE = /\bvenueBlind\b/
const FOLLOWED_BLIND_SET_RE = /\bfollowedBlind:\s*true\b/
const FOLLOWED_BLIND_HONOURED_RE =
  /\bfollowedBlind\s*===\s*true\s*\?\s*NO_FOLLOWED\s*:\s*followedTickersIn\b/
const FOLLOWED_READER_RE = /\b(?:followedTickersIn|heldTickersIn)\b/
const BOARD_GET_RE = /\.get\(([^)]*)\)/g
const SEGMENT_SEAM_RE = /readonly profiles: Pick<ProfileService, 'get'>/g
const SEGMENT_READ_RE = /const \{ caps \} = await parts\.profiles\.get\(\{ signal \}\)/g
const SEGMENT_USE_RE = /return !disabledSegments\(caps\)\.has\(us\.manifest\.segment\)/g
const PROFILE_WORD_RE = /\b(?:profiles|caps)\b/

/** The US files that read the board for a brief, an overview or a screen, and so hand the request
 *  on to the board cache, which keeps the operator's names out of a `followedBlind` one. */
const US_BOARD_READERS: readonly string[] = [
  `${US_DIR}/capabilities.ts`,
  `${US_DIR}/overview.ts`,
  `${US_DIR}/screen-capability.ts`,
]

/** The files in `markets/` that read the operator's held or watched names: the helper, the US board
 *  (guarded by `followedBlind`) and the refreshes, which only choose what to prefetch. A new reader
 *  fails until it is named here. */
const FOLLOWED_READERS: ReadonlySet<string> = new Set([
  `${MARKETS_DIR}/held-tickers.ts`,
  US_BOARD_FILE,
  `${US_DIR}/refresh/fundamentals.ts`,
  `${MARKETS_DIR}/equity-vn/refresh/accounts.ts`,
])

/** The composition file reads the profile once, for the caps, and uses them for one answer: whether
 *  the US segment is on. Each piece is stated whole; with them removed, the file names neither the
 *  profile service nor its caps again, so any other read of the profile fails here. */
export function segmentBitGaps(): readonly string[] {
  const source = readFileSync(COMPOSITION_FILE, 'utf8')
  const file = relative(REPO, COMPOSITION_FILE)
  const gaps: string[] = []

  for (const [piece, found] of [
    ['declare the profile seam as a get-only pick', source.match(SEGMENT_SEAM_RE)],
    ['read only the caps of the profile', source.match(SEGMENT_READ_RE)],
    ['answer with whether the US segment is disabled', source.match(SEGMENT_USE_RE)],
  ] as const) {
    if (found?.length !== 1) {
      gaps.push(`${file} must ${piece}, once`)
    }
  }

  const rest = source
    .replace(SEGMENT_SEAM_RE, '')
    .replace(SEGMENT_READ_RE, '')
    .replace(SEGMENT_USE_RE, '')

  if (PROFILE_WORD_RE.test(rest)) {
    gaps.push(`${file} reads the profile beyond the US segment bit`)
  }

  if (PUBLIC_BRIEF_MARKETS.includes(PUBLIC_US_MARKET)) {
    gaps.push(
      'PUBLIC_BRIEF_MARKETS holds the US market, which is public only while its segment is on'
    )
  }

  return gaps
}

/** The screen is run through the market's capability, which an import walk cannot follow: the call
 *  states `venueBlind`, and the one screen that reads the venues' listings honours it. */
export function venueBlindGaps(): readonly string[] {
  const gaps: string[] = []

  if (!VENUE_BLIND_SET_RE.test(readFileSync(BOOK_FREE_SCREEN_FILE, 'utf8'))) {
    gaps.push(
      `${relative(REPO, BOOK_FREE_SCREEN_FILE)} does not run the screen with venueBlind: true`
    )
  }

  if (!VENUE_BLIND_READ_RE.test(readFileSync(CRYPTO_SCREEN_FILE, 'utf8'))) {
    gaps.push(`${relative(REPO, CRYPTO_SCREEN_FILE)} no longer reads venueBlind`)
  }

  return gaps
}

/** The US board ranks the names the operator follows, so the public path proves it never asks: each
 *  public read (`setters`) states `followedBlind`, each US read of the board passes its request on,
 *  the board skips the followed read for one, and no other file under `markets/` reads the followed
 *  names. */
export function followedBlindGaps(setters: readonly string[]): readonly string[] {
  const gaps = setters
    .filter((file) => !FOLLOWED_BLIND_SET_RE.test(readFileSync(file, 'utf8')))
    .map((file) => `${relative(REPO, file)} does not state followedBlind: true`)

  for (const file of US_BOARD_READERS) {
    const source = readFileSync(file, 'utf8')
    const calls = [...source.matchAll(BOARD_GET_RE)].map((match) => match[1] ?? '')

    if (calls.length === 0 || calls.some((args) => !args.trimEnd().endsWith(', request'))) {
      gaps.push(`${relative(REPO, file)} reads the board without passing its request`)
    }
  }

  if (!FOLLOWED_BLIND_HONOURED_RE.test(readFileSync(US_BOARD_FILE, 'utf8'))) {
    gaps.push(
      `${relative(REPO, US_BOARD_FILE)} reads the followed names for a followedBlind board`
    )
  }

  const readers = [...new Glob('**/*.ts').scanSync(MARKETS_DIR)]
    .map((file) => `${MARKETS_DIR}/${file}`)
    .filter(
      (file) => !FOLLOWED_READERS.has(file) && FOLLOWED_READER_RE.test(readFileSync(file, 'utf8'))
    )

  return [
    ...gaps,
    ...readers.map(
      (file) => `${relative(REPO, file)} reads the followed names and is no known reader`
    ),
  ]
}

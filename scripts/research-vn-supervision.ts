#!/usr/bin/env bun
// Print the vocabulary a free provider publishes for names the exchange has placed under
// supervision, so the event and status code tables are widened from what a provider actually sent
// rather than from a guess.
//
// Three providers, because the exchange's own list is not the only one that can answer:
//   - HOSE (`api.hsx.vn`), the exchange itself: a status taxonomy and, per status, the standing
//     list of names filed under it. This is what the runtime's `hsx` adapter reads.
//   - SSI (`iboard-query`), the broker board the runtime merges in for HNX: a status code per name,
//     on both admitted exchanges.
//   - vndirect (`finfo-api`), which the events adapter already speaks: per-name dated event rows.
//
// Run it when a supervision reading looks wrong: it prints every status id the exchange publishes
// with its live count, and every code SSI files a name under, which is what shows a taxonomy either
// adapter's own table has stopped matching.
//
// Usage:
//   bun scripts/research-vn-supervision.ts DGC HVN VMD DRH FPT
//
// Stands outside the runtime on purpose: it is the only place this repository may address a
// provider without going through `SourceFacts`, because it exists to read what the facts omit.
const VNDIRECT_ENDPOINT = 'https://finfo-api.vndirect.com.vn/v4'
const HSX_ENDPOINT = 'https://api.hsx.vn/l/api/v1'
const SSI_ENDPOINT = 'https://iboard-query.ssi.com.vn/stock/exchange'
/** The SSI board the exchange's own list is comparable to: `hsx` publishes for HOSE alone. */
const SSI_COMPARABLE_BOARD = 'hose'
const SSI_BOARDS = [SSI_COMPARABLE_BOARD, 'hnx'] as const
/** What SSI calls a name under no decision, on each of the two fields that can carry one. */
const NORMAL_ADMIN_STATUS = 'NRM'
const NORMAL_TRADING_STATUS = 'N'
/** The listing service's language segment; `0` returns every identifying field null. */
const HSX_LANGUAGE = '1'
const EVENT_LOCALE = 'VN'
const FROM_DAY = '2026-01-01'
const PAGE_SIZE = 500
const REQUEST_TIMEOUT_MS = 15_000
const CODE_COLUMN_WIDTH = 16
const TICKER_COLUMN_WIDTH = 6
const EXIT_USAGE = 2

interface EventRow {
  readonly code: string
  readonly type: string
  readonly typeDesc: string
  readonly effectiveDate: string
}

interface StatusRow {
  readonly id: number
  readonly name: string
}

interface BoardRow {
  readonly stockSymbol: string
  readonly adminStatus?: string
  readonly tradingStatus?: string
}

interface MemberRow {
  readonly securitiesCode: string
  readonly appliedDate: number
  readonly reason: string
}

async function main(): Promise<void> {
  const tickers = process.argv.slice(2)

  if (tickers.length === 0) {
    console.error('usage: bun scripts/research-vn-supervision.ts TICKER [TICKER ...]')
    process.exit(EXIT_USAGE)
  }

  const watched = new Set(tickers)

  reportDivergence(await reportHsxStatuses(watched), await reportSsiBoards(watched))
  await reportVndirectEvents(tickers)
}

/** Every status the exchange publishes, each with the names standing under it, so the id table the
 *  adapter carries is enumerated rather than sampled — an id that has gone empty and one that has
 *  started filling both show here. */
async function reportHsxStatuses(watched: ReadonlySet<string>): Promise<ReadonlySet<string>> {
  const statuses = await fetchRows<StatusRow>(`${HSX_ENDPOINT}/securities/status-list`)
  const supervised = new Set<string>()

  if (statuses.length === 0) {
    console.log('\nhsx: unreachable or empty')

    return supervised
  }

  for (const status of statuses) {
    const members = await fetchRows<MemberRow>(
      `${HSX_ENDPOINT}/${HSX_LANGUAGE}/securities/stock-status?pageIndex=1&pageSize=${PAGE_SIZE}&statusListId=${status.id}`,
      ['data', 'list']
    )

    console.log(`\nhsx ${status.id} ${status.name}: ${members.length} row(s)`)

    for (const member of members) {
      const mark = watched.has(member.securitiesCode) ? '*' : ' '

      supervised.add(member.securitiesCode)
      console.log(`  ${mark} ${member.securitiesCode.padEnd(TICKER_COLUMN_WIDTH)} ${appliedDay(member.appliedDate)}`)
    }
  }

  return supervised
}

/** The broker board, printed as a count per `adminStatus/tradingStatus` pair: its admin table maps
 *  four codes and reads every other one as the mildest supervision, so a code that has started
 *  filling shows here rather than inside that fallback. */
async function reportSsiBoards(watched: ReadonlySet<string>): Promise<ReadonlySet<string>> {
  const supervised = new Set<string>()

  for (const board of SSI_BOARDS) {
    const rows = await fetchRows<BoardRow>(`${SSI_ENDPOINT}/${board}`)

    console.log(`\nssi ${board}: ${rows.length} row(s)`)
    const counts = new Map<string, number>()

    for (const row of rows) {
      const code = `${row.adminStatus ?? '?'}/${row.tradingStatus ?? '?'}`

      counts.set(code, (counts.get(code) ?? 0) + 1)

      if (board === SSI_COMPARABLE_BOARD && isSupervised(row)) {
        supervised.add(row.stockSymbol)
      }

      if (watched.has(row.stockSymbol)) {
        console.log(`  * ${row.stockSymbol.padEnd(TICKER_COLUMN_WIDTH)} ${code}`)
      }
    }

    for (const [code, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) {
      console.log(`  ${code.padEnd(CODE_COLUMN_WIDTH)} ${count}`)
    }
  }

  return supervised
}

function isSupervised(row: BoardRow): boolean {
  return (
    (row.adminStatus !== undefined && row.adminStatus !== NORMAL_ADMIN_STATUS) ||
    (row.tradingStatus !== undefined && row.tradingStatus !== NORMAL_TRADING_STATUS)
  )
}

/** Whether the broker board still matches the exchange today. A name the exchange supervises and
 *  the board calls normal reads as clean on every pass the exchange's own list is missing from. */
function reportDivergence(hsx: ReadonlySet<string>, ssi: ReadonlySet<string>): void {
  const hsxOnly = [...hsx].filter((code) => !ssi.has(code)).sort()
  const ssiOnly = [...ssi].filter((code) => !hsx.has(code)).sort()

  console.log(`\nhose supervised: hsx ${hsx.size} vs ssi ${ssi.size}`)
  console.log(`  hsx only: ${hsxOnly.join(' ') || '(none)'}`)
  console.log(`  ssi only: ${ssiOnly.join(' ') || '(none)'}`)
}

/** The provider the events adapter already speaks, probed per name because it publishes dated rows
 *  rather than a standing status. Prints nothing but the absence when it cannot be reached. */
async function reportVndirectEvents(tickers: readonly string[]): Promise<void> {
  const seen = new Map<string, Set<string>>()

  for (const ticker of tickers) {
    const events = await fetchRows<EventRow>(
      `${VNDIRECT_ENDPOINT}/events?q=code:${ticker}~locale:${EVENT_LOCALE}~effectiveDate:gte:${FROM_DAY}&size=${PAGE_SIZE}&sort=effectiveDate`
    )

    console.log(`\nvndirect ${ticker}: ${events.length} event(s)`)

    for (const event of events) {
      console.log(
        `  ${event.effectiveDate}  ${event.type.padEnd(CODE_COLUMN_WIDTH)} ${event.typeDesc}`
      )
      const descs = seen.get(event.type) ?? new Set<string>()
      descs.add(event.typeDesc)
      seen.set(event.type, descs)
    }
  }

  console.log('\nvndirect distinct event types')

  for (const [type, descs] of [...seen.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${type.padEnd(CODE_COLUMN_WIDTH)} ${[...descs].join(' | ')}`)
  }
}

/** Epoch seconds, which is what the listing service stamps a decision with. */
function appliedDay(seconds: number): string {
  return Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString().slice(0, 'YYYY-MM-DD'.length)
    : '?'
}

/** A provider that refuses, times out or answers with something other than rows reports as empty:
 *  the point of the probe is which providers answer at all, so one being unreachable must not stop
 *  the others from printing. `path` walks the two envelopes these providers use — `{data: [...]}`
 *  and `{data: {list: [...]}}`. */
async function fetchRows<T>(url: string, path: readonly string[] = ['data']): Promise<readonly T[]> {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      console.error(`  ! ${url}: HTTP ${response.status}`)

      return []
    }

    const rows = walk(await response.json(), path)

    // why-safe: a research script prints what the provider sent; a malformed row surfaces as an
    // `undefined` field in the printout rather than a crash.
    return Array.isArray(rows) ? (rows as readonly T[]) : []
  } catch (err: unknown) {
    console.error(`  ! ${url}: ${String(err)}`)

    return []
  }
}

function walk(body: unknown, path: readonly string[]): unknown {
  let node = body

  for (const key of path) {
    if (typeof node !== 'object' || node === null || !(key in node)) {
      return undefined
    }

    node = Reflect.get(node, key)
  }

  return node
}

await main()

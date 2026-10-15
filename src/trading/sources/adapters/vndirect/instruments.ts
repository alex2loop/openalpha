import { z } from 'zod'

import type { Caveat, InstrumentStatus } from '@/trading/kernel/caveat'
import type { InstrumentKind, Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { RowTarget } from '@/trading/sources/rows/row-target'
import type { SourceFetchOutcome, SourceHttp } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { ticker, tradingDay } from '@/trading/kernel/instrument'
import { DEFAULT_PAGE_SIZE, VND, VNDIRECT_ID } from '@/trading/sources/adapters/vndirect/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  canonicalSector,
  dropInvalid,
  fromCodeTable,
  pageRows,
  parseRow,
  untrustedText,
} from '@/trading/sources/rows/normalization'
import { resolveRowTarget } from '@/trading/sources/rows/row-target'

// A type or status outside these tables is dropped, never coerced into `equity`/`active`. The
// endpoint has no `INDEX` or `FU` rows: futures are typed `DERIVATIVE`, indices are absent.
const INSTRUMENT_KINDS = Object.freeze({
  STOCK: 'equity',
  ETF: 'etf',
  IFC: 'etf',
  DERIVATIVE: 'future',
} as const satisfies Readonly<Record<string, InstrumentKind>>)

const INSTRUMENT_STATUSES = Object.freeze({
  listed: 'active',
  suspended: 'halted',
  halted: 'halted',
  delisted: 'delisted',
} as const satisfies Readonly<Record<string, InstrumentStatus>>)

// Verified against the live endpoint (2026-08): a /v4/stocks row carries only code, type, floor,
// isin, status, companyName, companyNameEng, shortName, shortNameEng, listedDate, companyId,
// taxCode, faceValue, and fundType on fund rows. Sectors come from the classification join below —
// this payload has none.
const INSTRUMENT_ROW = z.object({
  code: z.string().min(1),
  companyName: z.string().min(1).optional(),
  shortName: z.string().min(1).optional(),
  type: z.string().min(1),
  status: z.string().min(1).optional(),
  floor: z.string().min(1).optional(),
  listedDate: z.string().min(1).optional(),
  fundType: z.string().min(1).optional(),
})

// ICB level 2, the super-sector (~19 buckets), is the granularity every sector consumer shares:
// level 3 fragments most buckets below the sector roll-up's member minimum. One page covers it.
const CLASSIFICATION_QUERY = 'industryLevel:2'
const CLASSIFICATION_PAGE_SIZE = 60

const CLASSIFICATION_ROW = z.object({
  englishName: z.string().min(1),
  codeList: z.string(),
})

// `~` is the endpoint's AND. Unfiltered by floor it answers ~14k unlisted OTC companies, none of
// them screenable; HOSE and HNX are the boards the market admits, and the VN30 futures list on the
// second. Status stays open: delisted rows are what stop a dead ticker resolving.
const UNIVERSE_QUERY = 'type:STOCK,ETF,IFC,DERIVATIVE~floor:HOSE,HNX'

/** The VN instrument universe: the record set detection, liquidity, sector, ETF, breadth, and
 *  screen all read. This adapter only normalizes; the market owns coverage and scope replacement. */
export function instrumentsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VNDIRECT_ID,
    kind: 'instruments',
    http: options.http,
    covers: () => true,
    load: (context, signal) => loadInstruments(options.http, context, signal),
  })
}

/** The universe list and the sector taxonomy are two endpoints of one provider, fetched together
 *  because the stock list carries no sector field. The taxonomy is best-effort: its
 *  failure costs the sectors on this refresh, never the universe itself. */
async function loadInstruments(
  http: SourceHttp,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<readonly InstrumentRecord[]>>> {
  const [page, taxonomy] = await Promise.all([
    http.getJsonPages(
      {
        sourceId: VNDIRECT_ID,
        path: '/v4/stocks',
        // Unsorted paging is unstable: rows repeat across pages and whatever they displace is lost.
        query: { q: UNIVERSE_QUERY, sort: 'code', size: String(DEFAULT_PAGE_SIZE) },
        pageSize: DEFAULT_PAGE_SIZE,
        signal,
      },
      pageRows
    ),
    fetchSectorMap(http, signal),
  ])

  if (page.kind === 'error') {
    return page
  }

  const parsed = toInstruments(
    page.value,
    resolveRowTarget(context, page.fetchedAt),
    taxonomy.sectors
  )

  return {
    kind: 'ok',
    value: parsedSource(parsed.value, [...parsed.caveats, ...taxonomy.caveats]),
    fetchedAt: page.fetchedAt,
    ...(page.truncated ? { truncated: true } : {}),
  }
}

interface SectorMapOutcome {
  readonly sectors: ReadonlyMap<Ticker, string>
  readonly caveats: readonly Caveat[]
}

async function fetchSectorMap(http: SourceHttp, signal: AbortSignal): Promise<SectorMapOutcome> {
  const outcome = await http.getJson(
    {
      sourceId: VNDIRECT_ID,
      path: '/v4/industry_classification',
      query: { q: CLASSIFICATION_QUERY, size: String(CLASSIFICATION_PAGE_SIZE) },
      signal,
    },
    pageRows
  )

  if (outcome.kind === 'error') {
    return { sectors: new Map(), caveats: [{ code: 'source.sector-map-unavailable' }] }
  }

  return { sectors: toSectorMap(outcome.value), caveats: [] }
}

/** First super-sector wins on overlap: the provider lists a ticker once almost always, and a
 *  duplicate is a data quirk, not a vote. */
function toSectorMap(rows: readonly unknown[]): ReadonlyMap<Ticker, string> {
  const sectors = new Map<Ticker, string>()
  const parsed = dropInvalid(rows, (raw) => parseRow(CLASSIFICATION_ROW, raw, 'vndirect sector'))

  for (const row of parsed) {
    const sector = canonicalSector(row.englishName)

    if (sector === undefined) {
      continue
    }

    for (const code of row.codeList.split(',')) {
      const key = toTicker(code)

      if (key !== undefined && !sectors.has(key)) {
        sectors.set(key, sector)
      }
    }
  }

  return sectors
}

/** A malformed code in a comma-joined list costs that code, never the whole taxonomy. */
function toTicker(raw: string): Ticker | undefined {
  try {
    return ticker(raw)
  } catch {
    return undefined
  }
}

function toInstruments(
  rows: readonly unknown[],
  target: RowTarget,
  sectors: ReadonlyMap<Ticker, string>
): ParsedSource<readonly InstrumentRecord[]> {
  const parsed = dropInvalid(rows, (row) => toInstrument(row, target, sectors))

  return parsedSource(
    parsed.map((entry) => entry.value),
    parsed.flatMap((entry) => entry.caveats)
  )
}

function toInstrument(
  raw: unknown,
  target: RowTarget,
  sectors: ReadonlyMap<Ticker, string>
): ParsedSource<InstrumentRecord> {
  const row = parseRow(INSTRUMENT_ROW, raw, 'vndirect instrument')
  const kind = kindFor(row.type)

  if (!kind) {
    // ValidationError so `dropInvalid` drops the row: the endpoint carries types no screen reads.
    throw new ValidationError(`vndirect instrument type ${row.type} has no mapped kind`)
  }

  // `fundType` marks an open-ended fund: listed as HOSE but priced at NAV on OTC, so no exchange
  // series exists for it and every evidence kind would score it a permanent miss.
  if (row.fundType !== undefined) {
    throw new ValidationError(`vndirect instrument ${row.code} is an open-ended fund`)
  }

  // Provider-supplied names reach a model through screens and briefs, like a headline does.
  const name = untrustedText(row.companyName ?? row.shortName ?? row.code, 'companyName')
  const code = ticker(row.code)
  const sector = sectors.get(code)
  const listedOn = toTradingDay(row.listedDate)

  return parsedSource(
    {
      instrument: { market: target.market, ticker: code },
      name: name.value,
      kind,
      status: statusFor(row.status),
      currency: VND,
      ...(row.floor === undefined ? {} : { exchange: row.floor }),
      ...(sector === undefined ? {} : { sector }),
      ...(listedOn === undefined ? {} : { listedOn }),
      sourceId: VNDIRECT_ID,
      fetchedAt: target.fetchedAt,
    },
    name.caveats
  )
}

/** A malformed optional date costs the field, not the row: `dropInvalid` would otherwise discard a
 *  tradeable name over a listing date, and the name would vanish from the screened universe. */
function toTradingDay(raw: string | undefined): TradingDay | undefined {
  if (raw === undefined) {
    return undefined
  }

  try {
    return tradingDay(raw)
  } catch {
    return undefined
  }
}

function kindFor(type: string): InstrumentKind | undefined {
  return fromCodeTable(INSTRUMENT_KINDS, type)
}

// Unrecognized or absent is `unknown`, never `active`: a screen must not trade a halted name
// because its status string changed shape.
function statusFor(status: string | undefined): InstrumentStatus {
  if (status === undefined) {
    return 'unknown'
  }

  return fromCodeTable(INSTRUMENT_STATUSES, status.toLowerCase()) ?? 'unknown'
}

import type { ProgressReporter } from '@/core/types/command'
import type { AnalystDeps, AnalystSession } from '@/trading/features/themes/analyst/ask'
import type { CompanyFacts } from '@/trading/features/themes/chain/company-facts'
import type { ChainContext } from '@/trading/features/themes/chain/context'
import type { ChainDeps, ChainRequest } from '@/trading/features/themes/chain/deps'
import type {
  EvidenceKind,
  SectorRead,
  StockRead,
  Theme,
  ThemeBundle,
  ThemeGap,
  ThemeRead,
  ThemeRunNote,
} from '@/trading/features/themes/types'
import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import { assertNotAborted, ValidationError } from '@/core/errors'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { analyseCompany, mapThemeSectors } from '@/trading/features/themes/analyst/steps'
import { readCompanyFacts } from '@/trading/features/themes/chain/company-facts'
import { readBars } from '@/trading/features/themes/chain/company-market'
import { guardChainRead, readChainContext } from '@/trading/features/themes/chain/context'
import { buildSectorFacts, buildSectorFigures } from '@/trading/features/themes/chain/sector-facts'
import { shortlistSector } from '@/trading/features/themes/chain/shortlist'
import { THEME_BENCHMARK } from '@/trading/features/themes/types'

/** Companies read, and analysed, at a time. */
const COMPANY_CONCURRENCY = 3

interface ChainStageDeps {
  readonly chain: ChainDeps
  readonly analyst: AnalystDeps
}

export interface ChainTheme {
  readonly theme: Theme
  readonly read: ThemeRead
}

interface ChainInput {
  readonly themes: readonly ChainTheme[]
  readonly bundle: ThemeBundle
  readonly session: AnalystSession
  readonly now: number
  readonly progress?: ProgressReporter
}

export interface ChainResults {
  readonly sectorReads: readonly SectorRead[]
  readonly stockReads: readonly StockRead[]
  readonly notes: readonly ThemeRunNote[]
  readonly gaps: readonly ThemeGap[]
}

interface MappedTheme {
  readonly entry: ChainTheme
  readonly reads: readonly SectorRead[]
}

interface StockJob {
  readonly entry: ChainTheme
  readonly sector: SectorRead
  readonly ticker: Ticker
  readonly quality: number
}

interface StepOutcome<T> {
  readonly values: readonly T[]
  readonly notes: readonly ThemeRunNote[]
}

/** Shared by the company jobs of one run, so the first budget halt reaches every later job. */
interface StockHalt {
  spent: boolean
}

type StockOutcome =
  | { readonly kind: 'value'; readonly value: StockRead }
  | { readonly kind: 'note'; readonly note: ThemeRunNote }

interface FactsRead {
  readonly facts: ReadonlyMap<Ticker, CompanyFacts>
  readonly gaps: readonly EvidenceKind[]
}

const NO_FACTS: FactsRead = Object.freeze({ facts: new Map(), gaps: [] })
const BENCHMARK_GAP: readonly EvidenceKind[] = Object.freeze(['price'])
const NO_CHAIN: ChainResults = Object.freeze({
  sectorReads: [],
  stockReads: [],
  notes: [],
  gaps: [],
})

/** Theme -> sector -> company, only for themes this run read as active. Sector calls may research,
 *  so they go one at a time like the updates; the first budget halt ends the stage, and every step
 *  it skips is named. */
export async function runChain(deps: ChainStageDeps, input: ChainInput): Promise<ChainResults> {
  if (input.themes.length === 0) {
    return NO_CHAIN
  }

  const request: ChainRequest = { now: input.now, signal: input.session.signal }
  const context = await readChainContext(deps.chain, request)

  if (context === undefined) {
    return { ...NO_CHAIN, gaps: ['screen'] }
  }

  const mapped = await mapAllSectors(deps.analyst, context, input)
  const jobs = mapped.values.flatMap((theme) => toStockJobs(theme, context))
  const spent = isBudgetSpent(mapped.notes)
  // No company call follows a spent budget, so its figures are not fetched either.
  const read = spent ? NO_FACTS : await readAllFacts(deps.chain, context, { jobs, input, request })
  const stocks = await analyseAllStocks(deps.analyst, {
    jobs,
    facts: read.facts,
    chain: input,
    spent,
  })

  return {
    sectorReads: mapped.values.flatMap((theme) => theme.reads),
    stockReads: stocks.values,
    notes: [...mapped.notes, ...stocks.notes],
    gaps: [...context.gaps, ...read.gaps],
  }
}

async function mapAllSectors(
  deps: AnalystDeps,
  context: ChainContext,
  input: ChainInput
): Promise<StepOutcome<MappedTheme>> {
  const facts = buildSectorFacts(context)
  const figures = buildSectorFigures(context)
  const values: MappedTheme[] = []
  const notes: ThemeRunNote[] = []

  for (const entry of input.themes) {
    const themeId = entry.theme.id

    assertNotAborted(input.session.signal)

    if (isBudgetSpent(notes)) {
      notes.push({ level: 'sector', themeId, cause: 'budget' })
    } else {
      input.progress?.('trading.progress.themes.sectors', { title: entry.theme.title })

      const result = await mapThemeSectors(deps, {
        ...entry,
        bundle: input.bundle,
        facts,
        figures,
        session: input.session,
      })

      if (result.kind === 'value') {
        values.push({ entry, reads: result.value })
      } else {
        notes.push({ level: 'sector', themeId, ...result.failure })
      }
    }
  }

  return { values, notes }
}

function toStockJobs(theme: MappedTheme, context: ChainContext): readonly StockJob[] {
  return theme.reads
    .filter((read) => read.effect === 'benefits')
    .flatMap((sector) =>
      shortlistSector(context, sector.sector).map((name) => ({
        entry: theme.entry,
        sector,
        ticker: name.ticker,
        quality: name.quality,
      }))
    )
}

/** One read per name, however many themes shortlisted it. Without the index no name's return can
 *  be read against it, so a missing benchmark is a `price` gap rather than silence. */
async function readAllFacts(
  deps: ChainDeps,
  context: ChainContext,
  input: {
    readonly jobs: readonly StockJob[]
    readonly input: ChainInput
    readonly request: ChainRequest
  }
): Promise<FactsRead> {
  if (input.jobs.length === 0) {
    return NO_FACTS
  }

  input.input.progress?.('trading.progress.themes.companies')

  const tickers = [...new Set(input.jobs.map((job) => job.ticker))]
  const benchmark = await guardChainRead(deps, input.request, {
    kind: 'price',
    subject: THEME_BENCHMARK,
    read: () => readBenchmark(deps, { day: context.day, request: input.request }),
  })
  const facts = await mapWithConcurrency(tickers, COMPANY_CONCURRENCY, (name) =>
    readCompanyFacts(deps, {
      ticker: name,
      context,
      request: input.request,
      ...(benchmark === undefined ? {} : { benchmark }),
    })
  )

  return {
    facts: new Map(facts.map((entry) => [entry.ticker, entry])),
    gaps: benchmark === undefined ? BENCHMARK_GAP : [],
  }
}

/** Throws when the index has no bars, so the guard logs it like any failed read. */
async function readBenchmark(
  deps: ChainDeps,
  input: { readonly day: TradingDay; readonly request: ChainRequest }
): Promise<readonly Candle[]> {
  const bars = await readBars(deps, { ticker: THEME_BENCHMARK, ...input })

  if (bars === undefined) {
    throw new ValidationError(`no ${THEME_BENCHMARK} bars on or before ${input.day}`)
  }

  return bars
}

/** Company calls never research, so none holds the shared budget for a sibling: they run side by
 *  side, and the first budget halt stops any job not yet started. */
async function analyseAllStocks(
  deps: AnalystDeps,
  input: {
    readonly jobs: readonly StockJob[]
    readonly facts: ReadonlyMap<Ticker, CompanyFacts>
    readonly chain: ChainInput
    readonly spent: boolean
  }
): Promise<StepOutcome<StockRead>> {
  const halt = { spent: input.spent }
  const outcomes = await mapWithConcurrency(input.jobs, COMPANY_CONCURRENCY, (job) =>
    analyseStock(deps, { job, facts: input.facts.get(job.ticker), chain: input.chain, halt })
  )

  return {
    values: outcomes.flatMap((outcome) => (outcome.kind === 'value' ? [outcome.value] : [])),
    notes: outcomes.flatMap((outcome) => (outcome.kind === 'note' ? [outcome.note] : [])),
  }
}

/** Facts are read for every job unless the stage was already spent, so a job without them is one
 *  the budget never reached. */
async function analyseStock(
  deps: AnalystDeps,
  input: {
    readonly job: StockJob
    readonly facts: CompanyFacts | undefined
    readonly chain: ChainInput
    readonly halt: StockHalt
  }
): Promise<StockOutcome> {
  const { chain, facts, halt, job } = input

  assertNotAborted(chain.session.signal)

  if (halt.spent || facts === undefined) {
    return { kind: 'note', note: toStockNote(job, { cause: 'budget' }) }
  }

  chain.progress?.('trading.progress.themes.company', { ticker: job.ticker })

  const result = await analyseCompany(deps, {
    ...job.entry,
    sector: job.sector,
    quality: job.quality,
    bundle: chain.bundle,
    facts,
    session: chain.session,
  })

  if (result.kind === 'value') {
    return { kind: 'value', value: result.value }
  }

  halt.spent ||= result.failure.cause === 'budget'

  return { kind: 'note', note: toStockNote(job, result.failure) }
}

function toStockNote(job: StockJob, failure: Pick<ThemeRunNote, 'cause' | 'env'>): ThemeRunNote {
  return {
    level: 'stock',
    themeId: job.entry.theme.id,
    subject: job.ticker,
    sector: job.sector.sector,
    ...failure,
  }
}

function isBudgetSpent(notes: readonly ThemeRunNote[]): boolean {
  return notes.some((note) => note.cause === 'budget')
}

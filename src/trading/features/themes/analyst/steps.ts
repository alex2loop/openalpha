import type {
  AnalystDeps,
  AnalystResult,
  AnalystSession,
} from '@/trading/features/themes/analyst/ask'
import type { Proposal } from '@/trading/features/themes/analyst/checks'
import type { CompanyFacts } from '@/trading/features/themes/chain/company-facts'
import type {
  EvidenceItem,
  SectorFigures,
  SectorRead,
  StockRead,
  Theme,
  ThemeBundle,
  ThemeRead,
  ThemeSector,
} from '@/trading/features/themes/types'
import { askAnalyst } from '@/trading/features/themes/analyst/ask'
import {
  acceptProposals,
  checkCompany,
  checkSectors,
  checkUpdate,
} from '@/trading/features/themes/analyst/checks'
import {
  buildCompanyMessage,
  buildDiscoveryMessage,
  buildSectorMessage,
  buildUpdateMessage,
  THEME_INSTRUCTIONS,
} from '@/trading/features/themes/analyst/prompts'
import {
  THEME_COMPANY_REPLY,
  THEME_DISCOVERY_REPLY,
  THEME_SECTOR_REPLY,
  THEME_UPDATE_REPLY,
} from '@/trading/features/themes/analyst/schemas'
import { indexEvidence } from '@/trading/features/themes/evidence/bundle'

/** Names the discovery step in the log; never stored, so it cannot meet a theme id. */
const DISCOVERY_LOG_SUBJECT = 'discovery'

interface UpdateInput {
  readonly theme: Theme
  readonly previous?: ThemeRead
  readonly bundle: ThemeBundle
  readonly session: AnalystSession
}

interface DiscoveryInput {
  readonly themes: readonly Theme[]
  readonly bundle: ThemeBundle
  readonly session: AnalystSession
  readonly now: number
}

interface SectorInput {
  readonly theme: Theme
  readonly read: ThemeRead
  readonly bundle: ThemeBundle
  readonly facts: readonly EvidenceItem[]
  readonly figures: ReadonlyMap<ThemeSector, SectorFigures>
  readonly session: AnalystSession
}

interface CompanyInput {
  readonly theme: Theme
  readonly read: ThemeRead
  readonly sector: SectorRead
  readonly bundle: ThemeBundle
  readonly facts: CompanyFacts
  readonly quality: number
  readonly session: AnalystSession
}

function withModel<R>(
  result: AnalystResult<R>,
  stamp: (value: R, model: string) => R
): AnalystResult<R> {
  return result.kind === 'value' && result.model !== undefined
    ? { ...result, value: stamp(result.value, result.model) }
    : result
}

export async function updateTheme(
  deps: AnalystDeps,
  input: UpdateInput
): Promise<AnalystResult<ThemeRead>> {
  const index = indexEvidence(input.bundle.items)
  const result = await askAnalyst(deps, {
    subject: input.theme.id,
    instructions: THEME_INSTRUCTIONS,
    message: buildUpdateMessage(input.theme, { ...input, locale: input.session.locale }),
    reply: THEME_UPDATE_REPLY,
    check: (reply) =>
      checkUpdate(reply, {
        theme: input.theme,
        index,
        ...(input.previous === undefined ? {} : { previous: input.previous }),
      }),
    session: input.session,
    research: true,
  })

  return withModel(result, (read, model) => ({ ...read, model }))
}

export async function discoverThemes(
  deps: AnalystDeps,
  input: DiscoveryInput
): Promise<AnalystResult<readonly Proposal[]>> {
  const result = await askAnalyst(deps, {
    subject: DISCOVERY_LOG_SUBJECT,
    instructions: THEME_INSTRUCTIONS,
    message: buildDiscoveryMessage(input.themes, {
      bundle: input.bundle,
      locale: input.session.locale,
    }),
    reply: THEME_DISCOVERY_REPLY,
    check: (reply) =>
      acceptProposals(reply, {
        known: new Set(input.themes.map((theme) => theme.id)),
        index: indexEvidence(input.bundle.items),
        now: input.now,
      }),
    session: input.session,
    research: true,
  })

  return withModel(result, (proposals, model) =>
    proposals.map((entry) => ({ ...entry, read: { ...entry.read, model } }))
  )
}

export async function mapThemeSectors(
  deps: AnalystDeps,
  input: SectorInput
): Promise<AnalystResult<readonly SectorRead[]>> {
  const index = indexEvidence([...input.bundle.items, ...input.facts])
  const result = await askAnalyst(deps, {
    subject: `${input.theme.id}:sectors`,
    instructions: THEME_INSTRUCTIONS,
    message: buildSectorMessage(input.theme, { ...input, locale: input.session.locale }),
    reply: THEME_SECTOR_REPLY,
    check: (reply) =>
      checkSectors(reply, { themeId: input.theme.id, index, figures: input.figures }),
    session: input.session,
    research: true,
  })

  return withModel(result, (reads, model) => reads.map((read) => ({ ...read, model })))
}

/** The theme's own evidence travels as the items its read cited, not the whole bundle: the
 *  company step is about the company. */
export async function analyseCompany(
  deps: AnalystDeps,
  input: CompanyInput
): Promise<AnalystResult<StockRead>> {
  const cited = new Set(
    [...input.read.supporting, ...input.read.counter].flatMap((claim) => claim.evidence)
  )
  const themeItems = input.bundle.items.filter((item) => cited.has(item.id))
  const index = indexEvidence([...themeItems, ...input.facts.items])
  const result = await askAnalyst(deps, {
    subject: `${input.theme.id}:${input.facts.ticker}`,
    instructions: THEME_INSTRUCTIONS,
    message: buildCompanyMessage({ ...input, themeItems, locale: input.session.locale }),
    reply: THEME_COMPANY_REPLY,
    check: (reply) =>
      checkCompany(reply, {
        themeId: input.theme.id,
        sector: input.sector.sector,
        maturity: input.read.maturity,
        index,
        facts: input.facts,
        quality: input.quality,
      }),
    session: input.session,
    research: false,
  })
  const read = withModel(result, (value, model) => ({ ...value, model }))

  return read.kind === 'value'
    ? { ...read, value: { ...read.value, ticker: input.facts.ticker } }
    : read
}

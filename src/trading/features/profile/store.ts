import { z } from 'zod'

import type { Locale } from '@/core/types/locale'
import type { InstrumentRef, PortfolioSegment } from '@/trading/kernel/instrument'
import type { RiskCapSet, RiskLevel, UserProfile } from '@/trading/kernel/operator/profile'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted, StorageError } from '@/core/errors'
import { LOCALES } from '@/core/types/locale'
import { canonicalJson, sha256Hex } from '@/core/utils/hash'
import { seededPolicyNumbers } from '@/trading/features/profile/policy'
import { currencyCode, marketRef, portfolioSegment, ticker } from '@/trading/kernel/instrument'
import {
  INVESTMENT_GOALS,
  INVESTMENT_HORIZONS,
  RISK_LEVELS,
} from '@/trading/kernel/operator/profile'
import { toMember } from '@/trading/kernel/store/store-payload'
import { parseJson } from '@/trading/kernel/store/store-row'

// The table holds exactly one row: one operator, one profile.
const PROFILE_ROW_ID = 1

/** Shared with `doctor`, which reads it through a raw read-only handle before boot. */
export const PROFILE_CURRENCY_SQL = 'SELECT base_currency FROM trading_profiles LIMIT 1'

const UPSERT_SQL =
  'INSERT INTO trading_profiles (id, preferred_locale, base_currency, ' +
  'risk_capacity, risk_willingness, goal, payload) VALUES '
// `base_currency` is written on insert and never updated: the first persisted profile fixes it, so
// a later config change cannot reinterpret historical facts.
const UPSERT_SET =
  ' ON CONFLICT (id) DO UPDATE SET ' +
  'preferred_locale = excluded.preferred_locale, risk_capacity = excluded.risk_capacity, ' +
  'risk_willingness = excluded.risk_willingness, goal = excluded.goal, payload = excluded.payload'

const instrumentRefSchema = z.strictObject({ market: z.string(), ticker: z.string() })

const capSchema = z.strictObject({
  maximumPositionPctNav: z.number().finite(),
  maximumSegmentPctNav: z.number().finite(),
  maximumEtfPctNav: z.number().finite().optional(),
  minimumEtfPctNav: z.number().finite().optional(),
})

// The closed collections and policy numbers the profile is always read whole with; every field a
// query filters or orders on is a column instead. Not strict: a profile is operator data no reset
// regenerates, so a field the code has since dropped is ignored rather than making it unreadable.
const payloadSchema = z.object({
  watchlist: z.array(instrumentRefSchema),
  exclusions: z.array(instrumentRefSchema),
  segmentTargets: z.record(z.string(), z.number().finite()),
  // Absent and empty say the same thing: a profile that pinned nothing.
  pinnedTargets: z.record(z.string(), z.number().finite()).optional(),
  // Absent and empty say the same thing: a profile that asked for no ETF core.
  etfCores: z.record(z.string(), z.number().finite()).optional(),
  caps: z.record(z.string(), capSchema),
  horizons: z.record(z.string(), z.enum(INVESTMENT_HORIZONS)),
  // Optional so a profile predating any of them still reads; `seededPolicyNumbers` fills the gap.
  // The segment records above are reconciled the same way, against the registry rather than a seed.
  maximumSectorPctNav: z.number().finite().optional(),
  reservePctNav: z.number().finite().optional(),
  regimeScale: z.number().finite().optional(),
  riskPerTradePctNav: z.number().finite().optional(),
  maximumOpenRiskPctNav: z.number().finite().optional(),
  entryTranchePct: z.number().finite().optional(),
  takeProfitTranchePct: z.number().finite().optional(),
})

interface ProfileRow {
  readonly preferred_locale: string
  readonly base_currency: string
  readonly risk_capacity: string
  readonly risk_willingness: string
  readonly goal: string
  readonly payload: string
}

export interface ProfileStore {
  find(signal: AbortSignal): Promise<UserProfile | null>
  /** One statement for both the first write and every later one: with a singleton primary key there
   *  is no create-versus-update question left for a caller to get wrong. Returns the stored row, so
   *  what the operator is shown is the persisted row rather than a locally predicted one. */
  upsert(profile: UserProfile, signal: AbortSignal): Promise<UserProfile>
}

export function createProfileStore(deps: StoreDeps): ProfileStore {
  return {
    find: (signal) => find(deps, signal),
    upsert: (profile, signal) => upsert(deps, profile, signal),
  }
}

async function find(deps: StoreDeps, signal: AbortSignal): Promise<UserProfile | null> {
  assertNotAborted(signal)

  const rows = await deps.db.query<ProfileRow>(
    `SELECT * FROM trading_profiles WHERE id = ${deps.dialect.param(1)}`,
    [PROFILE_ROW_ID]
  )
  const row = rows[0]

  return row ? toProfile(row) : null
}

/** Last edit wins on the payload. A concurrent writer's fields can be overwritten, which is the
 *  deliberate trade for carrying no compare-and-swap: one operator editing one profile is
 *  better served by "apply my edit" than by "start over". A surrounding transaction would not buy
 *  the difference either — serializing a read against a later write needs `SELECT … FOR UPDATE`,
 *  which is dialect-specific SQL this codebase does not write. */
async function upsert(
  deps: StoreDeps,
  profile: UserProfile,
  signal: AbortSignal
): Promise<UserProfile> {
  assertNotAborted(signal)

  await deps.db.execute(`${UPSERT_SQL}(${deps.dialect.paramList(7)})${UPSERT_SET}`, [
    PROFILE_ROW_ID,
    profile.preferredLocale,
    profile.baseCurrency,
    profile.riskCapacity,
    profile.riskWillingness,
    profile.goal,
    JSON.stringify(toPayload(profile)),
  ])

  const stored = await find(deps, signal)

  if (stored === null) {
    throw new StorageError('trading profile vanished immediately after being written')
  }

  return stored
}

/** Which profile this is, as a digest of the row it would write. A derived artifact built against
 *  the profile keys its reuse on this: the operator closing a sleeve changes every target the
 *  artifact printed, and a cache keyed only on the day would serve the old ones back. Key order is
 *  sorted rather than inherited from whatever built the record, because a digest that drifted
 *  between two equal profiles would rebuild that artifact for nothing. */
export function profileRevisionOf(profile: UserProfile | null): Promise<string> {
  return sha256Hex(canonicalJson(profile === null ? null : toPayload(profile)))
}

function toPayload(profile: UserProfile): z.infer<typeof payloadSchema> {
  return {
    watchlist: [...profile.watchlist],
    exclusions: [...profile.exclusions],
    segmentTargets: { ...profile.segmentTargets },
    pinnedTargets: definedOnly(profile.pinnedTargets),
    etfCores: definedOnly(profile.etfCores),
    caps: { ...profile.caps },
    horizons: { ...profile.horizons },
    maximumSectorPctNav: profile.maximumSectorPctNav,
    reservePctNav: profile.reservePctNav,
    regimeScale: profile.regimeScale,
    riskPerTradePctNav: profile.riskPerTradePctNav,
    maximumOpenRiskPctNav: profile.maximumOpenRiskPctNav,
    entryTranchePct: profile.entryTranchePct,
    takeProfitTranchePct: profile.takeProfitTranchePct,
  }
}

/** Only the sleeves that carry a number. A partial record's values read as possibly absent, and a
 *  key stored with no number is a pin or a core nothing could later apply. */
function definedOnly(
  record: Readonly<Partial<Record<PortfolioSegment, number>>>
): Record<string, number> {
  const entries: [string, number][] = []

  for (const [segment, value] of Object.entries(record)) {
    if (value !== undefined) {
      entries.push([segment, value])
    }
  }

  return Object.fromEntries(entries)
}

function toProfile(row: ProfileRow): UserProfile {
  const payload = parseJson(row.payload, 'trading profile', (value) => payloadSchema.parse(value))
  const riskCapacity = toRiskLevel(row.risk_capacity)
  const riskWillingness = toRiskLevel(row.risk_willingness)
  const riskLevel = lowerRisk(riskCapacity, riskWillingness)
  const seeded = seededPolicyNumbers(riskLevel)

  return {
    preferredLocale: toLocale(row.preferred_locale),
    baseCurrency: currencyCode(row.base_currency),
    // The conservative floor of the two inputs; storing it would be a third copy free to disagree.
    riskLevel,
    riskCapacity,
    riskWillingness,
    horizons: toSegmentRecord(payload.horizons, (horizon) => horizon),
    goal: toMember(row.goal, INVESTMENT_GOALS, 'investment goal'),
    watchlist: payload.watchlist.map(toInstrumentRef),
    exclusions: payload.exclusions.map(toInstrumentRef),
    segmentTargets: toSegmentRecord(payload.segmentTargets, (target) => target),
    pinnedTargets: toSegmentRecord(payload.pinnedTargets ?? {}, (target) => target),
    etfCores: toSegmentRecord(payload.etfCores ?? {}, (core) => core),
    caps: toSegmentRecord(payload.caps, toCap),
    maximumSectorPctNav: payload.maximumSectorPctNav ?? seeded.maximumSectorPctNav,
    reservePctNav: payload.reservePctNav ?? seeded.reservePctNav,
    regimeScale: payload.regimeScale ?? seeded.regimeScale,
    riskPerTradePctNav: payload.riskPerTradePctNav ?? seeded.riskPerTradePctNav,
    maximumOpenRiskPctNav: payload.maximumOpenRiskPctNav ?? seeded.maximumOpenRiskPctNav,
    entryTranchePct: payload.entryTranchePct ?? seeded.entryTranchePct,
    takeProfitTranchePct: payload.takeProfitTranchePct ?? seeded.takeProfitTranchePct,
  }
}

function lowerRisk(capacity: RiskLevel, willingness: RiskLevel): RiskLevel {
  return RISK_LEVELS.indexOf(capacity) <= RISK_LEVELS.indexOf(willingness) ? capacity : willingness
}

function toRiskLevel(raw: string): RiskLevel {
  return toMember(raw, RISK_LEVELS, 'risk level')
}

function toLocale(raw: string): Locale {
  return toMember(raw, LOCALES, 'locale')
}

function toInstrumentRef(raw: z.infer<typeof instrumentRefSchema>): InstrumentRef {
  return { market: marketRef(raw.market), ticker: ticker(raw.ticker) }
}

/** Rebuilt without the absent key: zod's parsed optional is `number | undefined`, which
 *  exactOptionalPropertyTypes rejects against the domain's `maximumEtfPctNav?: number`. */
function toCap(raw: z.infer<typeof capSchema>): RiskCapSet {
  return {
    maximumPositionPctNav: raw.maximumPositionPctNav,
    maximumSegmentPctNav: raw.maximumSegmentPctNav,
    ...(raw.maximumEtfPctNav === undefined ? {} : { maximumEtfPctNav: raw.maximumEtfPctNav }),
    ...(raw.minimumEtfPctNav === undefined ? {} : { minimumEtfPctNav: raw.minimumEtfPctNav }),
  }
}

function toSegmentRecord<Raw, T>(
  raw: Readonly<Record<string, Raw>>,
  toValue: (value: Raw) => T
): Readonly<Record<PortfolioSegment, T>> {
  const entries = Object.entries(raw).map(([key, value]): [PortfolioSegment, T] => [
    portfolioSegment(key),
    toValue(value),
  ])

  return Object.fromEntries(entries)
}

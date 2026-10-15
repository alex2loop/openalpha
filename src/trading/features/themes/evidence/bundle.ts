import type {
  EvidenceDeps,
  EvidencePart,
  EvidenceRequest,
} from '@/trading/features/themes/evidence/deps'
import type {
  EvidenceItem,
  EvidenceKind,
  ThemeBundle,
  ThemeGap,
} from '@/trading/features/themes/types'
import { formatErrForLog } from '@/core/security/credentials'
import { readMacro } from '@/trading/features/themes/evidence/macro'
import { readCommodities, readSectors } from '@/trading/features/themes/evidence/market'
import { readNews } from '@/trading/features/themes/evidence/news'
import { EVIDENCE_KINDS, NEWS_CAPPED_GAP } from '@/trading/features/themes/types'

const EVIDENCE_ID_PREFIX: Readonly<Record<EvidenceKind, string>> = Object.freeze({
  macro: 'M',
  commodity: 'C',
  sector: 'S',
  news: 'N',
  valuation: 'V',
  accounts: 'A',
  price: 'P',
  headlines: 'H',
})
/** Hard data can found a theme; a headline or a price move alone cannot. */
const HARD_EVIDENCE_KINDS: ReadonlySet<EvidenceKind> = new Set(['macro', 'commodity'])
const EVIDENCE_KIND_BY_PREFIX: ReadonlyMap<string, EvidenceKind> = new Map(
  EVIDENCE_KINDS.map((kind) => [EVIDENCE_ID_PREFIX[kind], kind])
)
/** News and headlines are stories; every other kind is a figure. */
const STORY_EVIDENCE_KINDS: ReadonlySet<EvidenceKind> = new Set(['news', 'headlines'])
const ID_NUMBER_RE = /\d+$/

interface GuardedPart {
  readonly kind: EvidenceKind
  read(): Promise<EvidencePart>
}

/** One unreadable provider never sinks the run: its kind is reported missing, never read as zero. */
async function guardPart(
  deps: EvidenceDeps,
  request: EvidenceRequest,
  part: GuardedPart
): Promise<EvidencePart> {
  try {
    return await part.read()
  } catch (err: unknown) {
    if (request.signal.aborted) {
      throw err
    }

    deps.logger.warn('trading.theme_evidence_failed', {
      kind: part.kind,
      err: formatErrForLog(err),
    })

    return { kind: part.kind, drafts: [], missing: true }
  }
}

/** Only the news list is ever cut; any other kind is whole or missing. */
function toGaps(part: EvidencePart): readonly ThemeGap[] {
  if (part.missing) {
    return [part.kind]
  }

  return part.capped === true ? [NEWS_CAPPED_GAP] : []
}

/** Ids restart per kind and per call, so one prompt never carries two items under one id. */
export function toEvidenceItems(
  part: Pick<EvidencePart, 'kind' | 'drafts'>
): readonly EvidenceItem[] {
  return part.drafts.map((draft, index) => ({
    ...draft,
    id: `${EVIDENCE_ID_PREFIX[part.kind]}${index + 1}`,
  }))
}

export async function buildEvidenceBundle(
  deps: EvidenceDeps,
  request: EvidenceRequest
): Promise<ThemeBundle> {
  const parts = await Promise.all([
    guardPart(deps, request, { kind: 'macro', read: () => readMacro(deps, request) }),
    guardPart(deps, request, { kind: 'commodity', read: () => readCommodities(deps, request) }),
    guardPart(deps, request, { kind: 'sector', read: () => readSectors(deps, request) }),
    guardPart(deps, request, { kind: 'news', read: () => readNews(deps, request) }),
  ])

  return {
    builtAt: request.now,
    items: parts.flatMap(toEvidenceItems),
    gaps: parts.flatMap(toGaps),
  }
}

export function indexEvidence(items: readonly EvidenceItem[]): ReadonlyMap<string, EvidenceItem> {
  return new Map(items.map((item) => [item.id, item]))
}

export function isHardEvidence(item: EvidenceItem | undefined): boolean {
  return item !== undefined && HARD_EVIDENCE_KINDS.has(item.kind)
}

/** Whether a cited id names a figure (a series, a price, the accounts) rather than a story. Read
 *  off the id's prefix, so it holds for any step's ids without that step's index. */
export function isFigureId(id: string): boolean {
  const kind = EVIDENCE_KIND_BY_PREFIX.get(id.replace(ID_NUMBER_RE, ''))

  return kind !== undefined && !STORY_EVIDENCE_KINDS.has(kind)
}

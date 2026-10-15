import { isPlainRecord } from '@/core/utils/collections'

import type { AdmittedEvidence, ReportSection, ResearchClaim } from './model'
import type { ResearchReportCandidate } from './schemas'
import { REPORT_SECTIONS } from './model'
import { decodeResearchPayload } from './parse'
import { REPORT_SECTION_LIMITS, ResearchReportCandidateSchema } from './schemas'

const INTEGER_TEXT_RE = /^-?\d+$/

// The synthesizer's recurring schema misses — claim ids or 0-based indexes instead of 1-based
// positions, stray keys, a section as prose — remap or prune exactly against the admitted claims.
// Undefined when nothing usable survives; the caller keeps the invalid-output path.
export function salvageReportCandidate(
  raw: string,
  evidence: AdmittedEvidence
): { readonly value: ResearchReportCandidate; readonly dropped: number } | undefined {
  const decoded = decodeResearchPayload(raw)

  if (decoded.kind === 'invalid' || !isPlainRecord(decoded.value)) {
    return undefined
  }

  const positionsBySection = claimPositionsBySection(evidence.claims)
  const sections: Partial<Record<ReportSection, readonly number[]>> = {}
  let dropped = 0

  for (const section of REPORT_SECTIONS) {
    const entries: unknown = decoded.value[section]
    const mapped: number[] = []

    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const position = toSectionPosition(entry, positionsBySection.get(section))

        if (position === undefined) {
          dropped += 1
        } else {
          mapped.push(position)
        }
      }
    }

    const shifted = toOneBasedPositions(mapped)
    const limit = REPORT_SECTION_LIMITS[section]
    sections[section] = shifted.slice(0, limit)
    dropped += Math.max(0, shifted.length - limit)
  }

  const parsed = ResearchReportCandidateSchema.safeParse(sections)
  return parsed.success ? { value: parsed.data, dropped } : undefined
}

// Claim id → 1-based position within its own section's list, in admission order.
function claimPositionsBySection(
  claims: readonly ResearchClaim[]
): ReadonlyMap<ReportSection, ReadonlyMap<string, number>> {
  const grouped = new Map<ReportSection, Map<string, number>>()

  for (const section of REPORT_SECTIONS) {
    grouped.set(section, new Map())
  }

  for (const claim of claims) {
    const positions = grouped.get(claim.section)
    positions?.set(claim.id, positions.size + 1)
  }

  return grouped
}

function toSectionPosition(
  entry: unknown,
  positionsById: ReadonlyMap<string, number> | undefined
): number | undefined {
  if (typeof entry === 'number' && Number.isInteger(entry)) {
    return entry
  }

  if (typeof entry !== 'string') {
    return undefined
  }

  const trimmed = entry.trim()
  const mapped = positionsById?.get(trimmed)

  if (mapped !== undefined) {
    return mapped
  }

  return INTEGER_TEXT_RE.test(trimmed) ? Number(trimmed) : undefined
}

// A list containing 0 is 0-based throughout.
function toOneBasedPositions(positions: readonly number[]): readonly number[] {
  return positions.includes(0) ? positions.map((position) => position + 1) : positions
}

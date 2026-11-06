import { z } from 'zod'

import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import { currencyCode, marketRef, tradingDay } from '@/trading/kernel/instrument'
import { BRIEF_FIELDS, BRIEF_SECTION_ORDER } from '@/trading/kernel/operator/brief-section'
import { caveatsSchema, provenanceSchema, toProvenance } from '@/trading/kernel/store/store-payload'

const readySectionSchema = z.strictObject({
  kind: z.enum(BRIEF_SECTION_ORDER),
  status: z.literal('ready'),
  market: z.string().optional(),
  icon: z.string().optional(),
  asOf: z.string().optional(),
  // `partialRecord`, not `record`: a row carries whichever fields its section fills, and Zod v4's
  // `record` with an enum key requires every one of them. The enum is the point — a row naming a
  // field this build no longer has is a snapshot from an older vocabulary, and rejecting it here is
  // what sends the service back to rebuild instead of rendering a field the catalog cannot name.
  rows: z.array(z.partialRecord(z.enum(BRIEF_FIELDS), z.union([z.string(), z.number()]))),
  currency: z.string().optional(),
  titleParams: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  provenance: z.array(provenanceSchema),
  caveats: caveatsSchema,
})

const absentSectionSchema = z.strictObject({
  kind: z.enum(BRIEF_SECTION_ORDER),
  status: z.enum(['unavailable', 'omitted-by-policy']),
  market: z.string().optional(),
  icon: z.string().optional(),
  asOf: z.string().optional(),
  caveats: caveatsSchema,
})

/** Section order is the stored order: the composer decides it once and a reader never re-sorts. */
export const briefSectionsSchema = z.array(z.union([readySectionSchema, absentSectionSchema]))

export function toBriefSections(
  raw: z.infer<typeof briefSectionsSchema>
): readonly BriefSectionResult[] {
  return raw.map(toSection)
}

function toSection(raw: z.infer<typeof briefSectionsSchema>[number]): BriefSectionResult {
  if (raw.status === 'ready') {
    return {
      kind: raw.kind,
      status: raw.status,
      ...(raw.market === undefined ? {} : { market: marketRef(raw.market) }),
      ...(raw.icon === undefined ? {} : { icon: raw.icon }),
      ...(raw.asOf === undefined ? {} : { asOf: tradingDay(raw.asOf) }),
      rows: raw.rows,
      ...(raw.currency === undefined ? {} : { currency: currencyCode(raw.currency) }),
      ...(raw.titleParams === undefined ? {} : { titleParams: raw.titleParams }),
      provenance: raw.provenance.map(toProvenance),
      caveats: raw.caveats,
    }
  }

  return {
    kind: raw.kind,
    status: raw.status,
    ...(raw.market === undefined ? {} : { market: marketRef(raw.market) }),
    ...(raw.icon === undefined ? {} : { icon: raw.icon }),
    ...(raw.asOf === undefined ? {} : { asOf: tradingDay(raw.asOf) }),
    caveats: raw.caveats,
  }
}

import { z } from 'zod'

import type { Caveat } from '@/trading/kernel/caveat'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import { StorageError } from '@/core/errors'
import { type CaveatCode, isCaveatCode } from '@/trading/kernel/caveat'
import { sourceId } from '@/trading/kernel/source/source-id'
import { SOURCE_FRESHNESS } from '@/trading/kernel/source/source-result'

/** Caveats and provenance are stored as codes and stamps, never as localized prose: the renderer
 *  owns wording, so a locale change must not require rewriting history. */
const caveatSchema = z.strictObject({
  code: z.string(),
  detail: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
})

/** A code the catalog has since retired is dropped on read, the way the renderer drops a message it
 *  can no longer fill. Refusing the whole row instead held every ticker with an old caveat for the
 *  day, and `force` could not get past a row it could not read. */
export const caveatsSchema = z
  .array(caveatSchema)
  .transform((rows): readonly Caveat[] =>
    rows.flatMap((row) => (isCaveatCode(row.code) ? [toCaveat(row.code, row.detail)] : []))
  )

export const provenanceSchema = z.strictObject({
  sourceId: z.string(),
  fetchedAt: z.number().finite(),
  freshness: z.enum(SOURCE_FRESHNESS),
  observedAt: z.number().finite().optional(),
})

function toCaveat(code: CaveatCode, detail: Caveat['detail']): Caveat {
  return detail === undefined ? { code } : { code, detail }
}

export function toProvenance(raw: z.infer<typeof provenanceSchema>): SourceProvenance {
  return {
    sourceId: sourceId(raw.sourceId),
    fetchedAt: raw.fetchedAt,
    freshness: raw.freshness,
    ...(raw.observedAt === undefined ? {} : { observedAt: raw.observedAt }),
  }
}

/** Narrows a persisted column against its contract tuple. A row that predates a removed member is
 *  a storage-boundary failure, not a domain validation failure. */
export function toMember<T extends string>(raw: string, members: readonly T[], label: string): T {
  const values: readonly string[] = members

  if (!values.includes(raw)) {
    throw new StorageError(`unknown ${label}: ${raw}`)
  }

  // why-safe: membership in the contract tuple is the narrowing this branch just proved.
  return raw as T
}

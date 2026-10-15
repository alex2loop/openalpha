import type { BrandTag } from '@/core/ids'
import { brandFromPattern } from '@/trading/kernel/instrument'

const SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/

export type SourceId = string & BrandTag<'SourceId'>

export function isSourceId(raw: string): raw is SourceId {
  return SOURCE_ID_RE.test(raw)
}

export function sourceId(raw: string): SourceId {
  return brandFromPattern<SourceId>(raw, SOURCE_ID_RE, { label: 'source id' })
}

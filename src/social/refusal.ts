import { BRAND } from '@/core/brand'
import { ValidationError } from '@/core/errors'

/** An operator-facing refusal: the key is the catalog message, and `{brand}` is always filled. */
export function refuse(key: string, params: Readonly<Record<string, string | number>> = {}): never {
  throw new ValidationError(key, { key, params: { brand: BRAND.name, ...params } })
}

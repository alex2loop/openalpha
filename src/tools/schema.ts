import { type ZodPreprocess, type ZodType, z } from 'zod'

// Models routinely send `""` for an omitted optional field, and `0` for an omitted optional
// count. Both must reach the schema as `undefined` or the `.optional()` branch never fires.
export function emptyToUndef<S extends ZodType>(schema: S): ZodPreprocess<S> {
  return z.preprocess((value) => (value === '' ? undefined : value), schema)
}

export function zeroOrEmptyToUndef<S extends ZodType>(schema: S): ZodPreprocess<S> {
  return z.preprocess((value) => (value === '' || value === 0 ? undefined : value), schema)
}

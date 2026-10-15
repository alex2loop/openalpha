// Rejects unknown keys at compile time: any property on Input that is not on Shape lands in a
// `Record<..., never>` arm, so an extra key makes the value unassignable. Runtime checks still
// protect JavaScript callers; this is the author-time contract shared by every definition helper.
export type Exact<Shape, Input extends Shape> = Input &
  Record<Exclude<keyof Input, keyof Shape>, never>

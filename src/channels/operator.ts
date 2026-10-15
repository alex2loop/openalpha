export type OperatorContext =
  | { readonly kind: 'direct'; readonly chatId: string }
  | { readonly kind: 'group'; readonly chatId: string }

// A missing isGroup is treated as direct, matching the fail-closed default on the wire type.
export function operatorContextOf(isGroup: boolean | undefined, chatId: string): OperatorContext {
  return isGroup ? { kind: 'group', chatId } : { kind: 'direct', chatId }
}

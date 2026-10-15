import { BRAND } from '@/core/brand'

// No `version` header: the ChatGPT subscription backend reads it as the Codex client version and
// refuses models when it is too old. The user-agent carries our version instead.
export function attributionHeaders(): Readonly<Record<string, string>> {
  return {
    originator: BRAND.name,
    'user-agent': `${BRAND.name}/${BRAND.version}`,
  }
}

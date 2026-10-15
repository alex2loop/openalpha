import type { AuthProvider } from '@/ai/auth/types'
import { chatgptAuthProvider } from '@/ai/auth/providers/chatgpt'

export const AUTH_PROVIDERS: readonly AuthProvider[] = Object.freeze([chatgptAuthProvider])

export function authProviderByLoginName(name: string): AuthProvider | undefined {
  return AUTH_PROVIDERS.find((provider) => provider.loginName === name)
}

export function loginNames(): readonly string[] {
  return AUTH_PROVIDERS.map((provider) => provider.loginName)
}

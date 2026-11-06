// The parts of Trusted Types the TypeScript DOM library does not carry yet. Only the default
// policy's script URL rule is declared; the page checks the factory exists before it calls it.

interface TrustedTypePolicyOptions {
  createScriptURL?(url: string): string | null
}

interface TrustedTypePolicyFactory {
  createPolicy(name: string, options: TrustedTypePolicyOptions): unknown
}

interface Window {
  readonly trustedTypes?: TrustedTypePolicyFactory
}

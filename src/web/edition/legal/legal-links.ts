/** Where Cloudflare, which serves every page, states how it handles requests. */
export const CLOUDFLARE_POLICY_URL = 'https://www.cloudflare.com/privacypolicy/'

/** The account that owns a repository address: the maintainer who runs the product. */
export function maintainerOf(repoUrl: string): string {
  return new URL(repoUrl).pathname.split('/')[1] ?? ''
}

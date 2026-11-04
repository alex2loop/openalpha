// What the web builds and deploy-drift share: the names of the files a static site ships and the
// https address check for their flags. No `@/` imports: the deploy job installs nothing of the app.
export const PAGE_FILE = 'index.html'
export const HEADERS_FILE = '_headers'

const HTTPS_PROTOCOL = 'https:'

export function parseHttpsUrl(raw: string | undefined, failure: string): string {
  const url = raw === undefined || !URL.canParse(raw) ? undefined : new URL(raw)

  if (url?.protocol !== HTTPS_PROTOCOL) {
    throw new Error(failure)
  }

  return url.href
}

import { brand } from '@/web/state/session'

import { repository } from '../../../../package.json' with { type: 'json' }

const GIT_URL_PREFIX_RE = /^git\+/
const GIT_URL_SUFFIX_RE = /\.git$/

/** The public source repository, derived from the package manifest like the rest of the product's
 *  identity. */
export const REPO_URL = repository.url.replace(GIT_URL_PREFIX_RE, '').replace(GIT_URL_SUFFIX_RE, '')

/** Where the install lines for each platform are. */
export const INSTALL_URL = `${REPO_URL}#readme`

/** The product's name as the page shows it: the one the daemon reports, or the page's own title
 *  before any session has been read. */
export function productName(): string {
  return brand.value ?? document.title
}

/** The command the installed version answers to: the lower-case name of the product. */
export function cliName(): string {
  return productName().toLowerCase()
}

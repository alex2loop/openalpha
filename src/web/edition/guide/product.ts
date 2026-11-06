import { brand, locale } from '@/web/state/session'

import { funding, repository } from '../../../../package.json' with { type: 'json' }

const GIT_URL_PREFIX_RE = /^git\+/
const GIT_URL_SUFFIX_RE = /\.git$/
const DEFAULT_BRANCH = 'main'
const README_FILE = { en: 'README.md', vi: 'README.vi.md' } as const
// The anchor GitHub gives each README's "Quick start" heading, where the install lines begin.
const README_INSTALL_ANCHOR = { en: 'quick-start', vi: 'bắt-đầu-nhanh' } as const

/** The public source repository, derived from the package manifest like the rest of the product's
 *  identity. */
export const REPO_URL = repository.url.replace(GIT_URL_PREFIX_RE, '').replace(GIT_URL_SUFFIX_RE, '')

/** Where a visitor can support the project, from the package manifest's `funding`. */
export const FUNDING_URL = funding

/** Where the install lines for each platform are: the README in the page's language, scrolled to
 *  its quick start. */
export function installUrl(): string {
  const language = locale.value

  return `${REPO_URL}/blob/${DEFAULT_BRANCH}/${README_FILE[language]}#${README_INSTALL_ANCHOR[language]}`
}

/** The product's name as the page shows it: the one the daemon reports, or the page's own title
 *  before any session has been read. */
export function productName(): string {
  return brand.value ?? document.title
}

/** The command the installed version answers to: the lower-case name of the product. */
export function cliName(): string {
  return productName().toLowerCase()
}

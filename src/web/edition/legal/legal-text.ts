import { formatDay } from '@/i18n'
import { productName, REPO_URL } from '@/web/edition/guide/product'
import { type KeySlot, SLOT_PROVIDERS } from '@/web/edition/keys-store'
import { providerInfo } from '@/web/edition/providers'
import { locale } from '@/web/state/session'
import { tr } from '@/web/text/tr'

// The version and the day the legal texts took effect: both change only when their wording does.
const POLICY_VERSION = '1.1'
const EFFECTIVE_DAY = '2026-11-06'
/** Working days within which the operator replies. */
const RESPONSE_WORKDAYS = '15'
/** Where general questions go; a data request or complaint goes to its admins privately. */
const SUPPORT_GROUP_URL = 'https://zalo.me/g/yl7iqyfovvtyosujulea'
const ISSUES_URL = `${REPO_URL}/issues`
/** The repository owner, who maintains the project and runs the web version. */
const MAINTAINER = new URL(REPO_URL).pathname.split('/')[1] ?? ''

const CLOUDFLARE_POLICY_URL = 'https://www.cloudflare.com/privacypolicy/'

/** Every `{name}` the legal texts use. Read in the render, so it follows the language. */
export function toLegalParams(): Readonly<Record<string, string>> {
  return {
    policyVersion: POLICY_VERSION,
    effectiveDate: formatDay(locale.value, EFFECTIVE_DAY),
    brand: productName(),
    maintainer: MAINTAINER,
    responseWorkdays: RESPONSE_WORKDAYS,
    supportGroupUrl: SUPPORT_GROUP_URL,
    issuesUrl: ISSUES_URL,
    repoUrl: REPO_URL,
    cloudflarePolicyUrl: CLOUDFLARE_POLICY_URL,
    aiPolicies: toPolicyLinks('ai'),
    routerProviders: toRouterNames(),
    searchPolicies: toPolicyLinks('search'),
    sceneNote: tr('ui.office.scene.aiNote'),
  }
}

// The providers a visitor can send to, each linked to its own policy: the same table the consent
// notice reads, so the two cannot name different pages.
function toPolicyLinks(slot: KeySlot): string {
  return SLOT_PROVIDERS[slot]
    .map((provider) => {
      const { name, policyUrl } = providerInfo(slot, provider)

      return `[${name}](${policyUrl})`
    })
    .join(', ')
}

// The AI providers that pass a request on to another host, read from the table the consent notice
// reads, so a router added there is named here.
function toRouterNames(): string {
  return SLOT_PROVIDERS.ai
    .map((provider) => providerInfo('ai', provider))
    .filter((info) => info.isRouter === true)
    .map((info) => info.name)
    .join(', ')
}

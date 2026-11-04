import { productName, REPO_URL } from '@/web/edition/guide/product'
import { type KeySlot, SLOT_PROVIDERS } from '@/web/edition/keys-store'
import { providerInfo } from '@/web/edition/providers'
import { tr } from '@/web/text/tr'

// What the operator fills in before launch. Each one that is still empty prints on the page as a
// visible "chưa điền" mark with its name, never as a blank.
const POLICY_VERSION = '1.0'
const EFFECTIVE_DATE = ''
/** Working days within which the operator replies. */
const RESPONSE_WORKDAYS = '15'
/** Where general questions go; a data request or complaint goes to its admins privately. */
const SUPPORT_GROUP_URL = 'https://zalo.me/g/yl7iqyfovvtyosujulea'
const ISSUES_URL = `${REPO_URL}/issues`
/** The repository owner, who maintains the project and runs the web version. */
const MAINTAINER = new URL(REPO_URL).pathname.split('/')[1] ?? ''

const CLOUDFLARE_POLICY_URL = 'https://www.cloudflare.com/privacypolicy/'

const OPERATOR_FIELDS: readonly {
  readonly param: string
  readonly name: string
  readonly value: string
}[] = Object.freeze([
  { param: 'policyVersion', name: 'POLICY_VERSION', value: POLICY_VERSION },
  { param: 'effectiveDate', name: 'EFFECTIVE_DATE', value: EFFECTIVE_DATE },
])

/** Every `{name}` the legal texts use. Read in the render, so it follows the language. */
export function toLegalParams(): Readonly<Record<string, string>> {
  const operator = OPERATOR_FIELDS.map(({ param, name, value }) => [
    param,
    value === '' ? tr('ui.office.edition.legal.missing', { field: name }) : value,
  ])

  return {
    ...Object.fromEntries(operator),
    brand: productName(),
    maintainer: MAINTAINER,
    responseWorkdays: RESPONSE_WORKDAYS,
    supportGroupUrl: SUPPORT_GROUP_URL,
    issuesUrl: ISSUES_URL,
    repoUrl: REPO_URL,
    cloudflarePolicyUrl: CLOUDFLARE_POLICY_URL,
    aiPolicies: toPolicyLinks('ai'),
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

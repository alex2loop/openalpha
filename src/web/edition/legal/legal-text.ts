import { productName, REPO_URL } from '@/web/edition/guide/product'
import { type KeySlot, SLOT_PROVIDERS } from '@/web/edition/keys-store'
import { providerInfo } from '@/web/edition/providers'
import { tr } from '@/web/text/tr'

// What the operator fills in before launch. Each one that is still empty prints on the page as a
// visible "chưa điền" mark with its name, never as a blank.
const OPERATOR_NAME = ''
/** Cá nhân, hộ kinh doanh or doanh nghiệp. */
const OPERATOR_KIND = ''
const OPERATOR_ADDRESS = ''
/** The one public contact for data requests, complaints and authority requests. */
const CONTACT_EMAIL = ''
/** Working days within which the operator replies. */
const RESPONSE_WORKDAYS = ''
const POLICY_VERSION = ''
const EFFECTIVE_DATE = ''
/** Where a dispute that contact does not settle goes. */
const DISPUTE_FORUM = ''

const CLOUDFLARE_POLICY_URL = 'https://www.cloudflare.com/privacypolicy/'

const OPERATOR_FIELDS: readonly {
  readonly param: string
  readonly name: string
  readonly value: string
}[] = Object.freeze([
  { param: 'operatorName', name: 'OPERATOR_NAME', value: OPERATOR_NAME },
  { param: 'operatorKind', name: 'OPERATOR_KIND', value: OPERATOR_KIND },
  { param: 'operatorAddress', name: 'OPERATOR_ADDRESS', value: OPERATOR_ADDRESS },
  { param: 'contactEmail', name: 'CONTACT_EMAIL', value: CONTACT_EMAIL },
  { param: 'responseWorkdays', name: 'RESPONSE_WORKDAYS', value: RESPONSE_WORKDAYS },
  { param: 'policyVersion', name: 'POLICY_VERSION', value: POLICY_VERSION },
  { param: 'effectiveDate', name: 'EFFECTIVE_DATE', value: EFFECTIVE_DATE },
  { param: 'disputeForum', name: 'DISPUTE_FORUM', value: DISPUTE_FORUM },
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

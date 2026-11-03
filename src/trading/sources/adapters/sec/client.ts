// Source class: official and keyless but identified. SEC's fair-access rules ask every reader to
// name a contact in its user agent, and they serve from two hosts: `data.sec.gov` answers the
// structured reads (frames, submissions) and `www.sec.gov` the ticker map and the filing archive,
// each 404ing for the other's paths. `sec-data` is the routed id; `sec` is the second host's id and
// exists only in the facts tables, so its endpoint and pacing belong to it.
import { sourceId } from '@/trading/kernel/source/source-id'

export const SEC_DEFAULT_ENDPOINT = 'https://www.sec.gov'
export const SEC_DATA_DEFAULT_ENDPOINT = 'https://data.sec.gov'
export const SEC_ID = sourceId('sec')
export const SEC_DATA_ID = sourceId('sec-data')

/** Read from `SEC_CONTACT_EMAIL` and placed here instead of the browser agent, because the plain
 *  agent string names the product and SEC wants a person to write to. */
const SEC_USER_AGENT_PREFIX = 'Personal research '

export const SEC_CREDENTIAL = Object.freeze({
  kind: 'header',
  name: 'user-agent',
  prefix: SEC_USER_AGENT_PREFIX,
} as const)

/** A SEC company id is ten digits, zero-padded, wherever it appears in a path. */
export function toPaddedCik(cik: number | string): string {
  return String(cik).padStart(10, '0')
}

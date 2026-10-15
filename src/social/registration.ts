import type { SocialHttpResponse, SocialSendInput } from '@/social/request/send'
import type { NetworkPin, SocialAgent } from '@/social/types'
import { ToolError, ValidationError } from '@/core/errors'
import { valueAt } from '@/social/json'
import { refuse } from '@/social/refusal'
import { isOkStatus, sendSocialRequest } from '@/social/request/send'

const HTTP_CONFLICT = 409

export interface Registration {
  readonly apiKey: string
  /** What the network asks the operator to open or keep, such as a claim link. */
  readonly claims: readonly { readonly field: string; readonly value: string }[]
}

export interface RegisterInput {
  readonly pin: NetworkPin
  readonly agent: SocialAgent
  readonly publicName: string
}

export async function registerAgent(
  input: RegisterInput,
  signal: AbortSignal
): Promise<Registration> {
  const { pin, agent, publicName } = input
  const { register } = pin

  if (register === undefined) {
    return refuse('social.needsKeyEnv', { network: pin.name })
  }

  const body = buildRegisterBody(register.body, agent, publicName)
  const response = await sendRegistration(
    {
      apiBase: pin.apiBase,
      method: register.method,
      path: register.path,
      body: JSON.stringify(body),
    },
    { network: pin.name, signal }
  )

  if (response.status === HTTP_CONFLICT) {
    return refuse('social.nameTakenOnNetwork', { network: pin.name, name: publicName })
  }

  if (!isOkStatus(response.status)) {
    return refuse('social.registerFailed', { network: pin.name, status: response.status })
  }

  const json =
    parseJson(response.text) ??
    refuse('social.registerFailed', {
      network: pin.name,
      status: response.status,
    })
  const apiKey = valueAt(json, register.keyField)

  if (typeof apiKey !== 'string' || apiKey === '') {
    return refuse('social.registerNoKey', { network: pin.name })
  }

  return { apiKey, claims: claimsOf(json, register.claimFields) }
}

/** A timeout, a 5xx or a redirect reads as the network being out of reach. */
async function sendRegistration(
  request: SocialSendInput,
  context: { readonly network: string; readonly signal: AbortSignal }
): Promise<SocialHttpResponse> {
  try {
    return await sendSocialRequest(request, context.signal)
  } catch (err: unknown) {
    if (!(err instanceof ToolError)) {
      throw err
    }

    throw new ValidationError(
      `registration on ${context.network} failed`,
      { key: 'social.registerUnreachable', params: { network: context.network } },
      err
    )
  }
}

function buildRegisterBody(
  template: Readonly<Record<string, string>>,
  agent: SocialAgent,
  publicName: string
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(template).map(([key, value]) => [
      key,
      // A function replacement: a `$&` in a name is text, not a pattern.
      value
        .replaceAll('{agent.name}', () => publicName)
        .replaceAll('{agent.description}', () => agent.description ?? publicName),
    ])
  )
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function claimsOf(json: unknown, fields: readonly string[]): Registration['claims'] {
  return fields.flatMap((field) => {
    const value = valueAt(json, field)

    return typeof value === 'string' ? [{ field, value }] : []
  })
}

/** Exactly the body `registerAgent` sends, for the operator to read before anything goes out;
 *  `undefined` when the skill shows no registration. */
export function registrationBody(
  input: RegisterInput
): Readonly<Record<string, string>> | undefined {
  const { register } = input.pin

  return register === undefined
    ? undefined
    : buildRegisterBody(register.body, input.agent, input.publicName)
}

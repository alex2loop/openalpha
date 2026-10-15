import type { HttpMethod } from '@/social/types'

/** The closed set an endpoint is labelled from. The label, never the method, decides what happens
 *  to a request. */
export const SOCIAL_LABELS = Object.freeze([
  'read',
  'post',
  'comment',
  'vote',
  'follow',
  'verify',
  'dm',
  'delete',
  'account',
  'register',
  'admin',
] as const)

export type SocialLabel = (typeof SOCIAL_LABELS)[number]

/** `send`: always out. `public-write`: out unless review-all is on or it carries an outside link.
 *  `always-send`: a network's challenge, which only the running agent can answer in time.
 *  `draft`: waits for the operator. `blocked`: refused outright. */
export type LabelPolicy = 'send' | 'public-write' | 'always-send' | 'draft' | 'blocked'

export const LABEL_POLICY: Readonly<Record<SocialLabel, LabelPolicy>> = Object.freeze({
  read: 'send',
  post: 'public-write',
  comment: 'public-write',
  vote: 'public-write',
  follow: 'public-write',
  verify: 'always-send',
  dm: 'draft',
  delete: 'draft',
  account: 'blocked',
  register: 'blocked',
  admin: 'blocked',
})

/** First match wins, so the narrower words sit above the method-wide `delete`, and anything under
 *  the agent's own account is `account` even when it ends in `/verify`. Marking notifications read
 *  changes nothing anyone else sees, so it is a `read`. A non-GET endpoint no rule names stays
 *  unlabelled, which blocks it until the operator labels it. */
const LABEL_RULES: readonly { readonly label: SocialLabel; readonly path: RegExp }[] = [
  { label: 'register', path: /\/register$/ },
  { label: 'account', path: /(\/me(\/|$)|\/profile|setup-owner|email|api-key|rotate|password)/ },
  { label: 'verify', path: /\/verify$/ },
  { label: 'read', path: /^\/notifications\/read/ },
  { label: 'admin', path: /(moderator|settings|\/pin$|\/labels|\/roles|\/ban|\/admin)/ },
  { label: 'dm', path: /(\/dms?(\/|$)|\/messages|\/conversations|\/inbox)/ },
]
/** A GET that hands out or changes a credential is account business, never a read: its answer is
 *  the key itself, which the model must not see. */
const CREDENTIAL_PATH_RE = /(api-?key|rotate|password|token|secret|credential)/i
const WRITE_RULES: readonly { readonly label: SocialLabel; readonly path: RegExp }[] = [
  { label: 'vote', path: /(upvote|downvote|\/votes?$|\/likes?$)/ },
  { label: 'follow', path: /\/(follow|subscribe)$/ },
  { label: 'comment', path: /\/(comments|replies)$/ },
  { label: 'post', path: /\/posts$/ },
]

export function isSocialLabel(value: string): value is SocialLabel {
  return SOCIAL_LABELS.some((label) => label === value)
}

export function suggestLabel(method: HttpMethod, path: string): SocialLabel | undefined {
  if (method === 'GET') {
    return CREDENTIAL_PATH_RE.test(path) ? 'account' : 'read'
  }

  const named = LABEL_RULES.find((rule) => rule.path.test(path))

  if (named !== undefined) {
    return named.label
  }

  if (method === 'DELETE') {
    return 'delete'
  }

  return WRITE_RULES.find((rule) => rule.path.test(path))?.label
}

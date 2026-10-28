// The /v1 sign-in routes: browser sessions, Telegram pairing and the ChatGPT subscription login.

/** GET /v1/pairing — chats waiting for a pairing code to be approved, and chats already paired,
 *  across every channel. A code is 6 characters; `expiresAt` (epoch ms) is when it lapses. `paired`
 *  holds at most 200 chats per channel, in chat id order. */
export interface PairingList {
  readonly pending: readonly {
    readonly channel: string
    readonly code: string
    readonly chatId: string
    readonly expiresAt: number
  }[]
  readonly paired: readonly { readonly channel: string; readonly chatId: string }[]
}

/** DELETE /v1/pairing/:channel/:chatId. False when that chat was not paired and held no code. */
export interface PairingRevokeResult {
  readonly revoked: boolean
}

/** POST /v1/pairing body. Approving lets the chat in on its next message; denying drops the code. */
export interface PairingDecisionBody {
  readonly channel: string
  readonly code: string
  readonly decision: 'approve' | 'deny'
}

export type PairingDecisionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'expired' | 'not_found' }

/** A ChatGPT sign-in in progress. `browser` opens `url` on the daemon's own machine (this Mac
 *  only: the redirect lands on its loopback port); `device` shows `userCode` to enter at
 *  `verificationUrl`, and works for a daemon on a server too. `failed.reason` is `timeout` after
 *  15 minutes, else `failed`. */
export type ChatgptLoginWire =
  | { readonly state: 'starting'; readonly method: 'browser' | 'device' }
  | { readonly state: 'waiting'; readonly method: 'browser'; readonly url: string }
  | {
      readonly state: 'waiting'
      readonly method: 'device'
      readonly userCode: string
      readonly verificationUrl: string
    }
  | {
      readonly state: 'failed'
      readonly method: 'browser' | 'device'
      readonly reason: 'timeout' | 'failed'
    }

/** GET, POST (`{ method }`) and DELETE /v1/auth/chatgpt. `accessExpiresAt` is when the current
 *  access token lapses; the daemon renews it on its own, so it is not the subscription's end.
 *  Signing in does not change config: a model with provider `openai-chatgpt` still has to be set. */
export interface ChatgptAuthStatus {
  readonly signedIn: boolean
  /** The account's email, or its id when the token carries no email. */
  readonly account?: string
  readonly plan?: string
  readonly accessExpiresAt?: number
  readonly login?: ChatgptLoginWire
}

/** POST /v1/session/code, bearer token only: a one-time code for `POST /v1/session`, good for five
 *  minutes and held in memory, so a restart drops it. */
export interface BrowserSignInCode {
  readonly code: string
}

/** POST /v1/session body. */
export interface BrowserSignInBody {
  readonly code: string
}

/** POST /v1/session: the session cookie comes in `Set-Cookie`. */
export interface BrowserSignInResult {
  readonly ok: true
}

/** One signed-in browser. `label` is "<browser>, <os>" read from its User-Agent, '' when neither
 *  is known; `current` marks the browser that asked. */
export interface BrowserSessionWire {
  readonly id: string
  readonly label: string
  readonly createdAt: number
  readonly lastSeenAt: number
  readonly current: boolean
}

/** GET /v1/sessions: newest use first. */
export interface BrowserSessionList {
  readonly sessions: readonly BrowserSessionWire[]
}

/** POST /v1/session/logout and DELETE /v1/sessions/:id. False when no such session was signed in. */
export interface BrowserSessionEndResult {
  readonly ended: boolean
}

import type { DeliveryHub } from '@/app/delivery'
import type { LiveFeed } from '@/app/server/feed/live'
import type { SignInCodes } from '@/app/server/http/sign-in-codes'
import type { ChannelDefinition } from '@/channels/api'
import type { Command, Group, KeyFile } from '@/cli/api'
import type { KeyValidator } from '@/commands/api'
import type { LogLevel, ModelSource } from '@/core/config/resolve'
import type { App, ServiceProvider } from '@/core/container'
import type { LoggerResource } from '@/core/logging/logger'
import type { ToolDefinition } from '@/core/tool'
import type { SlashCommand } from '@/core/types/command'
import type { AgentDefinition } from '@/engine/api'

// The boot seam an embedder of `@openalpha/runtime/app` implements, and the API contracts the
// daemon starts (src/app/server).

type BootVerdict = 'ok' | 'warn' | 'stop'

// Verdict and message travel together: boot holds none of the state the host judged on, so it
// cannot format the message itself, and it must not learn how.
interface BootCheck {
  readonly verdict: BootVerdict
  readonly message?: string
}

export type BootGate = (options: {
  readonly configPath: string
  readonly dataDir: string
}) => Promise<BootCheck>

/** What the daemon holds of a running HTTP/WS surface: `closeAdmission` is the first step down
 *  (no new connection or request; in-flight ones finish), `stop` the last (sockets, then wait for
 *  those in-flight requests). */
export interface ApiHandle {
  closeAdmission(): void
  stop(): Promise<void>
}

/** Starts the HTTP/WS surface; the daemon wires its two steps into the shutdown order. */
type ServerStarter = (
  app: App,
  env: Readonly<Record<string, string | undefined>>
) => Promise<ApiHandle>

export interface ApiRouteContext {
  readonly app: App
  readonly token: string
  readonly live: LiveFeed
  readonly ip: string | null
  /** Who the request counts as for the auth lockout, as `resolvePeerKey` found it. */
  readonly peer: string
  /** The origin of the page the request belongs to, as `resolvePageOrigin` found it. */
  readonly pageOrigin: string
  readonly cookieName: string
  readonly codes: SignInCodes
  /** The browser session the request came from; absent for the bearer token and on open routes. */
  readonly browserSessionId?: string
}

/** A section whose backing store may be absent. A route naming one answers 503 until it exists —
 *  NOT a tool `Capability`: this gates data availability, not permission. */
type ApiCapability = 'ohlcv' | 'quotes' | 'portfolio' | 'suggestions' | 'orders'

export interface ApiRouteSpec {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  /** May contain `:param` segments, matched segment-by-segment. */
  readonly path: string
  readonly auth: boolean
  readonly capability?: ApiCapability
  handler(req: Request, ctx: ApiRouteContext): Promise<Response>
}

declare module '@/core/container' {
  interface Services {
    // The HTTP/WS API (src/app/server); the daemon starts it only with [api] enabled.
    apiStarter: ServerStarter
    apiRoutes: readonly ApiRouteSpec[]
    /** The key file the entry loaded before boot: where `/v1/credentials` writes, and which names
     *  it set in the environment. */
    keyFile: KeyFile
    /** The commands the entry grafted beside the built-in ones (the server's own and the host's), so
     *  a command forwarded to the daemon resolves against the same tree as in-process. */
    extraCliCommands: readonly (Command | Group)[]
  }
}

/** The flat extension options `boot` lowers into the canonical provider assembly. */
interface BootExtensions {
  readonly tools?: readonly ToolDefinition[]
  readonly agents?: readonly AgentDefinition[]
  readonly slashCommands?: readonly SlashCommand[]
  readonly channels?: readonly ChannelDefinition[]
}

/** Composition-time input to the boot-extension factory: the flat options and the locale seam. */
export interface BootExtensionOptions {
  readonly extensions: BootExtensions
  readonly keys: KeyValidator
}

export interface BootOptions extends BootExtensions {
  readonly mode: 'cli' | 'daemon'
  readonly bootScope?: 'full' | 'persistence'
  readonly startup?: 'hydrate' | 'migrate' | 'none'
  readonly env: Readonly<Record<string, string | undefined>>
  readonly configFile?: 'required' | 'optional' | 'probe'
  readonly configPath?: string
  readonly dataDir?: string
  readonly logLevel?: LogLevel
  readonly modelSource?: ModelSource
  readonly shutdownSignal: AbortSignal
  readonly err?: (line: string) => void
  readonly features?: readonly ServiceProvider[]
  readonly bootGate?: BootGate
  readonly onLoggerResource?: (resource: LoggerResource) => void
}

export interface Booted {
  readonly app: App
  readonly delivery: DeliveryHub
  readonly dispose: () => Promise<void>
}

export interface MainOptions {
  /** Providers layered onto the container after the canonical ones. */
  readonly features?: readonly ServiceProvider[]
  /** Commands grafted onto the root, beside the built-in ones. */
  readonly extraCommands?: readonly (Command | Group)[]
  /** Defaults to a pass-through gate; an embedding host injects one that may warn or refuse. */
  readonly bootGate?: BootGate
}

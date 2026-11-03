// The page <-> worker protocol of the browser edition: the engine runs in a dedicated Web Worker and
// the page talks to it with these messages instead of HTTP and a socket. `http` and `frame` carry the
// same `/v1` request shapes and chat frames the daemon serves; the rest is lifecycle.

import type { ClientFrame, ServerFrame } from '@/app/server/wire/socket'
import type { Capabilities } from '@/app/server/wire/system'
import type { Locale } from '@/core/types/locale'

/** The AI providers whose API answers a browser; the page offers them and the worker reads their keys. */
export type BrowserAiProvider =
  | 'openrouter'
  | 'openai'
  | 'deepseek'
  | 'anthropic'
  | 'gemini'
  | 'xai'
  | 'mistral'

/** The hosted search backends a page can use. */
export type BrowserSearchProvider = 'tavily' | 'serper' | 'deepseek'

/** One key the visitor pasted: which provider it belongs to and the secret itself. It lives in the
 *  worker's memory and is never written to a log, a run row or an attempt row. */
interface BrowserKey {
  readonly provider: string
  readonly key: string
}

/** The keys the visitor holds: one per AI provider, one for web search. Any may be absent; the
 *  features that need a missing one stay visible and say so. */
export interface BrowserKeys {
  readonly ai?: readonly BrowserKey[]
  readonly search?: BrowserKey
}

/** Page -> worker. `start` opens the database and boots the engine; `steal` takes the database from
 *  another tab. `http` answers with an `http` reply of the same `id`; `abort` cancels one by `id`. */
export type WorkerCall =
  | { kind: 'start'; locale: Locale; keys: BrowserKeys; steal: boolean }
  | { kind: 'keys'; keys: BrowserKeys }
  | { kind: 'locale'; locale: Locale }
  | { kind: 'http'; id: string; method: string; path: string; body?: string }
  | { kind: 'frame'; frame: ClientFrame }
  | { kind: 'abort'; id: string }
  | { kind: 'export-db'; id: string }
  | { kind: 'open-db'; id: string; bytes: ArrayBuffer }

/** Why the worker could not (or can no longer) serve the page. */
export type WorkerRefusal =
  | 'locked'
  | 'taken-over'
  | 'unsupported'
  | 'newer-schema'
  | 'storage-full'

/** How `open-db` ended. Anything but `opened` left the database the page already had. */
export type DbOpenOutcome =
  | 'opened'
  | 'invalid'
  | 'newer-schema'
  | 'from-installed'
  | 'storage-full'
  | 'failed'

/** Worker -> page. `ready` answers `start` with what this edition offers; `refused` says the
 *  database is not available and why. `db-exported` answers `export-db` with every committed page of
 *  the database as one SQLite file (`null` when there is none to read); `db-opened` answers
 *  `open-db`, which replaced the database with the file's bytes only when it says `opened`. */
export type WorkerReply =
  | { kind: 'ready'; capabilities: Capabilities }
  | { kind: 'refused'; reason: WorkerRefusal }
  | { kind: 'http'; id: string; status: number; body: string }
  | { kind: 'frame'; frame: ServerFrame }
  | { kind: 'db-exported'; id: string; bytes: ArrayBuffer | null }
  | { kind: 'db-opened'; id: string; outcome: DbOpenOutcome }

import '@/app/browser/zod-jitless'
import type { WorkerCall, WorkerReply } from '@/app/server/wire/worker'
import { createBridgeContext, handleWorkerCall } from '@/app/browser/bridge'
import { createBrowserKeyring } from '@/app/browser/keys'
import { silentLogger } from '@/core/logging/silent-logger'
import { formatErrForLog } from '@/core/security/credentials'

const WASM_FILE = 'sqlite3.wasm'
const DEFAULT_LOCALE = 'vi'

// The dedicated worker's entry: the page posts a `WorkerCall`, the worker answers with `WorkerReply`
// messages. The bridge owns every call. The worker has no teardown of its own: the page ends it
// with `terminate()`, which frees the tab lock.
const bridge = createBridgeContext({
  post: (reply: WorkerReply) => postMessage(reply),
  keyring: createBrowserKeyring(),
  logger: silentLogger,
  wasmUrl: new URL(WASM_FILE, location.href).href,
  locale: DEFAULT_LOCALE,
})

addEventListener('message', (event: MessageEvent<WorkerCall>) => {
  handleWorkerCall(event.data, bridge).catch((err: unknown) => {
    silentLogger.error('browser.worker_failed', { err: formatErrForLog(err) })
  })
})

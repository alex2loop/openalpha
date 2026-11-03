import type { WorkerCall, WorkerReply } from '@/app/server/wire/worker'
import { createBridgeContext, handleWorkerCall } from '@/app/browser/bridge'
import { createBrowserKeyring } from '@/app/browser/keys'
import { createBrowserLogger } from '@/app/browser/logger'

const LOG_RING_LIMIT = 200
const WASM_FILE = 'sqlite3.wasm'
const DEFAULT_LOCALE = 'vi'

// The dedicated worker's entry: the page posts a `WorkerCall`, the worker answers with `WorkerReply`
// messages. The bridge owns every call; this file only wires it to the worker's message port.
const bridge = createBridgeContext({
  post: (reply: WorkerReply) => postMessage(reply),
  keyring: createBrowserKeyring(),
  logger: createBrowserLogger(LOG_RING_LIMIT),
  wasmUrl: new URL(WASM_FILE, location.href).href,
  locale: DEFAULT_LOCALE,
})

addEventListener('message', (event: MessageEvent<WorkerCall>) => {
  handleWorkerCall(event.data, bridge).catch(() => undefined)
})

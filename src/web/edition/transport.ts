import type { WorkerCall, WorkerReply } from '@/app/server/wire/worker'

// A response with one of these statuses carries no body.
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304])

interface Pending {
  readonly resolve: (response: Response) => void
  readonly reject: (error: unknown) => void
  /** Removes the abort listener and the timer of this request. */
  readonly release: () => void
}

interface WorkerTransport {
  /** Answers one `/v1` request through the worker. Rejects with the request's own abort reason, a
   *  timeout, or the worker's failure. */
  send(request: Request): Promise<Response>
  /** Rejects every request in flight and stops listening to the worker. */
  dispose(): void
}

/** The page's `/v1` transport in the web edition: each request becomes an `http` call to the worker
 *  and settles on the reply with its id. A request leaves the pending map when it settles, is
 *  aborted or times out, so nothing a settled request held stays behind. */
export function createWorkerTransport(worker: Worker, timeoutMs: number): WorkerTransport {
  const pending = new Map<string, Pending>()
  const lifetime = new AbortController()

  worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => reply(pending, event), {
    signal: lifetime.signal,
  })
  worker.addEventListener('error', () => rejectAll(pending, new Error('worker failed')), {
    signal: lifetime.signal,
  })

  return {
    send: (request) => send({ worker, pending, timeoutMs }, request),
    dispose() {
      lifetime.abort()
      rejectAll(pending, new Error('transport disposed'))
    },
  }
}

interface SendContext {
  readonly worker: Worker
  readonly pending: Map<string, Pending>
  readonly timeoutMs: number
}

async function send(ctx: SendContext, request: Request): Promise<Response> {
  const { worker, pending } = ctx
  const url = new URL(request.url)
  const body =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text()

  if (request.signal.aborted) {
    throw request.signal.reason
  }

  return new Promise<Response>((resolve, reject) => {
    const id = crypto.randomUUID()
    const settle = (finish: () => void): void => {
      pending.get(id)?.release()
      pending.delete(id)
      finish()
    }
    const fail = (error: unknown): void => {
      settle(() => reject(error))
      call(worker, { kind: 'abort', id })
    }
    const timer = setTimeout(() => fail(new Error('request timed out')), ctx.timeoutMs)
    const onAbort = (): void => fail(request.signal.reason)

    request.signal.addEventListener('abort', onAbort, { once: true })
    pending.set(id, {
      resolve: (response) => settle(() => resolve(response)),
      reject: (error) => settle(() => reject(error)),
      release() {
        clearTimeout(timer)
        request.signal.removeEventListener('abort', onAbort)
      },
    })

    call(worker, {
      kind: 'http',
      id,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      ...(body === undefined || body === '' ? {} : { body }),
    })
  })
}

function reply(pending: Map<string, Pending>, event: MessageEvent<WorkerReply>): void {
  const message = event.data

  if (message.kind !== 'http') {
    return
  }

  pending.get(message.id)?.resolve(
    new Response(NULL_BODY_STATUSES.has(message.status) ? null : message.body, {
      status: message.status,
    })
  )
}

function rejectAll(pending: Map<string, Pending>, error: unknown): void {
  for (const request of [...pending.values()]) {
    request.reject(error)
  }
}

function call(worker: Worker, message: WorkerCall): void {
  worker.postMessage(message)
}

import { z } from 'zod'

import type { ExecClientFrame, ExecServerFrame, ExecStartFrame } from '@/app/server/wire/exec'
import type { CliApp, Command, GlobalFlags, Group, Needs, Terminal } from '@/cli/api'
import { resolveExecTarget } from '@/app/server/cli/exec-target'
import { LOOPBACK_HOST } from '@/app/server/http/auth'
import { EXEC_PATH, EXEC_REFUSED_CLOSE_CODE } from '@/app/server/wire/exec'
import { CONTRACT_VERSION } from '@/app/server/wire/socket'
import { isForwardable, printDaemonLost, resolveCommandPath, TERMINAL_ENV_NAMES } from '@/cli/api'

/** How long the loopback handshake may take before the command runs here instead. */
const EXEC_OPEN_TIMEOUT_MS = 1_000
/** How long the daemon may take to answer `exec`; past it the command may have started there. */
const EXEC_ACCEPT_TIMEOUT_MS = 5_000

const SERVER_FRAME: z.ZodType<ExecServerFrame> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('accepted') }),
  z.object({ type: z.literal('output'), stream: z.enum(['out', 'err']), data: z.string() }),
  z.object({ type: z.literal('raw'), on: z.boolean() }),
  z.object({
    type: z.literal('edit'),
    editor: z.string(),
    fileName: z.string(),
    text: z.string(),
  }),
  z.object({ type: z.literal('exit'), code: z.number().int() }),
])

/** `local`: nothing ran in the daemon, so the command runs here. `lost`: it may have run there, so
 *  it must not run again. */
type Outcome =
  | { readonly kind: 'local' }
  | { readonly kind: 'lost' }
  | { readonly kind: 'exit'; readonly code: number }

type Phase = 'opening' | 'sent' | 'accepted'

interface Relay {
  readonly ws: WebSocket
  readonly app: CliApp
  readonly settle: (outcome: Outcome) => void
  phase: Phase
  timer: ReturnType<typeof setTimeout> | undefined
}

interface ForwardInput {
  readonly app: CliApp
  readonly flags: GlobalFlags
  readonly needs: Required<Needs>
  readonly commands: readonly (Command | Group)[]
}

const LOCAL: Outcome = { kind: 'local' }
const LOST: Outcome = { kind: 'lost' }

/** Runs the command in the daemon when one can take it. Undefined means run it here. */
export async function forwardCommand(input: ForwardInput): Promise<number | undefined> {
  const { app, flags, needs, commands } = input

  if (flags.local || !isForwardable(needs)) {
    return undefined
  }

  const target = await resolveExecTarget(app)

  if (target.kind === 'local') {
    return undefined
  }

  const outcome = await relayCommand(app, toExecFrame(app.terminal, flags), target)

  if (outcome.kind === 'exit') {
    return outcome.code
  }

  return outcome.kind === 'local'
    ? undefined
    : printDaemonLost(app, await resolveCommandPath(flags.argv, commands))
}

async function relayCommand(
  app: CliApp,
  start: ExecStartFrame,
  target: { readonly port: number; readonly token: string }
): Promise<Outcome> {
  const ws = new WebSocket(`ws://${LOOPBACK_HOST}:${target.port}${EXEC_PATH}`, {
    headers: { authorization: `Bearer ${target.token}` },
  })
  const done = Promise.withResolvers<Outcome>()
  const relay: Relay = { ws, app, settle: done.resolve, phase: 'opening', timer: undefined }
  const onOpen = (): void => openRelay(relay, start)
  const onMessage = (event: MessageEvent): void => receiveFrame(relay, event.data)
  const onClose = (event: CloseEvent): void => relay.settle(closedOutcome(relay.phase, event))
  // After open an error is always followed by a close, which decides.
  const onError = (): void => {
    if (relay.phase === 'opening') {
      relay.settle(LOCAL)
    }
  }

  try {
    armTimer(relay, EXEC_OPEN_TIMEOUT_MS, LOCAL)
    ws.addEventListener('open', onOpen)
    ws.addEventListener('message', onMessage)
    ws.addEventListener('close', onClose)
    ws.addEventListener('error', onError)

    return await done.promise
  } finally {
    clearTimeout(relay.timer)
    ws.removeEventListener('open', onOpen)
    ws.removeEventListener('message', onMessage)
    ws.removeEventListener('close', onClose)
    ws.removeEventListener('error', onError)
    ws.close()
  }
}

function openRelay(relay: Relay, start: ExecStartFrame): void {
  relay.phase = 'sent'
  sendFrame(relay, start)
  armTimer(relay, EXEC_ACCEPT_TIMEOUT_MS, LOST)
}

function receiveFrame(relay: Relay, raw: unknown): void {
  const frame = parseFrame(raw)

  if (frame === null) {
    return
  }

  if (frame.type === 'accepted') {
    acceptRelay(relay)

    return
  }

  if (relay.phase !== 'accepted') {
    return
  }

  if (frame.type === 'output') {
    const stream = frame.stream === 'out' ? relay.app.terminal.stdout : relay.app.terminal.stderr

    stream.write(frame.data)
  } else if (frame.type === 'exit') {
    relay.settle({ kind: 'exit', code: frame.code })
  }
}

/** Until stdin is relayed, a prompt reads end of input rather than waiting on it. */
function acceptRelay(relay: Relay): void {
  if (relay.phase !== 'sent') {
    return
  }

  relay.phase = 'accepted'
  clearTimeout(relay.timer)
  relay.timer = undefined
  sendFrame(relay, { type: 'input_end' })
}

/** Only the daemon's own refusal before `accepted` leaves the command unrun; any other close after
 *  `exec` went out may have started it. */
function closedOutcome(phase: Phase, event: CloseEvent): Outcome {
  if (phase === 'opening') {
    return LOCAL
  }

  return phase === 'sent' && event.code === EXEC_REFUSED_CLOSE_CODE ? LOCAL : LOST
}

function armTimer(relay: Relay, ms: number, outcome: Outcome): void {
  clearTimeout(relay.timer)
  relay.timer = setTimeout(() => relay.settle(outcome), ms)
}

function sendFrame(relay: Relay, frame: ExecClientFrame): void {
  relay.ws.send(JSON.stringify(frame))
}

function parseFrame(raw: unknown): ExecServerFrame | null {
  if (typeof raw !== 'string') {
    return null
  }

  try {
    const parsed = SERVER_FRAME.safeParse(JSON.parse(raw))

    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function toExecFrame(terminal: Terminal, flags: GlobalFlags): ExecStartFrame {
  const { stdin, stdout, stderr } = terminal
  // One size for both streams, from whichever is a terminal; a pipe has none.
  const sized = stdout.isTTY ? stdout : stderr

  return {
    type: 'exec',
    argv: flags.argv,
    terminal: {
      stdinIsTTY: stdin.isTTY === true,
      stdoutIsTTY: stdout.isTTY === true,
      stderrIsTTY: stderr.isTTY === true,
      columns: toSize(sized.isTTY, sized.columns),
      rows: toSize(sized.isTTY, sized.rows),
    },
    env: toExecEnv(terminal),
    quiet: flags.quiet,
    verbose: flags.verbose,
    noColor: flags.noColor,
    contractVersion: CONTRACT_VERSION,
  }
}

// A process stream that is not a TTY leaves `isTTY` and its size undefined at runtime, whatever the
// type says; the frame needs a boolean and a whole number.
function toSize(isTTY: boolean, size: number): number {
  return isTTY === true && Number.isInteger(size) && size > 0 ? size : 0
}

function toExecEnv(terminal: Terminal): Record<string, string> {
  const env: Record<string, string> = {}

  for (const name of TERMINAL_ENV_NAMES) {
    const value = terminal.env[name]

    if (value !== undefined) {
      env[name] = value
    }
  }

  return env
}

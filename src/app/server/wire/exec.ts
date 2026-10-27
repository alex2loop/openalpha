// /v1/exec — CLI forwarding. One loopback socket runs one CLI command inside the daemon: the
// terminal sends `exec` and then relays its input; the daemon answers `accepted`, the command's
// output, and finally `exit`. Each text message is a JSON object discriminated by `type`.

export const EXEC_PATH = '/v1/exec'

/** Every refusal before `accepted` closes with this code; the reason is `too_many_streams`,
 *  `unavailable`, `invalid_frame` or `contract <N> required`. Nothing has run, so the terminal may
 *  run the command itself. */
export const EXEC_REFUSED_CLOSE_CODE = 4400

/** What the terminal is: which streams are TTYs, and its size (read only for a TTY stream). */
interface ExecTerminalFacts {
  readonly stdinIsTTY: boolean
  readonly stdoutIsTTY: boolean
  readonly stderrIsTTY: boolean
  readonly columns: number
  readonly rows: number
}

/** Terminal → daemon. `env` carries only the rendering and editing names the contract lists; the
 *  daemon drops any other. */
export type ExecClientFrame =
  | {
      readonly type: 'exec'
      readonly argv: readonly string[]
      readonly terminal: ExecTerminalFacts
      readonly env: Readonly<Record<string, string>>
      readonly quiet: boolean
      readonly verbose: boolean
      readonly noColor: boolean
      readonly contractVersion: number
    }
  | { readonly type: 'input'; readonly data: string }
  | { readonly type: 'input_end' }
  | { readonly type: 'resize'; readonly columns: number; readonly rows: number }
  | { readonly type: 'signal'; readonly signal: 'interrupt' | 'terminate' }
  | {
      readonly type: 'edited'
      readonly kind: 'exited'
      readonly code: number
      readonly text?: string
    }
  | { readonly type: 'edited'; readonly kind: 'failed'; readonly message: string }

export type ExecStartFrame = Extract<ExecClientFrame, { readonly type: 'exec' }>

/** Daemon → terminal. After `accepted` the terminal never runs the command itself. */
export type ExecServerFrame =
  | { readonly type: 'accepted' }
  | { readonly type: 'output'; readonly stream: 'out' | 'err'; readonly data: string }
  | { readonly type: 'raw'; readonly on: boolean }
  | {
      readonly type: 'edit'
      readonly editor: string
      readonly fileName: string
      readonly text: string
    }
  | { readonly type: 'exit'; readonly code: number }

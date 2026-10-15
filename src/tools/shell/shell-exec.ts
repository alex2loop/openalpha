import { z } from 'zod'

import { createTool } from '@/core/tool'
import { isToolDetailComplete, TOOL_DETAIL_MAX_LENGTH } from '@/engine/api'
import { assertCommandAllowed, interpretExitCode } from '@/tools/shell/policy'
import { runProcess } from '@/tools/shell/process'

const SHELL_DEFAULT_TIMEOUT_MS = 30_000
const SHELL_MAX_TIMEOUT_MS = 300_000
// What the approval prompt prints of a call; the schema refuses a call whose text would not fit.
const SHELL_DETAIL_KEYS = ['command', 'args'] as const

export const shellExecTool = createTool({
  name: 'shell_exec',
  description:
    "Run an executable in the workspace with the process account, subject to the active run's dangerous-tool approval policy. " +
    'The workspace HOME and cwd plus a small denylist of shells, interpreters, and launchers reduce ' +
    'accidents, but they are not OS containment and do not block every possible command launcher.',
  inputSchema: z
    .object({
      command: z.string().min(1).describe('Executable name or path, without arguments.'),
      args: z
        .array(z.string())
        .default([])
        .describe('Arguments as separate strings, one per array item; never one joined string.'),
      timeout_ms: z
        .number()
        .int()
        .min(1)
        .max(SHELL_MAX_TIMEOUT_MS)
        .default(SHELL_DEFAULT_TIMEOUT_MS)
        .describe(`Milliseconds before the process is killed, up to ${SHELL_MAX_TIMEOUT_MS}.`),
    })
    .refine((input) => isToolDetailComplete(input, SHELL_DETAIL_KEYS), {
      message:
        `command and args together exceed ${TOOL_DETAIL_MAX_LENGTH} characters, more than the ` +
        'approval prompt can show in full. Split the work into several shorter commands.',
    }),
  capability: 'shell',
  presentation: { label: 'Run command', emoji: '⚡', detailKeys: SHELL_DETAIL_KEYS },
  async execute(args, ctx): Promise<string> {
    assertCommandAllowed(args.command, args.args)

    const result = await runProcess(
      {
        command: args.command,
        args: args.args,
        timeoutMs: args.timeout_ms ?? SHELL_DEFAULT_TIMEOUT_MS,
      },
      ctx
    )
    const meaning =
      result.exitCode === null ? null : interpretExitCode(args.command, result.exitCode)

    return JSON.stringify({
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exitCode,
      truncated: result.truncated,
      timed_out: result.timedOut,
      ...(meaning === null ? {} : { exit_code_meaning: meaning }),
    })
  },
})

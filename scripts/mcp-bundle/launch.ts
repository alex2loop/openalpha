// The launcher of the MCP bundle and the npm package, run by the host app's own Node: it starts the
// installed binary with `mcp serve` and stays in front of it, so the host sees one server process.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { LauncherConfig } from './launcher-config'
import { MCP_SERVE_ARGV } from '@/cli/commands/mcp/serve-contract'
import { PATH_PLACEHOLDER, REASON_PLACEHOLDER } from './launcher-config'

declare const LAUNCHER_CONFIG: LauncherConfig

// Read once: the build's `define` inlines the whole object at every reference.
const CONFIG: LauncherConfig = LAUNCHER_CONFIG
const EXIT_FAILED = 1
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM'] as const
const WINDOWS_EXECUTABLE_SUFFIX = '.exe'
const NOT_FOUND_CODE = 'ENOENT'

launch(resolveBinaryPath())

function launch(path: string): void {
  if (!existsSync(path)) {
    report(CONFIG.missingMessageLines, path)

    return
  }

  const child = spawn(path, MCP_SERVE_ARGV, { stdio: 'inherit', windowsHide: true })
  const forward = (signal: NodeJS.Signals): void => {
    child.kill(signal)
  }
  const release = (): void => {
    for (const signal of FORWARDED_SIGNALS) {
      process.off(signal, forward)
    }
  }

  for (const signal of FORWARDED_SIGNALS) {
    process.once(signal, forward)
  }

  child.once('error', (err: NodeJS.ErrnoException) => {
    release()

    if (err.code === NOT_FOUND_CODE) {
      report(CONFIG.missingMessageLines, path)
    } else {
      report(CONFIG.unstartableMessageLines, path, err.message)
    }
  })
  child.once('exit', (code) => {
    release()
    process.exitCode = code ?? EXIT_FAILED
  })
}

// The install folder is the one the install scripts honor; an empty value means the default.
function resolveBinaryPath(): string {
  const installDir =
    process.env[CONFIG.installDirEnv] || join(homedir(), CONFIG.defaultInstallDir)
  const suffix = process.platform === 'win32' ? WINDOWS_EXECUTABLE_SUFFIX : ''

  return join(installDir, `${CONFIG.binaryName}${suffix}`)
}

function report(lines: readonly string[], path: string, reason = ''): void {
  const filled = lines.map((line) =>
    line.replaceAll(PATH_PLACEHOLDER, () => path).replaceAll(REASON_PLACEHOLDER, () => reason)
  )

  process.stderr.write(`${filled.join('\n')}\n`)
  process.exitCode = EXIT_FAILED
}

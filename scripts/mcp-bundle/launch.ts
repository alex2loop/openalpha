// The launcher of the MCP bundle and the npm package, run by the host app's own Node: it starts the
// installed binary with `mcp serve` and stays in front of it, so the host sees one server process.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { LauncherConfig } from './launcher-config'
import { MCP_SERVE_ARGV } from '@/cli/commands/mcp/serve-contract'
import { PATH_PLACEHOLDER } from './launcher-config'

declare const LAUNCHER_CONFIG: LauncherConfig

const EXIT_FAILED = 1
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM'] as const
const WINDOWS_EXECUTABLE_SUFFIX = '.exe'

launch(resolveBinaryPath())

function launch(path: string): void {
  if (!existsSync(path)) {
    reportMissing(path)

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

  child.once('error', (err) => {
    release()
    reportMissing(path, err.message)
  })
  child.once('exit', (code) => {
    release()
    process.exitCode = code ?? EXIT_FAILED
  })
}

// The install folder is the one the install scripts honor; an empty value means the default.
function resolveBinaryPath(): string {
  const installDir =
    process.env[LAUNCHER_CONFIG.installDirEnv] || join(homedir(), LAUNCHER_CONFIG.defaultInstallDir)
  const suffix = process.platform === 'win32' ? WINDOWS_EXECUTABLE_SUFFIX : ''

  return join(installDir, `${LAUNCHER_CONFIG.binaryName}${suffix}`)
}

function reportMissing(path: string, detail?: string): void {
  const lines = LAUNCHER_CONFIG.missingMessageLines.map((line) =>
    line.replaceAll(PATH_PLACEHOLDER, () => path)
  )
  const detailLines = detail === undefined ? [] : [detail]

  process.stderr.write(`${[...lines, ...detailLines].join('\n')}\n`)
  process.exitCode = EXIT_FAILED
}

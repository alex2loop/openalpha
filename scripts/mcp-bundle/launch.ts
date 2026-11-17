// Runs inside the MCP bundle on the host app's own Node: it starts the installed binary with the
// arguments the manifest passes and stays in front of it, so the host sees one server process.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

import { PATH_PLACEHOLDER } from './placeholder'

declare const MISSING_MESSAGE_LINES: readonly string[]

const EXIT_FAILED = 1
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM'] as const
const WINDOWS_EXECUTABLE_SUFFIX = '.exe'

const [binaryPath = '', ...binaryArgs] = process.argv.slice(2)

launch(toExecutablePath(binaryPath), binaryArgs)

function launch(path: string, args: readonly string[]): void {
  if (!existsSync(path)) {
    reportMissing(path)

    return
  }

  const child = spawn(path, args, { stdio: 'inherit', windowsHide: true })
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

// The install scripts put `<name>.exe` on Windows, while the setting's default names no suffix.
function toExecutablePath(path: string): string {
  if (process.platform !== 'win32' || path.endsWith(WINDOWS_EXECUTABLE_SUFFIX)) {
    return path
  }

  const windowsPath = `${path}${WINDOWS_EXECUTABLE_SUFFIX}`

  return existsSync(windowsPath) ? windowsPath : path
}

function reportMissing(path: string, detail?: string): void {
  const lines = MISSING_MESSAGE_LINES.map((line) => line.replaceAll(PATH_PLACEHOLDER, path))
  const detailLines = detail === undefined ? [] : [detail]

  process.stderr.write(`${[...lines, ...detailLines].join('\n')}\n`)
  process.exitCode = EXIT_FAILED
}

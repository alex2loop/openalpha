import { spawn } from 'node:child_process'

import type { CliApp } from '@/cli/types'
import { getEnv } from '@/cli/env'
import { fail } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { t } from '@/i18n'

// PowerShell cannot take the file as a positional argument, so it reads it from the environment.
const FILE_ENV = BRAND.controlEnv.editorFile

export function isEditorSet(editor: string | undefined): editor is string {
  return editor !== undefined && editor.trim() !== ''
}

export function openInEditor(editor: string, path: string, app: CliApp): Promise<number> {
  const command = editor.trim()

  if (command === '') {
    app.err(fail(t(app.config.locale.language, 'cli.editorNoEditorShort')))

    return Promise.resolve(1)
  }

  return new Promise((resolve) => {
    const { file, args } = editorInvocation(command, path)
    const env = { ...getEnv(), [FILE_ENV]: path }
    const child = spawn(file, args, { stdio: 'inherit', env, windowsHide: true })

    child.on('error', (err: Error) => {
      app.err(
        fail(
          t(app.config.locale.language, 'cli.editorLaunchFailed', { command, message: err.message })
        )
      )
      resolve(1)
    })

    // Every path settles: 'close' fires even when the editor was killed by a signal.
    child.on('close', (code) => resolve(code ?? 1))
  })
}

// The editor value is shell text (it may quote a path or carry flags), as in git; the file is
// never part of that text, only a positional argument or an environment value.
function editorInvocation(
  command: string,
  path: string
): { readonly file: string; readonly args: string[] } {
  if (process.platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-Command', `& ${command} $env:${FILE_ENV}`],
    }
  }

  return { file: 'sh', args: ['-c', `${command} "$@"`, 'editor', path] }
}

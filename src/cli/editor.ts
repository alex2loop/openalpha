import type { CliApp } from '@/cli/types'
import { fail } from '@/cli/ui/colors'
import { t } from '@/i18n'

export function isEditorSet(editor: string | undefined): editor is string {
  return editor !== undefined && editor.trim() !== ''
}

export async function openInEditor(editor: string, path: string, app: CliApp): Promise<number> {
  const command = editor.trim()

  if (command === '') {
    app.err(fail(t(app.config.locale.language, 'cli.editorNoEditorShort')))

    return 1
  }

  const exit = await app.terminal.openEditor(command, path)

  if (exit.kind === 'failed') {
    app.err(
      fail(
        t(app.config.locale.language, 'cli.editorLaunchFailed', { command, message: exit.message })
      )
    )

    return 1
  }

  return exit.code
}

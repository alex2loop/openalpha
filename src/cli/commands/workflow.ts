import { createCommand, createGroup, type Group } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { flagString } from '@/cli/parsing/args'
import { fail, hint, style, success } from '@/cli/ui/colors'
import { formatUsd } from '@/core/utils/cost'
import { runWorkflow } from '@/engine/api'
import { t } from '@/i18n'

const workflowListCommand = createCommand({
  name: 'list',
  summary: { key: 'cliHelp.workflowListSummary' },
  run(_args, app): number {
    const locale = app.config.locale.language
    const workflows = app.resolve('workflows')

    app.out(style.heading(t(locale, 'cli.workflowHeading', { count: workflows.size })))
    if (workflows.size === 0) {
      app.out(hint(t(locale, 'cli.workflowNonePlaceholder')))
    }
    for (const wf of workflows.values()) {
      const when =
        wf.schedule === undefined ? hint(t(locale, 'cli.workflowManual')) : hint(`(${wf.schedule})`)
      const desc = wf.description === undefined ? '' : ` - ${wf.description}`

      app.out(`  ${wf.id} ${when}${desc}`)
    }

    return 0
  },
})

const workflowRunCommand = createCommand({
  name: 'run',
  summary: { key: 'cliHelp.workflowRunSummary' },
  spec: { positional: ['id'] },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const id = flagString(args, 'id')

    if (id === undefined) {
      return usage(app, t(locale, 'cli.workflowRunUsage'))
    }

    const workflow = app.resolve('workflows').get(id)

    if (workflow === undefined) {
      app.err(fail(t(locale, 'cli.workflowNotFound', { id })))

      return 1
    }

    app.out(t(locale, 'cli.workflowRunningStatus', { id: workflow.id }))
    const result = await runWorkflow({
      runner: app.resolve('runner'),
      logger: app.resolve('logger'),
      workflow,
      parentSignal: app.signal,
    })

    if (!result.ok) {
      app.err(
        fail(
          t(locale, 'cli.workflowFailed', {
            id: workflow.id,
            error: result.error ?? 'unknown error',
          })
        )
      )

      return 1
    }

    app.out(
      success(
        t(locale, 'cli.workflowDone', { steps: result.steps, cost: formatUsd(result.costUsd) })
      )
    )

    return 0
  },
})

export const workflowCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.workflow,
  subcommands: [workflowListCommand, workflowRunCommand],
})

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { parse as parseToml } from 'smol-toml'
import { z } from 'zod'

import type { Logger } from '@/core/logging/logger'
import { OperatorConfigError } from '@/core/config/resolve'
import { ConfigError } from '@/core/errors'
import { agentId, isPathId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { advanceCron } from '@/core/utils/cron'

import type { Workflow, WorkflowStep } from './types'
import { assertWorkflowStepCompleted } from './run'

const WorkflowTomlSchema = z.strictObject({
  id: z.string().min(1),
  description: z.string().optional(),
  schedule: z.string().optional(),
  tz: z.string().optional(),
  steps: z
    .array(
      z.strictObject({
        agent: z
          .string()
          .refine(isPathId, 'must be a lowercase path identifier')
          .transform(agentId),
        prompt: z.string().min(1),
      })
    )
    .min(1, 'workflow.toml needs at least one [[steps]] entry'),
})

export const BUILT_IN_WORKFLOWS: readonly Workflow[] = []

// The cron expression is validated eagerly, at creation: a bad schedule must fail at load, not
// silently never fire.
function createWorkflow(wf: Workflow): Workflow {
  if (wf.id.trim() === '') {
    throw new ConfigError('createWorkflow({ id }) must be a non-empty string')
  }

  if (typeof wf.run !== 'function') {
    throw new ConfigError(`createWorkflow({ run }) for '${wf.id}' must be a function`)
  }

  if (wf.source.trim() === '') {
    throw new ConfigError(`createWorkflow({ source }) for '${wf.id}' must be a non-empty string`)
  }

  if (wf.schedule !== undefined) {
    advanceCron(wf.schedule, new Date(0), wf.tz)
  }

  return Object.freeze(wf)
}

export function loadWorkflowToml(toml: string, source: string): Workflow {
  const parsed = WorkflowTomlSchema.safeParse(parseToml(toml))

  if (!parsed.success) {
    const issue = parsed.error.issues[0]

    throw new OperatorConfigError(
      `workflow.toml is invalid: ${issue?.path.join('.')} ${issue?.message}`,
      {
        key: 'errors.workflowInvalid',
        params: { detail: `${issue?.path.join('.')} ${issue?.message}` },
      }
    )
  }

  const { id, description, schedule, tz } = parsed.data
  const steps: readonly WorkflowStep[] = parsed.data.steps

  return createWorkflow({
    id,
    source,
    ...(description === undefined ? {} : { description }),
    ...(schedule === undefined ? {} : { schedule }),
    ...(tz === undefined ? {} : { tz }),
    run: async (ctx) => {
      for (const step of steps) {
        const result = await ctx.run(step.agent, step.prompt)
        assertWorkflowStepCompleted(result)
      }
    },
  })
}

export function addWorkflow(target: Map<string, Workflow>, workflow: Workflow): void {
  const existing = target.get(workflow.id)

  if (existing !== undefined) {
    throw new OperatorConfigError(
      `workflow id '${workflow.id}' is duplicated between '${existing.source}' and '${workflow.source}'`,
      { key: 'errors.workflowDuplicate', params: { id: workflow.id } }
    )
  }

  target.set(workflow.id, workflow)
}

// A malformed workflow is skipped with a warning, never fatal: one bad file must not stop the rest.
export async function loadUserWorkflows(dir: string, logger: Logger): Promise<readonly Workflow[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.toml'))
    .sort((a, b) => a.name.localeCompare(b.name))

  const loaded = await Promise.all(
    files.map(async (file) => {
      const source = join(dir, file.name)

      try {
        return loadWorkflowToml(await Bun.file(source).text(), source)
      } catch (err: unknown) {
        logger.warn('workflow.user_skipped', { file: file.name, err: formatErrForLog(err) })

        return undefined
      }
    })
  )

  const workflows = new Map<string, Workflow>()

  for (const workflow of loaded) {
    if (workflow === undefined) {
      continue
    }

    addWorkflow(workflows, workflow)
  }

  return [...workflows.values()]
}

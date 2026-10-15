import { hint, style, success } from '@/cli/ui/colors'
import { confirmDefaultYes, declined } from '@/cli/ui/prompt'
import { BRAND } from '@/core/brand'
import { isPlainRecord } from '@/core/utils/collections'
import { t } from '@/i18n'

import type { AskContext } from './ask'
import type { ConfigEdit } from './config-file'
import type { ModelAnswer } from './model-step'
import { askChoice } from './ask'
import { finishModelChange } from './check'
import { editedConfigToml, readExistingConfig, saveEditedConfig } from './config-file'
import { askModel } from './model-step'
import { printNextSteps } from './next-steps'
import { askBudget, askLanguage, askTelegramTokenEnv } from './settings-step'

type Section = ConfigEdit['kind'] | 'quit'

interface PlannedEdit {
  readonly edit: ConfigEdit
  readonly chosen?: ModelAnswer
}

const SECTION_LABEL_KEYS = {
  model: 'cli.onboardSectionModel',
  telegram: 'cli.onboardSectionTelegram',
  budget: 'cli.onboardSectionBudget',
  language: 'cli.onboardSectionLanguage',
  quit: 'cli.onboardSectionQuit',
} as const satisfies Record<Section, string>
const SECTIONS = Object.keys(SECTION_LABEL_KEYS) as readonly Section[]

/** Re-running setup changes one part of a config that exists, never the whole file. */
export async function editExistingConfig(ctx: AskContext, configPath: string): Promise<number> {
  ctx.app.out(style.title(t(ctx.locale, 'cli.onboardSetupTitle', { brand: BRAND.display })))

  const existing = await readExistingConfig(configPath)

  ctx.app.out(t(ctx.locale, 'cli.onboardConfigFound', { path: configPath }))

  const section = await askChoice(ctx, {
    question: t(ctx.locale, 'cli.onboardPromptSection'),
    choices: SECTIONS.map((value) => ({ label: t(ctx.locale, SECTION_LABEL_KEYS[value]), value })),
    defaultIndex: 0,
  })

  if (section === 'quit') {
    return 0
  }

  const planned = await planEdit(ctx, section, existing.table)
  const after = editedConfigToml(existing.table, planned.edit)

  ctx.app.out(hint(t(ctx.locale, 'cli.onboardRewriteNote')))

  if (!(await confirmDefaultYes(ctx.prompt, t(ctx.locale, 'cli.onboardSaveConfirm'), ctx.locale))) {
    return declined(ctx.app, ctx.locale)
  }

  const backupPath = await saveEditedConfig(configPath, { before: existing.text, after })

  ctx.app.out(success(t(ctx.locale, 'cli.onboardSaved', { path: configPath, backup: backupPath })))
  await afterEdit(ctx, planned, configPath)

  return 0
}

async function planEdit(
  ctx: AskContext,
  section: ConfigEdit['kind'],
  table: Readonly<Record<string, unknown>>
): Promise<PlannedEdit> {
  switch (section) {
    case 'model': {
      const chosen = await askModel(ctx)

      return { edit: { kind: 'model', model: chosen.starter }, chosen }
    }
    case 'telegram':
      return { edit: { kind: 'telegram', tokenEnv: await askTelegramTokenEnv(ctx) } }
    case 'budget':
      return { edit: { kind: 'budget', dailyUsd: await askBudget(ctx, currentBudget(table)) } }
    case 'language':
      return { edit: { kind: 'language', language: await askLanguage(ctx) } }
  }
}

function currentBudget(table: Readonly<Record<string, unknown>>): number {
  const daily = isPlainRecord(table.budget) ? table.budget.max_daily_usd : undefined

  return typeof daily === 'number' ? daily : 0
}

async function afterEdit(ctx: AskContext, planned: PlannedEdit, configPath: string): Promise<void> {
  if (planned.chosen !== undefined) {
    await finishModelChange(ctx, { chosen: planned.chosen, configPath, firstRun: false })

    return
  }

  printNextSteps(ctx, {
    signedIn: true,
    firstRun: false,
    ...(planned.edit.kind === 'telegram' ? { telegramTokenEnv: planned.edit.tokenEnv } : {}),
  })
}

import { hint, style, success } from '@/cli/ui/colors'
import { confirmDefaultYes } from '@/cli/ui/prompt'
import { BRAND } from '@/core/brand'
import { isPlainRecord } from '@/core/utils/collections'
import { t } from '@/i18n'

import type { AskContext } from './ask'
import type { ConfigEdit, ExistingConfig } from './config-file'
import type { ModelAnswer } from './model-step'
import { askChoice, StepBack } from './ask'
import { finishModelChange } from './check'
import { editedConfigToml, readExistingConfig, saveEditedConfig } from './config-file'
import { askModelAnswer } from './list-steps'
import { printNextSteps } from './next-steps'
import { offerSaveKeys } from './save-key'
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

/** Re-running setup changes one part of a config that exists at a time, never the whole file, and
 *  comes back to the section menu until the operator is done. */
export async function editExistingConfig(ctx: AskContext, configPath: string): Promise<number> {
  ctx.app.out(style.title(t(ctx.locale, 'cli.onboardSetupTitle', { brand: BRAND.display })))
  ctx.app.out(t(ctx.locale, 'cli.onboardConfigFound', { path: configPath }))

  let current = ctx

  for (;;) {
    const existing = await readExistingConfig(configPath)
    const planned = await askSectionEdit(current, existing.table)

    if (planned === undefined) {
      return 0
    }

    const saved = await saveSection(current, { planned, configPath, existing })

    if (saved && planned.edit.kind === 'language') {
      current = { ...current, locale: planned.edit.language }
    }
  }
}

/** The section menu, asked again with that section marked when Left leaves the section's first
 *  list question. Undefined is quit. */
async function askSectionEdit(
  ctx: AskContext,
  table: Readonly<Record<string, unknown>>
): Promise<PlannedEdit | undefined> {
  let defaultIndex = 0

  for (;;) {
    const section = await askChoice(ctx, {
      question: t(ctx.locale, 'cli.onboardPromptSection'),
      choices: SECTIONS.map((value) => ({
        label: t(ctx.locale, SECTION_LABEL_KEYS[value]),
        value,
      })),
      defaultIndex,
    })

    if (section === 'quit') {
      return undefined
    }

    try {
      return await planEdit({ ...ctx, canGoBack: true }, section, table)
    } catch (err: unknown) {
      if (!(err instanceof StepBack)) {
        throw err
      }

      defaultIndex = SECTIONS.indexOf(section)
    }
  }
}

async function planEdit(
  ctx: AskContext,
  section: ConfigEdit['kind'],
  table: Readonly<Record<string, unknown>>
): Promise<PlannedEdit> {
  switch (section) {
    case 'model': {
      const chosen = await askModelAnswer(ctx)

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

/** Writes one section's change once the operator confirms; false when they decline, which leaves
 *  the file as it was. */
async function saveSection(
  ctx: AskContext,
  input: {
    readonly planned: PlannedEdit
    readonly configPath: string
    readonly existing: ExistingConfig
  }
): Promise<boolean> {
  const after = editedConfigToml(input.existing.table, input.planned.edit)

  ctx.app.out(hint(t(ctx.locale, 'cli.onboardRewriteNote')))

  if (!(await confirmDefaultYes(ctx.prompt, t(ctx.locale, 'cli.onboardSaveConfirm'), ctx.locale))) {
    ctx.app.out(hint(t(ctx.locale, 'cli.onboardNotSaved')))

    return false
  }

  const backupPath = await saveEditedConfig(input.configPath, {
    before: input.existing.text,
    after,
  })

  ctx.app.out(
    success(t(ctx.locale, 'cli.onboardSaved', { path: input.configPath, backup: backupPath }))
  )
  await afterEdit(ctx, input.planned, input.configPath)

  return true
}

async function afterEdit(ctx: AskContext, planned: PlannedEdit, configPath: string): Promise<void> {
  if (planned.chosen !== undefined) {
    await finishModelChange(ctx, { chosen: planned.chosen, configPath, firstRun: false })

    return
  }

  const telegramTokenEnv = planned.edit.kind === 'telegram' ? planned.edit.tokenEnv : undefined

  printNextSteps(ctx, {
    signedIn: true,
    saved: await offerSaveKeys(ctx, [telegramTokenEnv]),
    firstRun: false,
    ...(telegramTokenEnv === undefined ? {} : { telegramTokenEnv }),
  })
}

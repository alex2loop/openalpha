import { createGroup, type Group } from '@/cli/command'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'

import { scheduleAddCommand } from './add'
import { scheduleEditCommand } from './edit'
import { scheduleListCommand } from './list'
import { scheduleRunNowCommand } from './run'
import { scheduleShowCommand } from './show'
import { schedulePauseCommand, scheduleRemoveCommand, scheduleResumeCommand } from './state'

export const scheduleCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.schedule,
  subcommands: [
    scheduleListCommand,
    scheduleShowCommand,
    scheduleAddCommand,
    scheduleEditCommand,
    scheduleRemoveCommand,
    schedulePauseCommand,
    scheduleResumeCommand,
    scheduleRunNowCommand,
  ],
})

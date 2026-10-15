import { createGroup, type Group } from '@/cli/command'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'

import { socialAddCommand } from './add'
import { socialApproveCommand, socialDiscardCommand, socialDraftsCommand } from './drafts'
import { socialJoinCommand } from './join'
import { socialLeaveCommand } from './leave'
import { socialListCommand } from './list'
import { socialLogCommand } from './log'
import { socialRekeyCommand } from './rekey'
import { socialRemoveCommand } from './remove'
import { socialReviewCommand } from './review'
import { socialRollbackCommand } from './rollback'
import { socialPauseCommand, socialResumeCommand } from './state'
import { socialUpdateCommand } from './update'

export const socialCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.social,
  subcommands: [
    socialListCommand,
    socialAddCommand,
    socialUpdateCommand,
    socialRollbackCommand,
    socialRemoveCommand,
    socialPauseCommand,
    socialResumeCommand,
    socialJoinCommand,
    socialLeaveCommand,
    socialRekeyCommand,
    socialReviewCommand,
    socialDraftsCommand,
    socialApproveCommand,
    socialDiscardCommand,
    socialLogCommand,
  ],
})

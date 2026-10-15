import type { SocialStore } from '@/core/types/social'
import type { Dialect, Storage } from '@/core/types/storage'
import { createSocialDraftReads, createSocialDraftWrites } from '@/persistence/stores/social/drafts'
import {
  createSocialMembershipState,
  createSocialMemberships,
} from '@/persistence/stores/social/memberships'
import { createSocialNetworks } from '@/persistence/stores/social/networks'
import { createSocialWrites } from '@/persistence/stores/social/writes'

export function createSocialStore(db: Storage, dialect: Dialect): SocialStore {
  return {
    ...createSocialNetworks(db, dialect),
    ...createSocialMemberships(db, dialect),
    ...createSocialMembershipState(db, dialect),
    ...createSocialWrites(db, dialect),
    ...createSocialDraftReads(db, dialect),
    ...createSocialDraftWrites(db, dialect),
  }
}

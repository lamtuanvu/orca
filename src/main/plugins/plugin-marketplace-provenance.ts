import {
  OFFICIAL_MARKETPLACE_OWNER,
  isOfficialMarketplaceGitSource,
  isOfficialOrganizationGitSource,
  isReservedPluginIdentity,
  resolveMarketplaceCheckoutSource
} from '../../shared/plugins/plugin-marketplace'
import type { PluginMarketplaceFetchResult } from './plugin-marketplace-fetch'
import type { PluginMarketplaceRegisteredSource } from './plugin-marketplace-store'

export function validateMarketplaceProvenance(
  source: PluginMarketplaceRegisteredSource,
  fetched: PluginMarketplaceFetchResult
): void {
  if (
    isOfficialMarketplaceGitSource(source.source.url) &&
    fetched.marketplace.owner.toLowerCase() !== OFFICIAL_MARKETPLACE_OWNER
  ) {
    throw new Error('official marketplace metadata has an unexpected owner')
  }
  for (const entry of fetched.marketplace.plugins) {
    const checkout = resolveMarketplaceCheckoutSource(source.source, entry.source)
    if (isReservedPluginIdentity(entry.id) && !isOfficialOrganizationGitSource(checkout.url)) {
      throw new Error(
        `reserved plugin identity ${entry.id} must resolve to the stablyai organization`
      )
    }
  }
}

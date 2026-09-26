import type {
  PluginMarketplaceCheckoutSource,
  PluginMarketplaceGitSource
} from '../../shared/plugins/plugin-marketplace'

export type PluginMarketplaceSourceState = {
  id: string
  source: PluginMarketplaceGitSource
  addedAt: number
  marketplace: {
    name: string
    owner: string
    resolvedCommit: string
    fetchedAt: number
  } | null
  stale: boolean
  official: boolean
  error?: string
}

export type PluginMarketplaceListing = {
  marketplaceSourceId: string
  marketplaceName: string
  marketplaceOwner: string
  marketplaceCommit: string
  pluginKey: string
  /** Resolved checkout: in-repo entries point at the marketplace repository plus `path`. */
  source: PluginMarketplaceCheckoutSource
  description?: string
  categories: string[]
  official: boolean
  bundled: boolean
  blockedByKillList?: { reason: string; advisoryUrl?: string }
}

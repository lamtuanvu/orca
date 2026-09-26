import type {
  PluginHostListEntry,
  PluginMarketplaceHostListing
} from '../../../../preload/api-types'

/** What a marketplace card offers for this listing given what is installed.
 * `switch-source` replaces a folder/zip/Git install with the listed version in place. */
export type PluginMarketplaceListingAction =
  | 'install'
  | 'update-available'
  | 'check-update'
  | 'switch-source'
  | 'none'

export function pluginMarketplaceListingAction(
  listing: PluginMarketplaceHostListing,
  installed: PluginHostListEntry | null
): PluginMarketplaceListingAction {
  if (!installed) {
    return 'install'
  }
  const source = installed.source
  if (installed.isDev || installed.bundled || !source) {
    return 'none'
  }
  if (source.kind !== 'marketplace') {
    return 'switch-source'
  }
  // Why: a differing pinned ref from the same plugin repository is a known update without
  // any network call; in-repo listings move with the index commit, so they need a check.
  const sameRepository = source.reference === listing.source.url
  return sameRepository && !listing.source.path && source.ref && source.ref !== listing.source.ref
    ? 'update-available'
    : 'check-update'
}

import type { PluginMarketplaceHostSourceState } from '../../../../preload/api-types'

const MARKETPLACE_STALE_AFTER_MS = 12 * 60 * 60 * 1000

/** True when any source was never fetched or its cached index is older than 12 hours. */
export function hasStaleMarketplaceIndex(
  sources: readonly PluginMarketplaceHostSourceState[] | null,
  now: number
): boolean {
  return (sources ?? []).some(
    (source) =>
      !source.marketplace || now - source.marketplace.fetchedAt > MARKETPLACE_STALE_AFTER_MS
  )
}

import { describe, expect, it } from 'vitest'
import type {
  PluginHostListEntry,
  PluginMarketplaceHostListing
} from '../../../../preload/api-types'
import { pluginMarketplaceListingAction } from './plugin-marketplace-listing-action'

const URL = 'https://git.example/acme/notes.git'

function listing(
  source: Partial<PluginMarketplaceHostListing['source']> = {}
): PluginMarketplaceHostListing {
  return {
    marketplaceSourceId: 'c'.repeat(32),
    marketplaceName: 'Acme',
    marketplaceOwner: 'acme',
    marketplaceCommit: 'd'.repeat(40),
    pluginKey: 'acme.notes',
    source: { kind: 'git', url: URL, ref: 'v2.0.0', ...source },
    categories: [],
    official: false,
    bundled: false
  }
}

function installed(overrides: Partial<PluginHostListEntry> = {}): PluginHostListEntry {
  return {
    pluginKey: 'acme.notes',
    consentFingerprint: 'sha256-x',
    name: 'Notes',
    version: '1.0.0',
    publisher: 'acme',
    status: 'idle',
    needsReconsent: false,
    isDev: false,
    official: false,
    bundled: false,
    capabilities: [],
    panels: [],
    commands: [],
    hasWorker: false,
    restarts: 0,
    source: {
      kind: 'marketplace',
      reference: URL,
      ref: 'v1.0.0',
      resolvedCommit: 'a'.repeat(40),
      contentHash: 'b'.repeat(64)
    },
    ...overrides
  }
}

describe('pluginMarketplaceListingAction', () => {
  it('offers install when nothing is installed', () => {
    expect(pluginMarketplaceListingAction(listing(), null)).toBe('install')
  })

  it('flags a known update when the listed ref moved for the same repository', () => {
    expect(pluginMarketplaceListingAction(listing(), installed())).toBe('update-available')
    expect(pluginMarketplaceListingAction(listing({ ref: 'v1.0.0' }), installed())).toBe(
      'check-update'
    )
    expect(
      pluginMarketplaceListingAction(listing({ url: 'https://other/x.git' }), installed())
    ).toBe('check-update')
  })

  it('always checks in-repo listings, which move with the index commit', () => {
    expect(pluginMarketplaceListingAction(listing({ path: 'plugins/notes' }), installed())).toBe(
      'check-update'
    )
  })

  it('offers an in-place switch for folder, zip, and Git installs', () => {
    for (const kind of ['local-path', 'archive', 'git'] as const) {
      expect(
        pluginMarketplaceListingAction(
          listing(),
          installed({
            source: { kind, reference: 'x', resolvedCommit: null, contentHash: 'b'.repeat(64) }
          })
        )
      ).toBe('switch-source')
    }
  })

  it('offers nothing for dev overrides and bundled plugins', () => {
    expect(pluginMarketplaceListingAction(listing(), installed({ isDev: true }))).toBe('none')
    expect(pluginMarketplaceListingAction(listing(), installed({ bundled: true }))).toBe('none')
  })
})

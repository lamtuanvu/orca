import { describe, expect, it } from 'vitest'
import {
  OFFICIAL_MARKETPLACE_REPOSITORY,
  PLUGIN_MARKETPLACE_CATEGORY_LIMIT,
  PLUGIN_MARKETPLACE_ENTRY_LIMIT,
  isMarketplaceListingSupported,
  isOfficialMarketplaceGitSource,
  isOfficialOrganizationGitSource,
  isOfficialPluginIdentity,
  isReservedPluginIdentity,
  expandMarketplaceUrlInput,
  parseGitRepositoryIdentity,
  parsePluginMarketplaceIndex,
  pluginMarketplaceEntrySourceSchema,
  pluginMarketplaceSchema,
  resolveMarketplaceCheckoutSource,
  pluginMarketplaceTrustMetadataSchema
} from './plugin-marketplace'

function listing(id = 'community.nord'): Record<string, unknown> {
  return {
    id,
    source: { kind: 'git', url: 'https://github.com/community/nord.git', ref: 'v1.0.0' },
    description: 'A theme pack',
    categories: ['themes']
  }
}

describe('pluginMarketplaceSchema', () => {
  it('parses a bounded, pinned Git marketplace index', () => {
    expect(
      pluginMarketplaceSchema.parse({
        name: 'Community plugins',
        owner: 'community',
        plugins: [listing()]
      })
    ).toEqual({
      name: 'Community plugins',
      owner: 'community',
      plugins: [listing()]
    })
  })

  it.each([
    ['root', { name: 'Plugins', owner: 'team', plugins: [], extra: true }],
    ['entry', { name: 'Plugins', owner: 'team', plugins: [{ ...listing(), official: true }] }],
    [
      'source',
      {
        name: 'Plugins',
        owner: 'team',
        plugins: [
          {
            ...listing(),
            source: {
              kind: 'git',
              url: 'https://github.com/community/nord.git',
              ref: 'main',
              depth: 1
            }
          }
        ]
      }
    ]
  ])('rejects unknown keys at the %s boundary', (_boundary, marketplace) => {
    expect(pluginMarketplaceSchema.safeParse(marketplace).success).toBe(false)
  })

  it.each([
    ['an unqualified id', { ...listing(), id: 'nord' }],
    [
      'a missing ref',
      {
        ...listing(),
        source: { kind: 'git', url: 'https://github.com/community/nord.git', ref: '' }
      }
    ],
    [
      'an executable Git transport',
      {
        ...listing(),
        source: { kind: 'git', url: 'ext::sh -c exploit', ref: 'main' }
      }
    ],
    ['a duplicate category', { ...listing(), categories: ['themes', 'themes'] }],
    [
      'too many categories',
      {
        ...listing(),
        categories: Array.from(
          { length: PLUGIN_MARKETPLACE_CATEGORY_LIMIT + 1 },
          (_, index) => `category-${index}`
        )
      }
    ]
  ])('rejects %s', (_label, entry) => {
    expect(
      pluginMarketplaceSchema.safeParse({ name: 'Plugins', owner: 'team', plugins: [entry] })
        .success
    ).toBe(false)
  })

  it('rejects duplicate plugin identities', () => {
    const parsed = pluginMarketplaceSchema.safeParse({
      name: 'Plugins',
      owner: 'team',
      plugins: [listing(), listing()]
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: 'duplicate plugin id: community.nord' })
        ])
      )
    }
  })

  it('caps the marketplace entry count', () => {
    const plugins = Array.from({ length: PLUGIN_MARKETPLACE_ENTRY_LIMIT + 1 }, (_, index) =>
      listing(`publisher.plugin-${index}`)
    )
    expect(
      pluginMarketplaceSchema.safeParse({ name: 'Plugins', owner: 'team', plugins }).success
    ).toBe(false)
  })
})

describe('marketplace provenance contracts', () => {
  it.each([
    ['stablyai.orca-skills', true, true],
    ['stablyai.skills', true, false],
    ['community.orca-skills', true, false],
    ['community.skills', false, false],
    ['invalid', false, false]
  ])('classifies %s', (pluginKey, reserved, official) => {
    expect(isReservedPluginIdentity(pluginKey)).toBe(reserved)
    expect(isOfficialPluginIdentity(pluginKey)).toBe(official)
  })

  it.each([
    'https://github.com/stablyai/orca-skills.git',
    'ssh://git@github.com/stablyai/orca-skills.git',
    'git@github.com:stablyai/orca-skills.git'
  ])('accepts official organization source %s', (source) => {
    expect(isOfficialOrganizationGitSource(source)).toBe(true)
  })

  it('does not trust lookalike organizations or hosts', () => {
    expect(isOfficialOrganizationGitSource('https://github.com/stablyai-fakes/orca-skills')).toBe(
      false
    )
    expect(isOfficialOrganizationGitSource('https://gitlab.com/stablyai/orca-skills')).toBe(false)
  })

  it('recognizes only the canonical official marketplace repository', () => {
    expect(
      isOfficialMarketplaceGitSource(
        `git@github.com:stablyai/${OFFICIAL_MARKETPLACE_REPOSITORY}.git`
      )
    ).toBe(true)
    expect(isOfficialMarketplaceGitSource('git@github.com:stablyai/plugins.git')).toBe(false)
  })

  it('parses nested repository paths without confusing the repository name', () => {
    expect(parseGitRepositoryIdentity('https://gitlab.com/team/subgroup/plugin.git')).toEqual({
      host: 'gitlab.com',
      owner: 'team',
      repository: 'plugin'
    })
  })

  it('prevents an untrusted listing from self-awarding trust metadata', () => {
    expect(pluginMarketplaceTrustMetadataSchema.parse({ official: true, bundled: true })).toEqual({
      official: true,
      bundled: true
    })
    expect(
      pluginMarketplaceTrustMetadataSchema.safeParse({ official: false, bundled: true }).success
    ).toBe(false)
  })

  it('marks listings with a deferred contribution category as unsupported', () => {
    expect(isMarketplaceListingSupported(['vm-recipes', 'official'])).toBe(true)
    expect(isMarketplaceListingSupported(['keybindings'])).toBe(true)
    expect(isMarketplaceListingSupported([])).toBe(true)
    for (const deferred of ['themes', 'icons', 'icon-themes', 'terminal-themes', 'skills']) {
      expect(isMarketplaceListingSupported([deferred, 'official'])).toBe(false)
    }
  })
})

describe('marketplace-hosted plugin folders', () => {
  it('normalizes ./ and trailing slashes and rejects folders outside the repository', () => {
    expect(
      pluginMarketplaceEntrySourceSchema.parse({ kind: 'path', path: './plugins/notes/' })
    ).toEqual({ kind: 'path', path: 'plugins/notes' })
    for (const path of ['../notes', '/plugins/notes', 'plugins\\notes', 'plugins/../../x', '']) {
      expect(pluginMarketplaceEntrySourceSchema.safeParse({ kind: 'path', path }).success).toBe(
        false
      )
    }
  })

  it('resolves an in-repo entry to the marketplace repository and ref', () => {
    const marketplace = { kind: 'git' as const, url: 'https://git.example/team/p.git', ref: 'main' }
    expect(
      resolveMarketplaceCheckoutSource(marketplace, { kind: 'path', path: 'plugins/notes' })
    ).toEqual({ ...marketplace, path: 'plugins/notes' })
    const external = { kind: 'git' as const, url: 'https://git.example/x.git', ref: 'v1' }
    expect(resolveMarketplaceCheckoutSource(marketplace, external)).toBe(external)
  })
})

describe('parsePluginMarketplaceIndex', () => {
  it('skips unreadable and duplicate entries instead of rejecting the whole index', () => {
    const parsed = parsePluginMarketplaceIndex({
      name: 'Plugins',
      owner: 'team',
      plugins: [
        { id: 'team.notes', source: { kind: 'path', path: 'plugins/notes' } },
        { id: 'team.future', source: { kind: 'npm', package: 'x' } },
        { id: 'not-qualified', source: { kind: 'path', path: 'x' } },
        { id: 'team.notes', source: { kind: 'path', path: 'plugins/other' } }
      ]
    })
    expect(parsed.skippedEntries).toBe(3)
    expect(parsed.marketplace.plugins).toEqual([
      { id: 'team.notes', source: { kind: 'path', path: 'plugins/notes' }, categories: [] }
    ])
  })

  it('still rejects an index whose envelope is invalid', () => {
    expect(() => parsePluginMarketplaceIndex({ name: 'Plugins', plugins: [] })).toThrow()
  })
})

describe('expandMarketplaceUrlInput', () => {
  it('expands GitHub owner/repo shorthand and leaves full URLs alone', () => {
    expect(expandMarketplaceUrlInput(' acme/orca-plugins ')).toBe(
      'https://github.com/acme/orca-plugins.git'
    )
    expect(expandMarketplaceUrlInput('acme/orca-plugins.git')).toBe(
      'https://github.com/acme/orca-plugins.git'
    )
    for (const url of [
      'https://gitlab.com/acme/orca-plugins.git',
      'git@gitlab.com:acme/orca-plugins.git',
      'gitlab.com/acme'
    ]) {
      expect(expandMarketplaceUrlInput(url)).toBe(url)
    }
  })
})

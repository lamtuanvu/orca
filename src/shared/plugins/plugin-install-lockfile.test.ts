import { describe, expect, it } from 'vitest'
import { parsePluginLockfile, pluginInstallSourceSchema } from './plugin-install-lockfile'

describe('pluginInstallSourceSchema marketplace provenance', () => {
  it('records both the marketplace snapshot and plugin Git ref', () => {
    expect(
      pluginInstallSourceSchema.parse({
        kind: 'marketplace',
        marketplace: {
          url: 'https://github.com/stablyai/orca-plugins.git',
          ref: 'main',
          resolvedCommit: 'a'.repeat(40)
        },
        plugin: {
          url: 'git@github.com:stablyai/orca-skills.git',
          ref: 'v1.0.0'
        }
      })
    ).toEqual({
      kind: 'marketplace',
      marketplace: {
        url: 'https://github.com/stablyai/orca-plugins.git',
        ref: 'main',
        resolvedCommit: 'a'.repeat(40)
      },
      plugin: {
        url: 'git@github.com:stablyai/orca-skills.git',
        ref: 'v1.0.0'
      }
    })
  })

  it('requires pinned refs and an exact marketplace snapshot commit', () => {
    expect(
      pluginInstallSourceSchema.safeParse({
        kind: 'marketplace',
        marketplace: {
          url: 'https://github.com/stablyai/orca-plugins.git',
          ref: '',
          resolvedCommit: 'main'
        },
        plugin: {
          url: 'https://github.com/stablyai/orca-skills.git',
          ref: ''
        }
      }).success
    ).toBe(false)
  })
})

describe('pluginInstallSourceSchema marketplace-hosted folders', () => {
  it('accepts a safe folder inside the marketplace repository and rejects escapes', () => {
    const source = (path: string) => ({
      kind: 'marketplace',
      marketplace: {
        url: 'https://github.com/acme/orca-plugins.git',
        ref: 'main',
        resolvedCommit: 'a'.repeat(40)
      },
      plugin: { url: 'https://github.com/acme/orca-plugins.git', ref: 'main', path }
    })
    expect(pluginInstallSourceSchema.safeParse(source('plugins/notes')).success).toBe(true)
    expect(pluginInstallSourceSchema.safeParse(source('../outside')).success).toBe(false)
    expect(pluginInstallSourceSchema.safeParse(source('/abs')).success).toBe(false)
  })
})

describe('parsePluginLockfile', () => {
  const entry = (pluginKey: string, source: unknown) => ({
    pluginKey,
    version: '1.0.0',
    source,
    resolvedCommit: null,
    contentHash: 'a'.repeat(64),
    capabilityHash: 'sha256-x',
    installedAt: 1
  })

  it('keeps readable entries when another entry uses an unknown source kind', () => {
    const lock = parsePluginLockfile({
      version: 1,
      plugins: {
        'acme.good': entry('acme.good', { kind: 'local-path', path: '/tmp/good' }),
        'acme.future': entry('acme.future', { kind: 'from-the-future' })
      }
    })
    expect(Object.keys(lock.plugins)).toEqual(['acme.good'])
  })

  it('records zip installs by file name and archive hash', () => {
    const lock = parsePluginLockfile({
      version: 1,
      plugins: {
        'acme.zip': entry('acme.zip', {
          kind: 'archive',
          fileName: 'acme.zip',
          sha256: 'b'.repeat(64)
        })
      }
    })
    expect(lock.plugins['acme.zip']?.source).toEqual({
      kind: 'archive',
      fileName: 'acme.zip',
      sha256: 'b'.repeat(64)
    })
  })
})

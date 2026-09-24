import { describe, expect, it, vi } from 'vitest'
import { pluginManifestSchema } from '../../shared/plugins/plugin-manifest'
import { pluginOpenReviewSchema } from '../../shared/plugins/plugin-review-contract'
import { fingerprintPluginConsent } from '../../shared/plugins/plugin-consent-fingerprint'
import { createPluginReviewSessions } from './plugin-review-host'

const empty = { type: 'object', properties: {}, additionalProperties: false }
const manifestInput = {
  manifestVersion: 1,
  id: 'demo',
  publisher: 'example',
  name: 'Demo',
  version: '1.0.0',
  engines: { orca: '>=1.4.197' },
  pluginApi: 1,
  main: 'main.js',
  capabilities: [{ kind: 'commands:invoke-own' }, { kind: 'diffs:open' }],
  contributes: {
    commands: [
      { id: 'safe', title: 'Safe', panel: { input: empty, output: empty, effect: 'read' } },
      { id: 'snapshot', title: 'Snapshot' },
      { id: 'content', title: 'Content' },
      { id: 'write', title: 'Write' }
    ],
    reviewProviders: [
      {
        id: 'pull-request',
        title: 'Pull request',
        snapshotCommand: 'snapshot',
        contentCommand: 'content',
        input: empty
      }
    ]
  }
}
function fixture() {
  const manifest = pluginManifestSchema.parse(manifestInput)
  const plugin = {
    pluginKey: 'example.demo',
    rootDir: '/test/demo',
    manifest,
    consentFingerprint: 'test',
    contentHash: null,
    isDev: true
  }
  const invoke = vi.fn(async () => ({ title: 'PR', revision: 'one', context: null, files: [] }))
  return { manifest, invoke, sessions: createPluginReviewSessions(() => plugin, invoke) }
}
describe('plugin panel authority', () => {
  it('rejects command names supplied to the review API before dispatch', () => {
    expect(
      pluginOpenReviewSchema.safeParse({
        commandId: 'write',
        contentCommandId: 'content',
        args: {}
      }).success
    ).toBe(false)
  })
  it('resolves only registered providers and validates input before dispatch', async () => {
    const { sessions, invoke } = fixture()
    await expect(
      sessions.open('renderer:1', 'example.demo', { providerId: 'write', args: {} })
    ).rejects.toThrow()
    await expect(
      sessions.open('renderer:1', 'example.demo', {
        providerId: 'pull-request',
        args: { injected: true }
      })
    ).rejects.toThrow()
    expect(invoke).not.toHaveBeenCalled()
    await sessions.open('renderer:1', 'example.demo', { providerId: 'pull-request', args: {} })
    expect(invoke).toHaveBeenCalledWith('example.demo', 'snapshot', {})
  })
  it('rejects a provider that reuses a panel-exposed command', () => {
    const input = structuredClone(manifestInput)
    input.contributes.reviewProviders[0].snapshotCommand = 'safe'
    expect(pluginManifestSchema.safeParse(input).success).toBe(false)
  })
  it('requires new consent when a panel command contract changes', () => {
    const first = pluginManifestSchema.parse(manifestInput)
    const second = pluginManifestSchema.parse({
      ...manifestInput,
      contributes: {
        ...manifestInput.contributes,
        commands: [
          ...manifestInput.contributes.commands,
          {
            id: 'another',
            title: 'Another',
            panel: { input: empty, output: empty, effect: 'write' }
          }
        ]
      }
    })
    expect(fingerprintPluginConsent(first)).not.toBe(fingerprintPluginConsent(second))
  })
})

it('keeps internal commands and invalid arguments out of the worker', async () => {
  const { manifest } = fixture()
  const { invokePanelCommand } = await import('./plugin-panel-command-dispatch')
  const invoke = vi.fn(async () => ({}))
  await expect(invokePanelCommand(manifest, 'content', {}, invoke)).rejects.toThrow()
  await expect(invokePanelCommand(manifest, 'safe', { extra: true }, invoke)).rejects.toThrow()
  expect(invoke).not.toHaveBeenCalled()
  await expect(invokePanelCommand(manifest, 'safe', {}, invoke)).resolves.toEqual({})
  invoke.mockResolvedValueOnce({ token: 'must-not-reach-panel' })
  await expect(invokePanelCommand(manifest, 'safe', {}, invoke)).rejects.toThrow()
})

it('preserves explicit null instead of converting it to an empty object', async () => {
  const { manifest } = fixture()
  const { invokePanelCommand } = await import('./plugin-panel-command-dispatch')
  const invoke = vi.fn(async () => ({}))
  await expect(invokePanelCommand(manifest, 'safe', null, invoke)).rejects.toThrow()
  expect(invoke).not.toHaveBeenCalled()
  const nullable = pluginManifestSchema.parse({
    ...manifestInput,
    contributes: {
      ...manifestInput.contributes,
      commands: [
        {
          id: 'null-command',
          title: 'Null',
          panel: {
            input: { type: 'null' },
            output: { type: 'null' },
            effect: 'read'
          }
        }
      ],
      reviewProviders: []
    }
  })
  await expect(
    invokePanelCommand(nullable, 'null-command', null, async () => null)
  ).resolves.toBeNull()
})

it('requires consent for provider loader, input schema and command effect changes', () => {
  const first = pluginManifestSchema.parse(manifestInput)
  for (const change of ['loader', 'input', 'effect'] as const) {
    const input = structuredClone(manifestInput)
    if (change === 'loader') {
      input.contributes.reviewProviders[0].snapshotCommand = 'write'
    }
    if (change === 'input') {
      input.contributes.reviewProviders[0].input.properties = { limit: { type: 'integer' } }
    }
    if (change === 'effect') {
      input.contributes.commands[0].panel!.effect = 'write'
    }
    const second = pluginManifestSchema.parse(input)
    expect(fingerprintPluginConsent(first)).not.toBe(fingerprintPluginConsent(second))
  }
})

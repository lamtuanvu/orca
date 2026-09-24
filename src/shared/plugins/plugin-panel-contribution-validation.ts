import type { RefinementCtx } from 'zod'
import type { PluginReviewProvider } from './plugin-panel-contributions'

type Manifest = {
  contributes: {
    commands: { id: string; action?: string; panel?: unknown }[]
    reviewProviders?: PluginReviewProvider[]
  }
  capabilities: { kind: string }[]
}
export function validatePluginPanelContributions(manifest: Manifest, ctx: RefinementCtx): void {
  const commands = new Map(manifest.contributes.commands.map((entry) => [entry.id, entry]))
  const fail = (message: string) => ctx.addIssue({ code: 'custom', path: ['contributes'], message })
  if (manifest.contributes.commands.some((command) => command.panel !== undefined)) {
    if (!manifest.capabilities.some((c) => c.kind === 'commands:invoke-own')) {
      fail('panel commands require commands:invoke-own')
    }
    if (
      manifest.contributes.commands.some((c) => c.panel !== undefined && c.action !== undefined)
    ) {
      fail('aliases cannot be panel commands')
    }
  }
  const providers = manifest.contributes.reviewProviders ?? []
  if (providers.length && !manifest.capabilities.some((c) => c.kind === 'diffs:open')) {
    fail('review providers require diffs:open')
  }
  const ids = new Set<string>()
  for (const provider of providers) {
    if (ids.has(provider.id)) {
      fail('duplicate review provider')
    }
    ids.add(provider.id)
    for (const id of [provider.snapshotCommand, provider.contentCommand]) {
      const command = commands.get(id)
      if (!command || command.action !== undefined || command.panel !== undefined) {
        fail('review loaders must be declared worker commands without panel exposure')
      }
    }
  }
}

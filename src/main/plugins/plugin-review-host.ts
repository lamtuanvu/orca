import type { PluginBrowserAuthorizations } from './plugin-browser-authorization'
import { compilePluginDataSchema } from '../../shared/plugins/plugin-data-schema'
import type { ValidDiscoveredPlugin } from './plugin-discovery'
import { assertPluginWorkerCommand } from './plugin-command-invocation'
import { PluginReviewSessions } from './plugin-review-sessions'
import { bindPluginHostServices, type PluginRuntimeDelegate } from './plugin-host-service-bindings'
import { executePluginHostCallRequest, type PluginHostCallPolicy } from './plugin-host-call-adapter'
import type { PluginEventBus } from './plugin-event-bus'
import type { PluginCapabilityKind } from '../../shared/plugins/plugin-capabilities'
import type { PluginPanelActionOutcome } from '../../shared/plugins/plugin-panel-bridge'

type Invoke = (key: string, command: string, args: unknown) => Promise<unknown>
export function createPluginReviewSessions(
  plugin: (key: string) => ValidDiscoveredPlugin | null,
  invoke: Invoke
): PluginReviewSessions {
  return new PluginReviewSessions({
    generation: (key) => {
      const entry = plugin(key)
      return entry ? JSON.stringify([entry.rootDir, entry.manifest]) : null
    },
    resolveProvider: (key, id, args) => {
      const entry = plugin(key)
      if (!entry) {
        throw new Error('Plugin unavailable')
      }
      const provider = entry.manifest.contributes.reviewProviders?.find((value) => value.id === id)
      if (!provider) {
        throw new Error('Unknown review provider')
      }
      for (const command of [provider.snapshotCommand, provider.contentCommand]) {
        assertPluginWorkerCommand(entry, command)
        if (entry.manifest.contributes.commands.find((value) => value.id === command)?.panel) {
          throw new Error('Review loaders cannot be exposed to panels')
        }
      }
      return { ...provider, args: compilePluginDataSchema(provider.input).parse(args) }
    },
    invoke
  })
}

type Services = {
  delegate: PluginRuntimeDelegate | null
  pluginsDataDir: string
  eventBus: PluginEventBus
  capabilities(key: string): PluginCapabilityKind[] | null
  panelInvoke: Invoke
  browser: PluginBrowserAuthorizations
  reviews: PluginReviewSessions
  audit: PluginHostCallPolicy['audit']
}
export function executeServiceHostCall(
  pluginKey: string,
  method: string,
  params: unknown,
  options: { viaPanel: boolean; ownerKey?: string },
  input: Services
): Promise<PluginPanelActionOutcome> {
  const owner = options.ownerKey
  return executePluginHostCallRequest({
    pluginKey,
    request: { method, params },
    viaPanel: options.viaPanel,
    resolvePolicy: (key) => ({
      grantedCapabilities: input.capabilities(key),
      audit: input.audit,
      services: input.delegate
        ? {
            ...bindPluginHostServices({
              delegate: input.delegate,
              pluginsDataDir: input.pluginsDataDir,
              subscribeEvents: (key, events) => input.eventBus.subscribe(key, events)
            }),
            invokeOwnCommand: options.viaPanel ? input.panelInvoke : undefined,
            openReview:
              options.viaPanel && owner?.startsWith('renderer:')
                ? (key, args) => input.reviews.open(owner, key, args)
                : undefined,
            createAuthorization: options.viaPanel
              ? undefined
              : (key, args) => input.browser.create(key, args),
            openAuthorization: options.viaPanel
              ? undefined
              : (key, id) => input.browser.open(key, id),
            cancelAuthorization: options.viaPanel
              ? undefined
              : (key, id) => input.browser.cancel(key, id)
          }
        : null
    })
  })
}

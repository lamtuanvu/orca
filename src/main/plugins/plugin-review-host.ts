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
    assertCommand: (key, command) => {
      const entry = plugin(key)
      if (!entry) {
        throw new Error('Plugin unavailable')
      }
      assertPluginWorkerCommand(entry, command)
    },
    invoke
  })
}

type Services = {
  delegate: PluginRuntimeDelegate | null
  pluginsDataDir: string
  eventBus: PluginEventBus
  capabilities(key: string): PluginCapabilityKind[] | null
  invoke: Invoke
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
            invokeOwnCommand: options.viaPanel ? input.invoke : undefined,
            openReview:
              options.viaPanel && owner?.startsWith('renderer:')
                ? (key, args) => input.reviews.open(owner, key, args)
                : undefined,
            // Workers only. The URL was validated by the method's params schema.
            openExternal: options.viaPanel
              ? undefined
              : async (_key, url) => {
                  const { shell } = await import('electron')
                  await shell.openExternal(url)
                  return { opened: true as const }
                }
          }
        : null
    })
  })
}

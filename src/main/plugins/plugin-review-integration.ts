import type { ValidDiscoveredPlugin } from './plugin-discovery'
import { createPluginReviewSessions } from './plugin-review-host'
import { createPluginBrowserAuthorizations } from './plugin-browser-host'
import { invokePanelCommand } from './plugin-panel-command-dispatch'

type Invoke = (key: string, command: string, args: unknown) => Promise<unknown>
export function createPluginReviewIntegration(
  resolve: (key: string) => ValidDiscoveredPlugin | null,
  invoke: Invoke
) {
  const withCapability = (key: string, capability: string) => {
    const plugin = resolve(key)
    return plugin?.manifest.capabilities.some((entry) => entry.kind === capability) ? plugin : null
  }
  const reviews = createPluginReviewSessions((key) => withCapability(key, 'diffs:open'), invoke)
  const browser = createPluginBrowserAuthorizations((key) =>
    withCapability(key, 'browser:authorize')
  )
  return {
    reviews,
    browser,
    panelInvoke: async (key: string, command: string, args: unknown) => {
      const plugin = withCapability(key, 'commands:invoke-own')
      if (!plugin) {
        throw new Error('Plugin unavailable')
      }
      const result = await invokePanelCommand(plugin.manifest, command, args, (id, input) =>
        invoke(key, id, input)
      )
      if (resolve(key) !== plugin) {
        throw new Error('Plugin unavailable')
      }
      return result
    },
    clear: () => {
      browser.clear()
      reviews.clear()
    }
  }
}

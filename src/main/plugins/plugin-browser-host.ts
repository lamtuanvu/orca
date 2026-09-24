import type { ValidDiscoveredPlugin } from './plugin-discovery'
import { PluginBrowserAuthorizations } from './plugin-browser-authorization'

export function createPluginBrowserAuthorizations(
  resolve: (key: string) => ValidDiscoveredPlugin | null
): PluginBrowserAuthorizations {
  return new PluginBrowserAuthorizations({
    resolve: (key) => {
      const plugin = resolve(key)
      return plugin
        ? {
            name: plugin.manifest.name,
            generation: JSON.stringify([plugin.rootDir, plugin.manifest])
          }
        : null
    },
    confirm: async (attempt) => {
      const { dialog } = await import('electron')
      const { response } = await dialog.showMessageBox({
        type: 'question',
        title: 'Authorize plugin sign-in',
        message: `${attempt.name} wants to open your browser`,
        detail: `The service will ask you to approve access. Continue only if you recognize this server and destination.\n\nServer: ${attempt.serverOrigin}\nDestination: ${new URL(attempt.verificationUrl).origin}\n\n${attempt.verificationUrl}`,
        buttons: ['Cancel', 'Continue in browser'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      return response === 1
    },
    open: async (url) => {
      const { shell } = await import('electron')
      await shell.openExternal(url)
    }
  })
}

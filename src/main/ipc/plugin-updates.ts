import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { compareAppVersions } from '../../shared/app-version'
import {
  isAllowedPluginGitUrl,
  PLUGIN_CONTENT_HASH_PATTERN
} from '../../shared/plugins/plugin-install-lockfile'
import { isQualifiedPluginKey } from '../../shared/plugins/plugin-manifest'
import type { PluginUpdatePreview } from '../../shared/plugins/plugin-update-preview'
import { getUserPluginsDir } from '../plugins/plugin-discovery'
import { readPluginLockfile, rollbackInstalledPlugin } from '../plugins/plugin-install'
import type { PluginService } from '../plugins/plugin-service'
import { inspectPluginSource, installPluginFromSource } from '../plugins/plugin-source-install'

export const pluginDirectSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local-path'), path: z.string().min(1) }),
  z.object({ kind: z.literal('archive'), path: z.string().min(1) }),
  z.object({
    kind: z.literal('git'),
    url: z.string().trim().min(1).refine(isAllowedPluginGitUrl, 'git URL must use HTTPS or SSH'),
    // Why: installs must stay reproducible even when callers bypass renderer validation.
    ref: z.string().trim().min(1)
  })
])

const pluginKeySchema = z.string().refine(isQualifiedPluginKey, 'invalid qualified plugin key')
const pickArgsSchema = z.object({ kind: z.enum(['folder', 'archive']) })
const previewArgsSchema = z.object({ pluginKey: pluginKeySchema, source: pluginDirectSourceSchema })
const updateArgsSchema = previewArgsSchema.extend({
  expectedContentHash: z.string().regex(PLUGIN_CONTENT_HASH_PATTERN)
})
const rollbackArgsSchema = z.object({ pluginKey: pluginKeySchema })

async function pickInstallSource(
  event: IpcMainInvokeEvent,
  kind: 'folder' | 'archive'
): Promise<string | null> {
  const options: Electron.OpenDialogOptions =
    kind === 'folder'
      ? { title: 'Choose a plugin folder', properties: ['openDirectory'] }
      : {
          title: 'Choose a plugin zip file',
          properties: ['openFile'],
          filters: [{ name: 'Zip archive', extensions: ['zip'] }]
        }
  const parentWindow = BrowserWindow.fromWebContents(event.sender)
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

async function requireUpdatableInstall(pluginService: PluginService, pluginKey: string) {
  const lock = await readPluginLockfile(getUserPluginsDir(pluginService.options.userDataPath))
  const entry = lock.plugins[pluginKey]
  if (!entry) {
    throw new Error(`plugin ${pluginKey} is not installed`)
  }
  if (entry.source.kind === 'bundled') {
    throw new Error(`plugin ${pluginKey} is bundled with Orca and updates with the app`)
  }
  return entry
}

function blockedPluginReason(pluginService: PluginService) {
  return (pluginKey: string): string | null =>
    pluginService.options.getPluginKillListEntry?.(pluginKey)?.reason ?? null
}

export function registerPluginUpdateHandlers(pluginService: PluginService): void {
  ipcMain.handle('plugins:pickInstallSource', async (event, args: unknown) =>
    pickInstallSource(event, pickArgsSchema.parse(args).kind)
  )

  ipcMain.handle(
    'plugins:previewUpdate',
    async (_event, args: unknown): Promise<PluginUpdatePreview> => {
      await pluginService.whenReady()
      const parsed = previewArgsSchema.parse(args)
      const current = await requireUpdatableInstall(pluginService, parsed.pluginKey)
      const inspection = await inspectPluginSource({
        source: parsed.source,
        hostVersion: pluginService.options.hostVersion
      })
      if (!inspection.ok) {
        throw new Error(inspection.error)
      }
      if (inspection.pluginKey !== parsed.pluginKey) {
        throw new Error(`this source contains ${inspection.pluginKey}, not ${parsed.pluginKey}`)
      }
      return {
        pluginKey: parsed.pluginKey,
        currentVersion: current.version,
        nextVersion: inspection.manifest.version,
        contentHash: inspection.contentHash,
        consentFingerprint: inspection.consentFingerprint,
        manifest: inspection.manifest,
        sameContent: inspection.contentHash === current.contentHash,
        permissionsChanged: inspection.consentFingerprint !== current.consentFingerprint,
        downgrade: compareAppVersions(inspection.manifest.version, current.version) < 0
      }
    }
  )

  ipcMain.handle('plugins:update', async (_event, args: unknown) => {
    await pluginService.whenReady()
    const parsed = updateArgsSchema.parse(args)
    await requireUpdatableInstall(pluginService, parsed.pluginKey)
    const result = await installPluginFromSource({
      pluginsDir: getUserPluginsDir(pluginService.options.userDataPath),
      source: parsed.source,
      hostVersion: pluginService.options.hostVersion,
      expectedPluginKey: parsed.pluginKey,
      expectedContentHash: parsed.expectedContentHash,
      blockedPluginReason: blockedPluginReason(pluginService)
    })
    if (result.ok) {
      await pluginService.refresh()
    }
    return result
  })

  ipcMain.handle('plugins:rollback', async (_event, args: unknown) => {
    await pluginService.whenReady()
    const { pluginKey } = rollbackArgsSchema.parse(args)
    await requireUpdatableInstall(pluginService, pluginKey)
    await pluginService.deactivatePlugin(pluginKey)
    const result = await rollbackInstalledPlugin({
      pluginsDir: getUserPluginsDir(pluginService.options.userDataPath),
      pluginKey,
      hostVersion: pluginService.options.hostVersion,
      blockedPluginReason: blockedPluginReason(pluginService)
    })
    if (result.ok) {
      await pluginService.refresh()
    }
    return result
  })
}

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginLockEntry } from '../../shared/plugins/plugin-install-lockfile'
import type { PluginService } from '../plugins/plugin-service'

type IpcHandler = (event: unknown, args?: unknown) => unknown

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  showOpenDialog: vi.fn(),
  readPluginLockfile: vi.fn(),
  rollbackInstalledPlugin: vi.fn(),
  inspectPluginSource: vi.fn(),
  installPluginFromSource: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  BrowserWindow: { fromWebContents: () => null }
}))
vi.mock('../plugins/plugin-install', () => ({
  readPluginLockfile: mocks.readPluginLockfile,
  rollbackInstalledPlugin: mocks.rollbackInstalledPlugin
}))
vi.mock('../plugins/plugin-source-install', () => ({
  inspectPluginSource: mocks.inspectPluginSource,
  installPluginFromSource: mocks.installPluginFromSource
}))

import { registerPluginUpdateHandlers } from './plugin-updates'

const PLUGIN_KEY = 'orca-samples.demo'
const CONTENT_HASH = 'a'.repeat(64)
const SOURCE = { kind: 'archive', path: '/downloads/demo.zip' }
let handlers: Map<string, IpcHandler>

function lockEntry(overrides: Partial<PluginLockEntry> = {}): PluginLockEntry {
  return {
    pluginKey: PLUGIN_KEY,
    version: '1.2.0',
    source: { kind: 'local-path', path: '/src/demo' },
    resolvedCommit: null,
    contentHash: 'c'.repeat(64),
    consentFingerprint: 'sha256-old',
    installedAt: 1,
    ...overrides
  }
}

function createPluginService(): PluginService {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the update handlers only read these options and call these three methods.
  return {
    options: { userDataPath: '/user-data', hostVersion: '1.4.0' },
    whenReady: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    deactivatePlugin: vi.fn().mockResolvedValue(undefined)
  } as unknown as PluginService
}

function invoke(channel: string, args?: unknown): unknown {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`missing handler ${channel}`)
  }
  return handler({ sender: {} }, args)
}

beforeEach(() => {
  vi.clearAllMocks()
  handlers = new Map()
  mocks.handle.mockImplementation((channel: string, handler: IpcHandler) =>
    handlers.set(channel, handler)
  )
  mocks.readPluginLockfile.mockResolvedValue({
    version: 1,
    plugins: { [PLUGIN_KEY]: lockEntry() }
  })
})

describe('registerPluginUpdateHandlers', () => {
  it('previews what an update changes without installing anything', async () => {
    registerPluginUpdateHandlers(createPluginService())
    mocks.inspectPluginSource.mockResolvedValue({
      ok: true,
      pluginKey: PLUGIN_KEY,
      manifest: { version: '1.1.0' },
      contentHash: CONTENT_HASH,
      consentFingerprint: 'sha256-new'
    })

    await expect(
      invoke('plugins:previewUpdate', { pluginKey: PLUGIN_KEY, source: SOURCE })
    ).resolves.toMatchObject({
      currentVersion: '1.2.0',
      nextVersion: '1.1.0',
      contentHash: CONTENT_HASH,
      sameContent: false,
      permissionsChanged: true,
      downgrade: true
    })
    expect(mocks.installPluginFromSource).not.toHaveBeenCalled()
  })

  it('refuses a preview whose source is a different plugin', async () => {
    registerPluginUpdateHandlers(createPluginService())
    mocks.inspectPluginSource.mockResolvedValue({
      ok: true,
      pluginKey: 'orca-samples.other',
      manifest: { version: '1.0.0' },
      contentHash: CONTENT_HASH,
      consentFingerprint: 'sha256-old'
    })
    await expect(
      invoke('plugins:previewUpdate', { pluginKey: PLUGIN_KEY, source: SOURCE })
    ).rejects.toThrow('this source contains orca-samples.other, not orca-samples.demo')
  })

  it('refuses to update bundled or missing plugins', async () => {
    registerPluginUpdateHandlers(createPluginService())
    mocks.readPluginLockfile.mockResolvedValueOnce({
      version: 1,
      plugins: { [PLUGIN_KEY]: lockEntry({ source: { kind: 'bundled', bundleId: PLUGIN_KEY } }) }
    })
    await expect(
      invoke('plugins:update', {
        pluginKey: PLUGIN_KEY,
        source: SOURCE,
        expectedContentHash: CONTENT_HASH
      })
    ).rejects.toThrow(/bundled/)
    mocks.readPluginLockfile.mockResolvedValueOnce({ version: 1, plugins: {} })
    await expect(
      invoke('plugins:update', {
        pluginKey: PLUGIN_KEY,
        source: SOURCE,
        expectedContentHash: CONTENT_HASH
      })
    ).rejects.toThrow(/not installed/)
    expect(mocks.installPluginFromSource).not.toHaveBeenCalled()
  })

  it('pins the update to the reviewed identity and bytes, refreshing only on success', async () => {
    const pluginService = createPluginService()
    registerPluginUpdateHandlers(pluginService)
    mocks.installPluginFromSource.mockResolvedValue({ ok: true, pluginKey: PLUGIN_KEY })
    const args = { pluginKey: PLUGIN_KEY, source: SOURCE, expectedContentHash: CONTENT_HASH }

    await invoke('plugins:update', args)
    expect(mocks.installPluginFromSource).toHaveBeenCalledWith(
      expect.objectContaining({
        source: SOURCE,
        expectedPluginKey: PLUGIN_KEY,
        expectedContentHash: CONTENT_HASH
      })
    )
    expect(pluginService.refresh).toHaveBeenCalledOnce()

    vi.mocked(pluginService.refresh).mockClear()
    mocks.installPluginFromSource.mockResolvedValueOnce({ ok: false, error: 'failed' })
    await invoke('plugins:update', args)
    expect(pluginService.refresh).not.toHaveBeenCalled()
  })

  it('deactivates before rollback and refreshes discovery only on success', async () => {
    const pluginService = createPluginService()
    registerPluginUpdateHandlers(pluginService)
    mocks.rollbackInstalledPlugin.mockResolvedValue({ ok: true, pluginKey: PLUGIN_KEY })

    await invoke('plugins:rollback', { pluginKey: PLUGIN_KEY })
    expect(vi.mocked(pluginService.deactivatePlugin).mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rollbackInstalledPlugin.mock.invocationCallOrder[0]!
    )
    expect(pluginService.refresh).toHaveBeenCalledOnce()

    vi.mocked(pluginService.refresh).mockClear()
    mocks.rollbackInstalledPlugin.mockResolvedValueOnce({ ok: false, error: 'failed' })
    await invoke('plugins:rollback', { pluginKey: PLUGIN_KEY })
    expect(pluginService.refresh).not.toHaveBeenCalled()
    await expect(invoke('plugins:rollback', { pluginKey: 'bare-id' })).rejects.toThrow()
  })

  it('returns the picked path, or null when the picker is cancelled', async () => {
    registerPluginUpdateHandlers(createPluginService())
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/p.zip'] })
    await expect(invoke('plugins:pickInstallSource', { kind: 'archive' })).resolves.toBe(
      '/tmp/p.zip'
    )
    expect(mocks.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ name: 'Zip archive', extensions: ['zip'] }] })
    )
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(invoke('plugins:pickInstallSource', { kind: 'folder' })).resolves.toBeNull()
  })
})

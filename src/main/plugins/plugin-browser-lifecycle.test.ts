import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { pluginManifestSchema } from '../../shared/plugins/plugin-manifest'
import { fingerprintPluginConsent } from '../../shared/plugins/plugin-consent-fingerprint'
import { pluginCreatedAuthorizationSchema } from '../../shared/plugins/plugin-browser-contract'
import { PluginService } from './plugin-service'

const electron = vi.hoisted(() => ({
  confirm: vi.fn<() => Promise<{ response: number }>>(),
  open: vi.fn(async () => undefined)
}))
vi.mock('electron', () => ({
  dialog: { showMessageBox: electron.confirm },
  shell: { openExternal: electron.open }
}))

it.each(['disable-enable', 'dispose'])(
  'invalidates browser confirmation during %s',
  async (action) => {
    electron.confirm.mockReset()
    electron.open.mockClear()
    let finish: (value: { response: number }) => void = () => undefined
    electron.confirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const root = await mkdtemp(join(tmpdir(), 'orca-browser-lifecycle-'))
    const manifest = pluginManifestSchema.parse({
      manifestVersion: 1,
      id: 'demo',
      publisher: 'example',
      name: 'Demo',
      version: '1.0.0',
      engines: { orca: '>=1.0.0' },
      pluginApi: 1,
      main: 'main.js',
      capabilities: [{ kind: 'browser:authorize' }]
    })
    await writeFile(join(root, 'orca-plugin.json'), JSON.stringify(manifest))
    await writeFile(join(root, 'main.js'), 'export default function() {}')
    let disabled: string[] = []
    const service = new PluginService({
      userDataPath: root,
      hostVersion: '1.4.197',
      isPluginSystemEnabled: () => true,
      getDisabledPlugins: () => disabled,
      getPluginConsents: () => ({ 'example.demo': fingerprintPluginConsent(manifest) }),
      getDevPluginPaths: () => [root]
    })
    service.setRuntimeDelegate({
      resolveActiveWorktreeContext: async () => null,
      listTerminals: async () => ({ terminals: [] }),
      sendTerminal: async () => ({ accepted: false }),
      dispatchPluginNotification: async () => ({ delivered: false })
    })
    try {
      await service.initialize()
      const created = await service.executeHostCall(
        'example.demo',
        'browser.createAuthorization',
        {
          serverOrigin: 'https://api.example',
          verificationUrl: 'https://hub.example/device',
          expiresIn: 60
        },
        { viaPanel: false }
      )
      expect(created.ok).toBe(true)
      if (!created.ok) {
        throw new Error(created.error)
      }
      const attempt = pluginCreatedAuthorizationSchema.parse(created.value)
      const pending = service.executeHostCall(
        'example.demo',
        'browser.openAuthorization',
        { attemptId: attempt.attemptId },
        { viaPanel: false }
      )
      await vi.waitFor(() => expect(electron.confirm).toHaveBeenCalledTimes(1))
      if (action === 'dispose') {
        await service.dispose()
      } else {
        disabled = ['example.demo']
        await service.reconcileActivationState()
        disabled = []
        await service.reconcileActivationState()
      }
      finish({ response: 1 })
      expect((await pending).ok).toBe(false)
      expect(electron.open).not.toHaveBeenCalled()
      if (action === 'dispose') {
        expect(service.getGrantedCapabilities('example.demo')).toBeNull()
      }
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }
)

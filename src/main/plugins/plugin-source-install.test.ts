import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildTestZip, testPluginManifest } from './__mocks__/plugin-archive-test-fixture'
import {
  readPluginLockfile,
  removeInstalledPlugin,
  rollbackInstalledPlugin
} from './plugin-install'
import { inspectPluginSource, installPluginFromSource } from './plugin-source-install'

const roots: string[] = []
const HOST_VERSION = '1.4.0'

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-plugin-source-install-'))
  roots.push(root)
  return root
}

async function writeZip(
  root: string,
  name: string,
  options: Parameters<typeof testPluginManifest>[0] & { panel?: string } = {}
): Promise<string> {
  const path = join(root, name)
  await writeFile(
    path,
    buildTestZip([
      { name: 'plugin/', mode: 0o040755 },
      { name: 'plugin/orca-plugin.json', data: testPluginManifest(options) },
      { name: 'plugin/panel.html', data: options.panel ?? '<h1>v1</h1>', deflate: true }
    ])
  )
  return path
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('installPluginFromSource', () => {
  it('installs from a zip and records its file name and hash, not the picked path', async () => {
    const root = await tempRoot()
    const pluginsDir = join(root, 'plugins')
    const archivePath = await writeZip(root, 'demo-1.0.0.zip')

    const result = await installPluginFromSource({
      pluginsDir,
      source: { kind: 'archive', path: archivePath },
      hostVersion: HOST_VERSION
    })

    expect(result).toMatchObject({ ok: true, pluginKey: 'orca-samples.demo', version: '1.0.0' })
    const lock = await readPluginLockfile(pluginsDir)
    expect(lock.plugins['orca-samples.demo']?.source).toEqual({
      kind: 'archive',
      fileName: 'demo-1.0.0.zip',
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/)
    })
  })

  it('updates in place, keeps plugin data, and can roll back to the previous version', async () => {
    const root = await tempRoot()
    const pluginsDir = join(root, 'plugins')
    const dataFile = join(root, 'plugins-data', 'orca-samples.demo', 'storage.json')
    const first = await installPluginFromSource({
      pluginsDir,
      source: { kind: 'archive', path: await writeZip(root, 'v1.zip') },
      hostVersion: HOST_VERSION
    })
    expect(first.ok).toBe(true)
    await mkdir(join(root, 'plugins-data', 'orca-samples.demo'), { recursive: true })
    await writeFile(dataFile, '{"notes":"kept"}')

    const nextZip = await writeZip(root, 'v2.zip', { version: '2.0.0', panel: '<h1>v2</h1>' })
    const preview = await inspectPluginSource({
      source: { kind: 'archive', path: nextZip },
      hostVersion: HOST_VERSION
    })
    expect(preview.ok).toBe(true)
    if (!preview.ok) {
      return
    }
    await expect(
      installPluginFromSource({
        pluginsDir,
        source: { kind: 'archive', path: nextZip },
        hostVersion: HOST_VERSION,
        expectedPluginKey: 'orca-samples.demo',
        expectedContentHash: preview.contentHash
      })
    ).resolves.toMatchObject({ ok: true, version: '2.0.0' })
    await expect(readFile(dataFile, 'utf8')).resolves.toBe('{"notes":"kept"}')

    await expect(
      rollbackInstalledPlugin({
        pluginsDir,
        pluginKey: 'orca-samples.demo',
        hostVersion: HOST_VERSION
      })
    ).resolves.toMatchObject({ ok: true, version: '1.0.0' })
    await expect(readFile(dataFile, 'utf8')).resolves.toBe('{"notes":"kept"}')
  })

  it('refuses an update whose source is a different plugin', async () => {
    const root = await tempRoot()
    const result = await installPluginFromSource({
      pluginsDir: join(root, 'plugins'),
      source: { kind: 'archive', path: await writeZip(root, 'other.zip', { id: 'other' }) },
      hostVersion: HOST_VERSION,
      expectedPluginKey: 'orca-samples.demo'
    })
    expect(result).toEqual({
      ok: false,
      error: 'this source contains orca-samples.other, not orca-samples.demo'
    })
    await expect(readPluginLockfile(join(root, 'plugins'))).resolves.toEqual({
      version: 1,
      plugins: {}
    })
  })

  it('refuses an update when the source changed after it was reviewed', async () => {
    const root = await tempRoot()
    const result = await installPluginFromSource({
      pluginsDir: join(root, 'plugins'),
      source: { kind: 'archive', path: await writeZip(root, 'v1.zip') },
      hostVersion: HOST_VERSION,
      expectedPluginKey: 'orca-samples.demo',
      expectedContentHash: 'f'.repeat(64)
    })
    expect(result).toEqual({
      ok: false,
      error: 'plugin source changed after preview; review the update again'
    })
  })

  it('rejects reserved official identities from a zip file', async () => {
    const root = await tempRoot()
    const result = await installPluginFromSource({
      pluginsDir: join(root, 'plugins'),
      source: {
        kind: 'archive',
        path: await writeZip(root, 'fake.zip', { publisher: 'stablyai', id: 'orca-notes' })
      },
      hostVersion: HOST_VERSION
    })
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/zip file/) })
  })
})

describe('removeInstalledPlugin', () => {
  it('keeps the plugin data directory when asked', async () => {
    const root = await tempRoot()
    const pluginsDir = join(root, 'plugins')
    const pluginsDataDir = join(root, 'plugins-data')
    await installPluginFromSource({
      pluginsDir,
      source: { kind: 'archive', path: await writeZip(root, 'v1.zip') },
      hostVersion: HOST_VERSION
    })
    const dataFile = join(pluginsDataDir, 'orca-samples.demo', 'storage.json')
    await mkdir(join(pluginsDataDir, 'orca-samples.demo'), { recursive: true })
    await writeFile(dataFile, '{}')

    await removeInstalledPlugin({
      pluginsDir,
      pluginsDataDir,
      pluginKey: 'orca-samples.demo',
      keepData: true
    })

    await expect(readFile(dataFile, 'utf8')).resolves.toBe('{}')
    await expect(readPluginLockfile(pluginsDir)).resolves.toEqual({ version: 1, plugins: {} })
  })
})

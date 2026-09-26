import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildTestZip,
  testPluginManifest,
  type TestZipEntry
} from './__mocks__/plugin-archive-test-fixture'
import { extractPluginArchive } from './plugin-archive-extraction'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-plugin-archive-'))
  roots.push(root)
  return root
}

async function extract(entries: readonly TestZipEntry[] | Buffer) {
  const root = await tempRoot()
  const archivePath = join(root, 'plugin.zip')
  const bytes = Buffer.isBuffer(entries) ? entries : buildTestZip(entries)
  await writeFile(archivePath, bytes)
  const destination = join(root, 'out')
  await mkdir(destination)
  return { bytes, destination, run: () => extractPluginArchive({ archivePath, destination }) }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('extractPluginArchive', () => {
  it('extracts a manifest at the archive root and reports the archive sha256', async () => {
    const { bytes, destination, run } = await extract([
      { name: 'orca-plugin.json', data: testPluginManifest() },
      { name: 'panel.html', data: '<h1>Panel</h1>', deflate: true }
    ])
    const result = await run()
    expect(result.rootDir).toBe(destination)
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    await expect(readFile(join(destination, 'panel.html'), 'utf8')).resolves.toBe('<h1>Panel</h1>')
  })

  it('accepts one wrapper folder, as in a Git host "Download ZIP" archive', async () => {
    const { destination, run } = await extract([
      { name: 'demo-main/', mode: 0o040755 },
      { name: 'demo-main/orca-plugin.json', data: testPluginManifest() },
      { name: 'demo-main/panel.html', data: 'x' }
    ])
    await expect(run()).resolves.toMatchObject({ rootDir: join(destination, 'demo-main') })
  })

  it('skips archive tool metadata', async () => {
    const { destination, run } = await extract([
      { name: '__MACOSX/._orca-plugin.json', data: 'junk' },
      { name: 'orca-plugin.json', data: testPluginManifest() },
      { name: '.DS_Store', data: 'junk' }
    ])
    await run()
    await expect(readdir(destination)).resolves.toEqual(['orca-plugin.json'])
  })

  it('rejects archives without a findable manifest', async () => {
    await expect(
      (
        await extract([
          { name: 'a/orca-plugin.json', data: '{}' },
          { name: 'b/x', data: '' }
        ])
      ).run()
    ).rejects.toThrow(/no orca-plugin\.json found/)
  })

  it.each([
    [
      'path traversal',
      [{ name: '../escape.txt', data: 'x' }],
      /invalid relative path|unsafe archive path/
    ],
    [
      'absolute path',
      [{ name: '/etc/escape.txt', data: 'x' }],
      /absolute path|unsafe archive path/
    ],
    ['a symlink', [{ name: 'link', data: '/etc/passwd', mode: 0o120777 }], /not a regular file/],
    ['a Windows device name', [{ name: 'con.txt', data: 'x' }], /reserved device name/],
    [
      'case-colliding paths',
      [
        { name: 'Panel.html', data: 'a' },
        { name: 'panel.html', data: 'b' }
      ],
      /duplicate path/
    ]
  ])('rejects %s before writing outside the destination', async (_label, entries, reason) => {
    const { destination, run } = await extract(entries)
    await expect(run()).rejects.toThrow(reason)
    await expect(readFile(join(destination, '..', 'escape.txt'))).rejects.toThrow()
  })

  it('stops inflating once the uncompressed tree exceeds the plugin size cap', async () => {
    const { run } = await extract([
      { name: 'orca-plugin.json', data: testPluginManifest() },
      { name: 'bomb.bin', data: Buffer.alloc(51 * 1024 * 1024), deflate: true }
    ])
    await expect(run()).rejects.toThrow(/byte limit/)
  })

  it('rejects files that are not zip archives', async () => {
    await expect((await extract(Buffer.from('not a zip'))).run()).rejects.toThrow(
      /not a readable zip archive/
    )
  })
})

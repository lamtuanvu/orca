import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const git = vi.hoisted(() => ({ checkout: vi.fn() }))
vi.mock('./plugin-git-repository', () => ({ checkoutPluginGitSource: git.checkout }))

import { checkoutMarketplacePlugin } from './plugin-marketplace-checkout'

const roots: string[] = []
const COMMIT = 'a'.repeat(40)

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-marketplace-checkout-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  git.checkout.mockReset()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function checkout(destination: string, path?: string) {
  return checkoutMarketplacePlugin({
    source: {
      kind: 'git',
      url: 'https://git.example/p.git',
      ref: 'main',
      ...(path ? { path } : {})
    },
    destination,
    workingDirectory: tmpdir()
  })
}

describe('checkoutMarketplacePlugin', () => {
  it('returns the checkout root, or the requested folder inside it', async () => {
    const root = await tempRoot()
    git.checkout.mockImplementation(async () => {
      await mkdir(join(root, 'plugins', 'notes'), { recursive: true })
      return COMMIT
    })
    await expect(checkout(root)).resolves.toEqual({ resolvedCommit: COMMIT, rootDir: root })
    await expect(checkout(root, 'plugins/notes')).resolves.toEqual({
      resolvedCommit: COMMIT,
      rootDir: join(root, 'plugins', 'notes')
    })
  })

  it('rejects a missing folder or a file in its place', async () => {
    const root = await tempRoot()
    git.checkout.mockImplementation(async () => {
      await writeFile(join(root, 'notes'), 'not a folder')
      return COMMIT
    })
    await expect(checkout(root, 'missing')).rejects.toThrow(/folder not found/)
    await expect(checkout(root, 'notes')).rejects.toThrow(/folder not found/)
  })

  it.skipIf(process.platform === 'win32')(
    'rejects a folder reached through a committed symlink that leaves the checkout',
    async () => {
      const root = await tempRoot()
      const outside = await tempRoot()
      await mkdir(join(outside, 'notes'))
      git.checkout.mockImplementation(async () => {
        await symlink(outside, join(root, 'plugins'))
        return COMMIT
      })
      await expect(checkout(root, 'plugins/notes')).rejects.toThrow(/escapes the repository/)
    }
  )
})

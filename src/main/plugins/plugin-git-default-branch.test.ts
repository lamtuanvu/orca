import { describe, expect, it, vi } from 'vitest'

const runner = vi.hoisted(() => ({ gitExecFileAsync: vi.fn() }))
vi.mock('../git/runner', () => runner)

import { resolvePluginGitDefaultBranch } from './plugin-git-repository'

describe('resolvePluginGitDefaultBranch', () => {
  it('reads the branch HEAD points at from ls-remote --symref', async () => {
    runner.gitExecFileAsync.mockResolvedValueOnce({
      stdout: `ref: refs/heads/release/v2\tHEAD\n${'a'.repeat(40)}\tHEAD\n`
    })
    await expect(resolvePluginGitDefaultBranch('https://git.example/p.git', '/tmp')).resolves.toBe(
      'release/v2'
    )
    expect(runner.gitExecFileAsync).toHaveBeenCalledWith(
      ['ls-remote', '--symref', '--', 'https://git.example/p.git', 'HEAD'],
      expect.objectContaining({ cwd: '/tmp' })
    )
  })

  it('asks for an explicit ref when the remote does not report a symbolic HEAD', async () => {
    runner.gitExecFileAsync.mockResolvedValueOnce({ stdout: `${'a'.repeat(40)}\tHEAD\n` })
    await expect(
      resolvePluginGitDefaultBranch('https://git.example/p.git', '/tmp')
    ).rejects.toThrow(/enter a branch or tag/)
  })

  it('refuses executable remote helpers before running Git', async () => {
    runner.gitExecFileAsync.mockClear()
    await expect(resolvePluginGitDefaultBranch('ext::sh -c id', '/tmp')).rejects.toThrow(
      /HTTPS or SSH/
    )
    expect(runner.gitExecFileAsync).not.toHaveBeenCalled()
  })
})

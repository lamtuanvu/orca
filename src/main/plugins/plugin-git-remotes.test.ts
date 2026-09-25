import { describe, expect, it } from 'vitest'
import { parsePluginGitRemotes, sanitizePluginGitRemoteUrl } from './plugin-git-remotes'

describe('plugin git remotes', () => {
  it('keeps one fetch URL per remote', () => {
    const out = [
      'origin\thttps://hub.example.com/acme/demo.git (fetch)',
      'origin\thttps://hub.example.com/acme/demo.git (push)',
      'fork\tgit@github.com:me/demo.git (fetch)',
      'fork\tgit@github.com:me/demo.git (push)'
    ].join('\n')
    expect(parsePluginGitRemotes(out)).toEqual([
      { name: 'origin', url: 'https://hub.example.com/acme/demo.git' },
      { name: 'fork', url: 'git@github.com:me/demo.git' }
    ])
  })

  it('removes credentials and drops local paths', () => {
    expect(sanitizePluginGitRemoteUrl('https://user:tok3n@hub.example.com/a/b.git')).toBe(
      'https://hub.example.com/a/b.git'
    )
    expect(sanitizePluginGitRemoteUrl('ssh://git:pw@hub.example.com:2222/a/b.git')).toBe(
      'ssh://git@hub.example.com:2222/a/b.git'
    )
    expect(sanitizePluginGitRemoteUrl('/Users/private/repo')).toBeNull()
    expect(sanitizePluginGitRemoteUrl('file:///Users/private/repo')).toBeNull()
    expect(sanitizePluginGitRemoteUrl('../sibling')).toBeNull()
    expect(parsePluginGitRemotes('local\t/Users/private/repo (fetch)')).toEqual([])
  })
})

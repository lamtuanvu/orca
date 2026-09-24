import { describe, expect, it } from 'vitest'
import { PluginReviewSessions } from './plugin-review-sessions'
import { getPluginHostMethodSpec } from '../../shared/plugins/plugin-host-api'

const review = {
  title: 'PR #7',
  revision: 'base:head',
  context: { owner: 'acme', repo: 'demo', headSha: 'a'.repeat(40) },
  files: [{ path: 'new.ts', oldPath: 'old.ts', status: 'renamed', additions: 1, deletions: 1 }]
}
function fixture() {
  let approved = true
  let generation = 'one'
  const inputs: unknown[] = []
  const sessions = new PluginReviewSessions({
    generation: () => (approved ? generation : null),
    invoke: async (_plugin, command, args) => {
      inputs.push(args)
      return command === 'snapshot'
        ? review
        : {
            original: { kind: 'text', content: 'old\n' },
            modified: { kind: 'text', content: 'new\n' }
          }
    },
    assertCommand: () => undefined
  })
  return {
    sessions,
    inputs,
    revoke: () => {
      approved = false
    },
    replace: () => {
      generation = 'two'
    }
  }
}
const params = { commandId: 'snapshot', contentCommandId: 'content', args: { number: 7 } }

describe('plugin external reviews', () => {
  it('admits own commands and external review opening through explicit capabilities', () => {
    expect(getPluginHostMethodSpec('commands.invokeOwn')).toMatchObject({
      panel: true,
      capability: 'commands:invoke-own'
    })
    expect(getPluginHostMethodSpec('diffs.openReview')).toMatchObject({
      panel: true,
      capability: 'diffs:open'
    })
  })
  it('binds file loads to the originating window and snapshot file', async () => {
    const { sessions, inputs } = fixture()
    const opened = await sessions.open('window:1', 'demo.plugin', params)
    await expect(sessions.read('window:2', opened.reviewId, 0)).rejects.toThrow('unavailable')
    expect(await sessions.read('window:1', opened.reviewId, 0)).toEqual({
      original: { kind: 'text', content: 'old\n' },
      modified: { kind: 'text', content: 'new\n' }
    })
    expect(inputs[1]).toEqual({ context: review.context, file: review.files[0] })
    await expect(sessions.read('window:1', opened.reviewId, 1)).rejects.toThrow('file')
  })
  it('rejects revoked or replaced plugins and discards closed reviews', async () => {
    for (const change of ['revoke', 'replace'] as const) {
      const f = fixture()
      const opened = await f.sessions.open('window:1', 'demo.plugin', params)
      f[change]()
      await expect(f.sessions.read('window:1', opened.reviewId, 0)).rejects.toThrow('unavailable')
    }
    const f = fixture()
    const opened = await f.sessions.open('window:1', 'demo.plugin', params)
    f.sessions.close('window:1', opened.reviewId)
    await expect(f.sessions.read('window:1', opened.reviewId, 0)).rejects.toThrow('unavailable')
  })
  it('does not publish a snapshot after its owner was revoked while loading', async () => {
    let finish: (value: unknown) => void = () => undefined
    const sessions = new PluginReviewSessions({
      generation: () => 'one',
      assertCommand: () => undefined,
      invoke: () =>
        new Promise((resolve) => {
          finish = resolve
        })
    })
    const pending = sessions.open('window:1', 'demo.plugin', params)
    sessions.revokeOwner('window:1')
    finish(review)
    await expect(pending).rejects.toThrow('unavailable')
  })
  it('rejects oversized content instead of interpreting it as an empty side', async () => {
    const sessions = new PluginReviewSessions({
      generation: () => 'one',
      assertCommand: () => undefined,
      invoke: async (_p, command) =>
        command === 'snapshot'
          ? review
          : {
              original: { kind: 'text', content: 'x'.repeat(3 * 1024 * 1024) },
              modified: { kind: 'absent' }
            }
    })
    const opened = await sessions.open('w', 'demo.plugin', params)
    await expect(sessions.read('w', opened.reviewId, 0)).rejects.toThrow()
  })
})

it('does not resurrect a pending review after all sessions are cleared', async () => {
  let finish: (value: unknown) => void = () => undefined
  const sessions = new PluginReviewSessions({
    generation: () => 'one',
    assertCommand: () => undefined,
    invoke: () =>
      new Promise((resolve) => {
        finish = resolve
      })
  })
  const pending = sessions.open('window:1', 'demo.plugin', params)
  sessions.clear()
  finish(review)
  await expect(pending).rejects.toThrow('unavailable')
})

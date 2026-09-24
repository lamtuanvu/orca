import { describe, expect, it, vi } from 'vitest'
import { PluginBrowserAuthorizations } from './plugin-browser-authorization'
import { getPluginHostMethodSpec } from '../../shared/plugins/plugin-host-api'

function fixture() {
  let now = 1000
  let generation: string | null = 'one'
  const confirm = vi.fn(async () => true)
  const open = vi.fn(async () => undefined)
  const browser = new PluginBrowserAuthorizations({
    resolve: () => (generation ? { name: 'Demo', generation } : null),
    confirm,
    open,
    now: () => now
  })
  return {
    browser,
    confirm,
    open,
    advance: () => {
      now += 60000
    },
    revoke: () => {
      generation = null
    },
    replace: () => {
      generation = 'two'
    }
  }
}
const input = {
  serverOrigin: 'https://api.example',
  verificationUrl: 'https://hub.example/device?code=ABCD',
  expiresIn: 30
}

describe('browser authorization boundary', () => {
  it('removes the unrestricted browser API', () => {
    expect(getPluginHostMethodSpec('browser.openExternal')).toBeNull()
  })
  it('binds an attempt to its plugin and exact URL, confirms once, and rejects replay', async () => {
    const f = fixture()
    const attempt = f.browser.create('example.demo', input)
    await expect(f.browser.open('example.other', attempt.attemptId)).rejects.toThrow()
    expect(f.confirm).not.toHaveBeenCalled()
    await expect(f.browser.open('example.demo', attempt.attemptId)).resolves.toEqual({
      opened: true
    })
    expect(f.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        serverOrigin: input.serverOrigin,
        verificationUrl: input.verificationUrl,
        name: 'Demo'
      })
    )
    expect(f.open).toHaveBeenCalledExactlyOnceWith(input.verificationUrl)
    await expect(f.browser.open('example.demo', attempt.attemptId)).rejects.toThrow()
    expect(f.open).toHaveBeenCalledTimes(1)
  })
  it('does not open rejected, canceled, expired, or replaced attempts', async () => {
    for (const kind of ['deny', 'cancel', 'expire', 'replace', 'revoke'] as const) {
      const f = fixture()
      const attempt = f.browser.create('example.demo', input)
      if (kind === 'deny') {
        f.confirm.mockResolvedValueOnce(false)
      }
      if (kind === 'cancel') {
        f.browser.cancel('example.demo', attempt.attemptId)
      }
      if (kind === 'expire') {
        f.advance()
      }
      if (kind === 'replace') {
        f.replace()
      }
      if (kind === 'revoke') {
        f.revoke()
      }
      await f.browser.open('example.demo', attempt.attemptId).catch(() => undefined)
      expect(f.open).not.toHaveBeenCalled()
    }
  })
  it('rechecks cancellation and expiry after the trusted confirmation', async () => {
    for (const expire of [false, true]) {
      const f = fixture()
      const attempt = f.browser.create('example.demo', input)
      f.confirm.mockImplementationOnce(async () => {
        if (expire) {
          f.advance()
        } else {
          f.browser.cancel('example.demo', attempt.attemptId)
        }
        return true
      })
      await expect(f.browser.open('example.demo', attempt.attemptId)).rejects.toThrow()
      expect(f.open).not.toHaveBeenCalled()
    }
  })
  it('bounds requests and rejects unsafe destinations before confirmation', () => {
    const f = fixture()
    for (const verificationUrl of [
      'javascript:alert(1)',
      'file:///tmp/a',
      'http://evil.example',
      'https://user:pass@example.org'
    ]) {
      expect(() => f.browser.create('example.demo', { ...input, verificationUrl })).toThrow()
    }
    f.browser.create('example.demo', input)
    expect(() => f.browser.create('example.demo', input)).toThrow()
    expect(f.confirm).not.toHaveBeenCalled()
  })
})

it('serializes confirmations across plugins and keeps rate limits after cancellation', async () => {
  const f = fixture()
  const first = f.browser.create('example.first', input)
  const second = f.browser.create('example.second', input)
  let finish: (allowed: boolean) => void = () => undefined
  f.confirm.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const pending = f.browser.open('example.first', first.attemptId)
  await expect(f.browser.open('example.second', second.attemptId)).rejects.toThrow()
  f.browser.cancel('example.first', first.attemptId)
  expect(() => f.browser.create('example.first', input)).toThrow()
  finish(true)
  await expect(pending).rejects.toThrow()
  expect(f.open).not.toHaveBeenCalled()
})

it('rechecks plugin authority after confirmation and after clearing pending attempts', async () => {
  for (const change of ['replace', 'revoke', 'clear'] as const) {
    const f = fixture()
    const attempt = f.browser.create('example.demo', input)
    f.confirm.mockImplementationOnce(async () => {
      if (change === 'clear') {
        f.browser.clear()
      } else {
        f[change]()
      }
      return true
    })
    await expect(f.browser.open('example.demo', attempt.attemptId)).rejects.toThrow()
    expect(f.open).not.toHaveBeenCalled()
  }
})

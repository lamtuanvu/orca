import { describe, expect, it, vi } from 'vitest'
import { PluginExternalBrowser } from './plugin-browser-external'

describe('plugin external browser', () => {
  it.each([
    'https://hub.example/owner/repo/pulls/42',
    'http://localhost:5174/owner/repo/pulls/42',
    'http://[::1]:5174/pulls/42'
  ])('opens a permitted URL: %s', async (url) => {
    const identity = {}
    const open = vi.fn(async () => undefined)
    const browser = new PluginExternalBrowser(
      () => identity,
      async () => open
    )
    expect(await browser.open('example.demo', url)).toEqual({ opened: true })
    expect(open).toHaveBeenCalledWith(url)
  })

  it.each([
    'file:///tmp/file',
    'javascript:alert(1)',
    'http://hub.example/pr',
    'https://user:pass@hub.example/pr'
  ])('rejects unsafe URL: %s', async (url) => {
    const load = vi.fn()
    const browser = new PluginExternalBrowser(() => ({}), load)
    await expect(browser.open('example.demo', url)).rejects.toThrow()
    expect(load).not.toHaveBeenCalled()
  })

  it.each(['revoke', 'replace', 'clear'])(
    'does not open after %s while loading the desktop shell',
    async (action) => {
      let identity: object | null = {}
      const open = vi.fn(async () => undefined)
      const browser = new PluginExternalBrowser(
        () => identity,
        async () => {
          if (action === 'clear') {
            browser.clear()
          } else {
            identity = action === 'revoke' ? null : {}
          }
          return open
        }
      )
      await expect(browser.open('example.demo', 'https://hub.example/pr')).rejects.toThrow(
        'Plugin unavailable'
      )
      expect(open).not.toHaveBeenCalled()
    }
  )

  it('refuses unavailable plugins before loading the desktop shell', async () => {
    const load = vi.fn()
    const browser = new PluginExternalBrowser(() => null, load)
    await expect(browser.open('example.demo', 'https://hub.example/pr')).rejects.toThrow(
      'Plugin unavailable'
    )
    expect(load).not.toHaveBeenCalled()
  })

  it('returns opened:false when the desktop shell is unavailable or fails', async () => {
    const identity = {}
    for (const load of [
      async () => null,
      async () => {
        throw new Error('No electron')
      },
      async () => async () => {
        throw new Error('No browser')
      }
    ]) {
      const browser = new PluginExternalBrowser(() => identity, load)
      expect(await browser.open('example.demo', 'https://hub.example/pr')).toEqual({
        opened: false
      })
    }
  })
})

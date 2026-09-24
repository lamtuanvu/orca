import { describe, expect, it } from 'vitest'
import { pluginOpenExternalSchema } from './plugin-review-contract'
import { getPluginHostMethodSpec } from './plugin-host-api'

describe('browser.openExternal contract', () => {
  it('accepts https pages and http only on loopback', () => {
    for (const url of [
      'https://hub.example/device?code=WDJB-MJHT',
      'http://localhost:5174/device',
      'http://127.0.0.1:5174/device'
    ]) {
      expect(pluginOpenExternalSchema.safeParse({ url }).success).toBe(true)
    }
  })
  it('rejects executable schemes, plain http, credentials and extra fields', () => {
    for (const params of [
      { url: 'javascript:alert(1)' },
      { url: 'file:///etc/passwd' },
      { url: 'http://hub.example/device' },
      { url: 'https://user:pass@hub.example/device' },
      { url: 'not a url' },
      { url: 'https://hub.example', extra: true }
    ]) {
      expect(pluginOpenExternalSchema.safeParse(params).success).toBe(false)
    }
  })
  it('is worker-only and gated by its own capability', () => {
    const spec = getPluginHostMethodSpec('browser.openExternal')
    expect(spec?.panel).toBe(false)
    expect(spec?.capability).toBe('browser:open-external')
  })
})

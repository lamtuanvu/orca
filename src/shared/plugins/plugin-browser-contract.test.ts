import { describe, expect, it } from 'vitest'
import {
  pluginWebUrlSchema,
  pluginAuthorizationHandleSchema,
  pluginCreateAuthorizationSchema
} from './plugin-browser-contract'
import { getPluginHostMethodSpec } from './plugin-host-api'

describe('browser authorization contract', () => {
  it('rejects malformed server origins without throwing', () => {
    for (const serverOrigin of ['bad', 'https://hub.example/device', 'https://hub.example/']) {
      expect(
        pluginCreateAuthorizationSchema.safeParse({
          serverOrigin,
          verificationUrl: 'https://hub.example/device',
          expiresIn: 600
        }).success
      ).toBe(false)
    }
  })
  it('accepts https pages and http only on loopback', () => {
    for (const url of [
      'https://hub.example/device?code=WDJB-MJHT',
      'http://localhost:5174/device',
      'http://127.0.0.1:5174/device'
    ]) {
      expect(pluginWebUrlSchema.safeParse(url).success).toBe(true)
    }
  })
  it('rejects executable schemes, plain http, credentials and extra fields', () => {
    for (const params of [
      { url: 'javascript:alert(1)' },
      { url: 'file:///etc/passwd' },
      { url: 'http://hub.example/device' },
      { url: 'https://user:pass@hub.example/device' },
      { url: 'not a url' }
    ]) {
      expect(pluginWebUrlSchema.safeParse(params.url).success).toBe(false)
    }
  })
  it('is worker-only and gated by its own capability', () => {
    for (const method of ['createAuthorization', 'openAuthorization', 'cancelAuthorization']) {
      const spec = getPluginHostMethodSpec(`browser.${method}`)
      expect(spec?.panel).toBe(false)
      expect(spec?.capability).toBe('browser:authorize')
    }
    expect(
      pluginAuthorizationHandleSchema.safeParse({
        attemptId: '00000000-0000-4000-8000-000000000001',
        url: 'https://evil.example'
      }).success
    ).toBe(false)
  })
})

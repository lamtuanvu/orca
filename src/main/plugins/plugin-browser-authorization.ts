import { randomUUID } from 'node:crypto'
import {
  pluginCreateAuthorizationSchema,
  type PluginCreateAuthorization
} from '../../shared/plugins/plugin-browser-contract'

type Identity = { name: string; generation: string }
type Attempt = PluginCreateAuthorization &
  Identity & { plugin: string; expiresAt: number; used: boolean }
type Services = {
  resolve(plugin: string): Identity | null
  confirm(attempt: Readonly<Attempt>): Promise<boolean>
  open(url: string): Promise<void>
  now?(): number
}

export class PluginBrowserAuthorizations {
  private readonly attempts = new Map<string, Attempt>()
  private readonly recent = new Map<string, number>()
  private confirming = false
  constructor(private readonly services: Services) {}
  private now(): number {
    return this.services.now?.() ?? Date.now()
  }

  create(
    plugin: string,
    input: PluginCreateAuthorization
  ): { attemptId: string; expiresAt: number } {
    const request = pluginCreateAuthorizationSchema.parse(input)
    const identity = this.services.resolve(plugin)
    if (!identity) {
      throw new Error('Plugin unavailable')
    }
    const now = this.now()
    for (const [id, attempt] of this.attempts) {
      if (attempt.expiresAt <= now) {
        this.attempts.delete(id)
      }
    }
    for (const [key, timestamp] of this.recent) {
      if (now - timestamp >= 10000) {
        this.recent.delete(key)
      }
    }
    if (
      this.recent.has(plugin) ||
      this.recent.size >= 128 ||
      this.attempts.size >= 128 ||
      [...this.attempts.values()].some((attempt) => attempt.plugin === plugin)
    ) {
      throw new Error('Authorization already pending or rate limited')
    }
    const attemptId = randomUUID()
    const expiresAt = now + request.expiresIn * 1000
    this.recent.set(plugin, now)
    this.attempts.set(attemptId, { ...request, ...identity, plugin, expiresAt, used: false })
    return { attemptId, expiresAt }
  }

  private resolve(plugin: string, id: string): Attempt {
    const attempt = this.attempts.get(id)
    const current = this.services.resolve(plugin)
    if (
      !attempt ||
      attempt.plugin !== plugin ||
      attempt.expiresAt <= this.now() ||
      current?.generation !== attempt.generation
    ) {
      throw new Error('Authorization unavailable')
    }
    return attempt
  }

  async open(plugin: string, id: string): Promise<{ opened: boolean }> {
    const attempt = this.resolve(plugin, id)
    if (attempt.used || this.confirming) {
      throw new Error('Authorization already opened or confirmation pending')
    }
    attempt.used = true
    this.confirming = true
    try {
      const accepted = await this.services.confirm(attempt)
      if (!accepted) {
        return { opened: false }
      }
      if (this.resolve(plugin, id) !== attempt) {
        throw new Error('Authorization unavailable')
      }
      await this.services.open(attempt.verificationUrl)
      return { opened: true }
    } finally {
      this.confirming = false
      // Keep the consumed handle until cancel/expiry; it cannot open another URL or window.
    }
  }

  cancel(plugin: string, id: string): { ok: true } {
    if (this.attempts.get(id)?.plugin === plugin) {
      this.attempts.delete(id)
    }
    return { ok: true }
  }
  clear(): void {
    this.attempts.clear()
  }
}

import { z } from 'zod'

const loopback = new Set(['localhost', '127.0.0.1', '[::1]'])
export const pluginWebUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value)
      return (
        !url.username &&
        !url.password &&
        (url.protocol === 'https:' || (url.protocol === 'http:' && loopback.has(url.hostname)))
      )
    } catch {
      return false
    }
  }, 'HTTPS or loopback HTTP without credentials required')

export const pluginCreateAuthorizationSchema = z
  .object({
    serverOrigin: pluginWebUrlSchema.refine((value) => {
      try {
        return new URL(value).origin === value
      } catch {
        return false
      }
    }, 'serverOrigin must be an origin'),
    verificationUrl: pluginWebUrlSchema,
    expiresIn: z.number().int().min(1).max(900)
  })
  .strict()
export const pluginAuthorizationHandleSchema = z.object({ attemptId: z.string().uuid() }).strict()
export const pluginCreatedAuthorizationSchema = pluginAuthorizationHandleSchema
  .extend({ expiresAt: z.number().int() })
  .strict()
export const pluginOpenedAuthorizationSchema = z.object({ opened: z.boolean() }).strict()
export const pluginCanceledAuthorizationSchema = z.object({ ok: z.literal(true) }).strict()
export type PluginCreateAuthorization = z.infer<typeof pluginCreateAuthorizationSchema>

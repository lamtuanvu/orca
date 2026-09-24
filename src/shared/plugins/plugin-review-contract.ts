import { z } from 'zod'

const boundedJson = (bytes: number) =>
  z
    .json()
    .refine(
      (value) => new TextEncoder().encode(JSON.stringify(value)).length <= bytes,
      'payload too large'
    )
export const pluginOwnCommandSchema = z
  .object({ commandId: z.string().min(1).max(256), args: boundedJson(48 * 1024).optional() })
  .strict()
export const pluginOpenReviewSchema = pluginOwnCommandSchema
  .extend({ contentCommandId: z.string().min(1).max(256) })
  .strict()
export const pluginCommandResultSchema = boundedJson(48 * 1024)
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
/** Browser opening is limited to web pages: https, http only for loopback development
 *  servers, and never embedded credentials. Anything else is rejected before main acts. */
export const pluginOpenExternalSchema = z
  .object({
    url: z
      .string()
      .max(2048)
      .refine((value) => {
        let url: URL
        try {
          url = new URL(value)
        } catch {
          return false
        }
        const scheme =
          url.protocol === 'https:' ||
          (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
        return scheme && !url.username && !url.password
      }, 'only https (or http on localhost) URLs without credentials')
  })
  .strict()
export const pluginOpenExternalResultSchema = z.object({ opened: z.literal(true) }).strict()
export const pluginReviewFileSchema = z
  .object({
    path: z.string().min(1).max(4096),
    oldPath: z.string().min(1).max(4096).optional(),
    status: z.enum(['added', 'deleted', 'modified', 'renamed', 'copied']),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    binary: z.boolean().optional()
  })
  .strict()
export const pluginReviewSchema = z
  .object({
    title: z.string().min(1).max(512),
    revision: z.string().min(1).max(512),
    context: boundedJson(16 * 1024),
    files: z.array(pluginReviewFileSchema).max(2000)
  })
  .strict()
  .refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).length <= 1024 * 1024,
    'review metadata too large'
  )
const sideSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('text'),
      content: z
        .string()
        .max(2 * 1024 * 1024)
        .refine(
          (value) => new TextEncoder().encode(value).length <= 2 * 1024 * 1024,
          'file too large'
        )
    })
    .strict(),
  z.object({ kind: z.literal('absent') }).strict(),
  z.object({ kind: z.literal('binary'), size: z.number().nonnegative().optional() }).strict(),
  z
    .object({
      kind: z.literal('limited'),
      reason: z.string().max(512),
      size: z.number().nonnegative().optional()
    })
    .strict(),
  z
    .object({ kind: z.literal('error'), code: z.string().max(128), message: z.string().max(512) })
    .strict()
])
export const pluginReviewContentsSchema = z
  .object({ original: sideSchema, modified: sideSchema })
  .strict()
export const pluginOpenedReviewSchema = z
  .object({ reviewId: z.string().uuid(), review: pluginReviewSchema })
  .strict()
export type PluginReview = z.infer<typeof pluginReviewSchema>
export type PluginReviewContents = z.infer<typeof pluginReviewContentsSchema>
export type PluginOpenedReview = z.infer<typeof pluginOpenedReviewSchema>
export type PluginOpenReviewInput = z.infer<typeof pluginOpenReviewSchema>

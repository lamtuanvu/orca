import { z } from 'zod'
import { pluginCommandIdSchema } from './plugin-manifest-fields'
import { pluginDataSchema } from './plugin-data-schema'

export const pluginPanelCommandSchema = z
  .object({
    input: pluginDataSchema,
    output: pluginDataSchema,
    effect: z.enum(['read', 'write'])
  })
  .strict()

export const pluginReviewProviderSchema = z
  .object({
    id: pluginCommandIdSchema,
    title: z.string().min(1).max(256),
    snapshotCommand: pluginCommandIdSchema,
    contentCommand: pluginCommandIdSchema,
    input: pluginDataSchema
  })
  .strict()

export type PluginReviewProvider = z.infer<typeof pluginReviewProviderSchema>

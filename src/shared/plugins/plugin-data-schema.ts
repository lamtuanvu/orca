import { z } from 'zod'

const definitionSchema = z
  .object({
    type: z.enum(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).max(64).optional(),
    additionalProperties: z.literal(false).optional(),
    items: z.unknown().optional(),
    maxItems: z.number().int().min(0).max(2000).optional(),
    minLength: z.number().int().min(0).max(49152).optional(),
    maxLength: z.number().int().min(0).max(49152).optional(),
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
    enum: z.array(z.string().max(512)).min(1).max(64).optional(),
    nullable: z.boolean().optional()
  })
  .strict()

/** Deliberately small, bounded schema dialect: no refs, code, regexes or coercion. */
export function compilePluginDataSchema(input: unknown, depth = 0): z.ZodType {
  if (depth > 8) {
    throw new Error('schema nesting exceeds eight levels')
  }
  const d = definitionSchema.parse(input)
  const keywords = {
    object: ['properties', 'required', 'additionalProperties'],
    array: ['items', 'maxItems'],
    string: ['minLength', 'maxLength', 'enum'],
    number: ['minimum', 'maximum'],
    integer: ['minimum', 'maximum'],
    boolean: [],
    null: []
  }
  const allowed = new Set(['type', 'nullable', ...keywords[d.type]])
  if (Object.keys(d).some((key) => !allowed.has(key))) {
    throw new Error('keyword does not apply to schema type')
  }
  let result: z.ZodType
  switch (d.type) {
    case 'object': {
      if (d.additionalProperties !== false) {
        throw new Error('objects must reject additional properties')
      }
      const properties = Object.entries(d.properties ?? {})
      if (properties.length > 64) {
        throw new Error('too many object properties')
      }
      const required = new Set(d.required ?? [])
      if ([...required].some((key) => !Object.hasOwn(d.properties ?? {}, key))) {
        throw new Error('unknown required property')
      }
      const fields: Record<string, z.ZodType> = {}
      for (const [key, value] of properties) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) {
          throw new Error('reserved property')
        }
        const field = compilePluginDataSchema(value, depth + 1)
        fields[key] = required.has(key) ? field : field.optional()
      }
      result = z.object(fields).strict()
      break
    }
    case 'array':
      result = z.array(compilePluginDataSchema(d.items, depth + 1)).max(d.maxItems ?? 2000)
      break
    case 'string': {
      let value = z
        .string()
        .min(d.minLength ?? 0)
        .max(d.maxLength ?? 49152)
      if (d.enum) {
        value = value.refine((text) => d.enum!.includes(text))
      }
      result = value
      break
    }
    case 'number':
    case 'integer': {
      let value = d.type === 'integer' ? z.number().int() : z.number().finite()
      if (d.minimum !== undefined) {
        value = value.min(d.minimum)
      }
      if (d.maximum !== undefined) {
        value = value.max(d.maximum)
      }
      result = value
      break
    }
    case 'boolean':
      result = z.boolean()
      break
    case 'null':
      result = z.null()
      break
  }
  return d.nullable ? result.nullable() : result
}

export const pluginDataSchema = z.json().superRefine((value, ctx) => {
  if (JSON.stringify(value).length > 16384) {
    ctx.addIssue({ code: 'custom', message: 'schema exceeds 16 KiB' })
    return
  }
  try {
    compilePluginDataSchema(value)
  } catch {
    ctx.addIssue({ code: 'custom', message: 'invalid bounded data schema' })
  }
})

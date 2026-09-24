import { expect, it } from 'vitest'
import { compilePluginDataSchema, pluginDataSchema } from './plugin-data-schema'

it('rejects unbounded object keys, refs, reserved properties, and excessive schema depth', () => {
  for (const schema of [
    { type: 'object', additionalProperties: true },
    { $ref: 'https://evil.example/schema' },
    { type: 'string', pattern: '(a+)+$' },
    {
      type: 'object',
      properties: { constructor: { type: 'string' } },
      additionalProperties: false
    },
    { type: 'object', required: ['missing'], additionalProperties: false }
  ]) {
    expect(pluginDataSchema.safeParse(schema).success).toBe(false)
  }
  let deep: unknown = { type: 'string' }
  for (let i = 0; i < 10; i++) {
    deep = { type: 'array', items: deep }
  }
  expect(pluginDataSchema.safeParse(deep).success).toBe(false)
})

it('enforces required values, types, bounds and exact output fields without coercion', () => {
  const schema = compilePluginDataSchema({
    type: 'object',
    additionalProperties: false,
    required: ['number', 'state'],
    properties: {
      number: { type: 'integer', minimum: 1, maximum: 10 },
      state: { type: 'string', enum: ['open', 'closed'], maxLength: 6 },
      paths: { type: 'array', maxItems: 1, items: { type: 'string', maxLength: 8 } }
    }
  })
  expect(schema.parse({ number: 1, state: 'open' })).toEqual({ number: 1, state: 'open' })
  for (const value of [
    {},
    { number: '1', state: 'open' },
    { number: 11, state: 'open' },
    { number: 1, state: 'bad' },
    { number: 1, state: 'open', token: 'secret' },
    { number: 1, state: 'open', paths: ['a', 'b'] }
  ]) {
    expect(schema.safeParse(value).success).toBe(false)
  }
})

it('rejects schema keywords that would otherwise be silently ignored for a type', () => {
  expect(pluginDataSchema.safeParse({ type: 'number', enum: ['secret'] }).success).toBe(false)
  expect(pluginDataSchema.safeParse({ type: 'boolean', properties: {} }).success).toBe(false)
})

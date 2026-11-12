// Validation straight from spec/openapi.yaml, so the host cannot drift from the contract.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormatsModule from 'ajv-formats'
import { parse } from 'yaml'

// import.meta.dirname rather than new URL(..., import.meta.url): DOM test environments
// replace the global URL class.
export const SPEC_PATH = join(import.meta.dirname, '..', '..', 'spec', 'openapi.yaml')
const SCHEMA_ID = 'urn:clearideas:analytics:v1'

export interface FieldError {
  path: string
  message: string
}

export type SchemaName =
  | 'Context'
  | 'Event'
  | 'EventBatch'
  | 'EventBatchResult'
  | 'ConsentRecordRequest'
  | 'ConsentRecordResult'
  | 'Problem'

export function loadSpec(): any {
  return parse(readFileSync(SPEC_PATH, 'utf8'))
}

export interface SpecValidator {
  validate(name: SchemaName, data: unknown): FieldError[]
}

/**
 * Compile every schema in components.schemas. OpenAPI 3.1 schemas are JSON Schema
 * 2020-12; refs of the form "#/components/schemas/X" are rewritten to "#/$defs/X".
 */
export function createValidator(spec: any = loadSpec()): SpecValidator {
  const defs = JSON.parse(
    JSON.stringify(spec.components.schemas).split('#/components/schemas/').join('#/$defs/'),
  )
  const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true })
  // ajv-formats is CommonJS; depending on the loader its default export may be nested.
  const addFormats = ((addFormatsModule as any).default ?? addFormatsModule) as (a: any) => void
  addFormats(ajv)
  ajv.addKeyword('example')
  ajv.addSchema({ $id: SCHEMA_ID, $defs: defs })

  const cache = new Map<SchemaName, ReturnType<typeof ajv.compile>>()
  const get = (name: SchemaName) => {
    let fn = cache.get(name)
    if (!fn) {
      fn = ajv.getSchema(`${SCHEMA_ID}#/$defs/${name}`) as ReturnType<typeof ajv.compile>
      if (!fn) throw new Error(`Schema ${name} not found in spec`)
      cache.set(name, fn)
    }
    return fn
  }

  // Compile everything eagerly so a broken spec fails at startup, not on first request.
  for (const name of Object.keys(defs)) ajv.getSchema(`${SCHEMA_ID}#/$defs/${name}`)

  return {
    validate(name, data) {
      const fn = get(name)
      if (fn(data)) return []
      return (fn.errors ?? []).map(error => ({
        path: error.instancePath || '/',
        message:
          error.keyword === 'additionalProperties'
            ? `unexpected property "${(error.params as any).additionalProperty}"`
            : (error.message ?? 'invalid'),
      }))
    },
  }
}

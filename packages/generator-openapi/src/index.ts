import type {
  Generator,
  GeneratorContext,
  GeneratorOutput,
  FabricSchema,
  EntitySchema,
  FieldSchema,
  EndpointSchema,
  BehaviorSchema,
  ApiSchema,
} from '@quoin/core'

// --- YAML helpers ---

function indent(n: number): string {
  return '  '.repeat(n)
}

function yamlStr(s: string): string {
  if (/[:#\[\]{},|>&*!'"@%`]/.test(s) || s.includes('\n') || s.trim() !== s) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return s
}

// --- OpenAPI schema generation from FieldSchema ---

interface OAProperty {
  type?: string
  format?: string
  enum?: string[]
  description?: string
  nullable?: boolean
}

function fieldToOAProperty(field: FieldSchema): OAProperty {
  const prop: OAProperty = {}
  if (field.description) prop.description = field.description
  if (field.nullable) prop.nullable = true

  if (field.type === 'enum' && field.enumValues) {
    prop.type = 'string'
    prop.enum = field.enumValues
    return prop
  }

  const mapping: Record<string, { type: string; format?: string }> = {
    string:    { type: 'string' },
    number:    { type: 'number' },
    integer:   { type: 'integer' },
    decimal:   { type: 'number', format: 'double' },
    boolean:   { type: 'boolean' },
    uuid:      { type: 'string', format: 'uuid' },
    timestamp: { type: 'string', format: 'date-time' },
    date:      { type: 'string', format: 'date' },
    email:     { type: 'string', format: 'email' },
    url:       { type: 'string', format: 'uri' },
    json:      { type: 'object' },
  }

  const m = mapping[field.type]
  if (m) {
    prop.type = m.type
    if (m.format) prop.format = m.format
  } else {
    prop.type = 'string'
  }

  return prop
}

function renderOAProperty(name: string, prop: OAProperty, depth: number): string {
  const lines: string[] = []
  lines.push(`${indent(depth)}${yamlStr(name)}:`)
  if (prop.type) lines.push(`${indent(depth + 1)}type: ${prop.type}`)
  if (prop.format) lines.push(`${indent(depth + 1)}format: ${prop.format}`)
  if (prop.nullable) lines.push(`${indent(depth + 1)}nullable: true`)
  if (prop.description) lines.push(`${indent(depth + 1)}description: ${yamlStr(prop.description)}`)
  if (prop.enum) {
    lines.push(`${indent(depth + 1)}enum:`)
    for (const v of prop.enum) lines.push(`${indent(depth + 2)}- ${yamlStr(v)}`)
  }
  return lines.join('\n')
}

function renderEntitySchema(entity: EntitySchema, depth: number): string {
  const lines: string[] = []
  lines.push(`${indent(depth)}type: object`)
  if (entity.description) lines.push(`${indent(depth)}description: ${yamlStr(entity.description)}`)

  const required = Object.values(entity.fields)
    .filter(f => !f.nullable)
    .map(f => f.name)

  if (required.length > 0) {
    lines.push(`${indent(depth)}required:`)
    for (const r of required) lines.push(`${indent(depth + 1)}- ${r}`)
  }

  lines.push(`${indent(depth)}properties:`)
  for (const field of Object.values(entity.fields)) {
    lines.push(renderOAProperty(field.name, fieldToOAProperty(field), depth + 1))
  }

  return lines.join('\n')
}

function renderInputSchema(input: Record<string, FieldSchema>, depth: number): string {
  const lines: string[] = []
  lines.push(`${indent(depth)}type: object`)

  const required = Object.values(input).filter(f => !f.nullable).map(f => f.name)
  if (required.length > 0) {
    lines.push(`${indent(depth)}required:`)
    for (const r of required) lines.push(`${indent(depth + 1)}- ${r}`)
  }

  lines.push(`${indent(depth)}properties:`)
  for (const field of Object.values(input)) {
    lines.push(renderOAProperty(field.name, fieldToOAProperty(field), depth + 1))
  }
  return lines.join('\n')
}

// --- Security scheme helpers ---

function buildSecurityRequirements(roles: string[]): string[] {
  return roles.map(r => `bearerAuth: [${yamlStr(r)}]`)
}

// --- Endpoint rendering ---

function resolveRequestBody(
  endpoint: EndpointSchema,
  schema: FabricSchema,
): string | null {
  if (endpoint.behavior) {
    const [entityName, behaviorName] = endpoint.behavior.split('.')
    const entity = entityName ? schema.entities[entityName] : undefined
    const behavior: BehaviorSchema | undefined = entity && behaviorName ? entity.behaviors[behaviorName] : undefined
    if (behavior?.input && Object.keys(behavior.input).length > 0) {
      return `${entityName}_${behaviorName}_Input`
    }
  }
  return null
}

function resolveResponseRef(endpoint: EndpointSchema): string | null {
  if (endpoint.returns) return endpoint.returns
  if (endpoint.behavior) {
    const [entityName, behaviorName] = endpoint.behavior.split('.')
    if (entityName && behaviorName) {
      // Check if it returns something via convention — we'll let generates handle this via returns
    }
  }
  return null
}

function renderEndpoint(
  key: string,
  endpoint: EndpointSchema,
  schema: FabricSchema,
  depth: number,
  fullOaPath?: string,
): string {
  const lines: string[] = []
  const method = endpoint.method.toLowerCase()
  lines.push(`${indent(depth)}${method}:`)

  if (endpoint.description) {
    lines.push(`${indent(depth + 1)}summary: ${yamlStr(endpoint.description)}`)
  }

  // Build operationId from the full OA path (already has {param} format)
  const opId = buildOperationId(method, fullOaPath ?? endpoint.path.replace(/:([a-zA-Z_]+)/g, '{$1}'))
  lines.push(`${indent(depth + 1)}operationId: ${opId}`)

  // path parameters
  const pathParams = (endpoint.path.match(/:[a-zA-Z_]+/g) ?? []).map(p => p.slice(1))
  if (pathParams.length > 0) {
    lines.push(`${indent(depth + 1)}parameters:`)
    for (const param of pathParams) {
      lines.push(`${indent(depth + 2)}- name: ${param}`)
      lines.push(`${indent(depth + 3)}in: path`)
      lines.push(`${indent(depth + 3)}required: true`)
      lines.push(`${indent(depth + 3)}schema:`)
      lines.push(`${indent(depth + 4)}type: string`)
    }
  }

  // security
  if (endpoint.auth?.roles && endpoint.auth.roles.length > 0) {
    lines.push(`${indent(depth + 1)}security:`)
    for (const req of buildSecurityRequirements(endpoint.auth.roles)) {
      lines.push(`${indent(depth + 2)}- ${req}`)
    }
    if (endpoint.auth.ownerField) {
      lines.push(`${indent(depth + 1)}x-owner-field: ${yamlStr(endpoint.auth.ownerField)}`)
    }
  }

  // requestBody
  const requestBodyRef = resolveRequestBody(endpoint, schema)
  if (requestBodyRef && ['post', 'put', 'patch'].includes(method)) {
    lines.push(`${indent(depth + 1)}requestBody:`)
    lines.push(`${indent(depth + 2)}required: true`)
    lines.push(`${indent(depth + 2)}content:`)
    lines.push(`${indent(depth + 3)}application/json:`)
    lines.push(`${indent(depth + 4)}schema:`)
    lines.push(`${indent(depth + 5)}$ref: '#/components/schemas/${requestBodyRef}'`)
  }

  // responses
  lines.push(`${indent(depth + 1)}responses:`)

  const responseRef = resolveResponseRef(endpoint)
  if (responseRef) {
    lines.push(`${indent(depth + 2)}'200':`)
    lines.push(`${indent(depth + 3)}description: Successful response`)
    lines.push(`${indent(depth + 3)}content:`)
    lines.push(`${indent(depth + 4)}application/json:`)
    lines.push(`${indent(depth + 5)}schema:`)
    lines.push(`${indent(depth + 6)}$ref: '#/components/schemas/${responseRef}'`)
  } else if (method === 'delete') {
    lines.push(`${indent(depth + 2)}'204':`)
    lines.push(`${indent(depth + 3)}description: No content`)
  } else {
    lines.push(`${indent(depth + 2)}'200':`)
    lines.push(`${indent(depth + 3)}description: Successful response`)
  }

  if (endpoint.auth?.roles && endpoint.auth.roles.length > 0) {
    lines.push(`${indent(depth + 2)}'401':`)
    lines.push(`${indent(depth + 3)}description: Unauthorized`)
    lines.push(`${indent(depth + 2)}'403':`)
    lines.push(`${indent(depth + 3)}description: Forbidden`)
  }

  return lines.join('\n')
}

function buildOperationId(method: string, path: string): string {
  const parts = path
    .split('/')
    .filter(Boolean)
    .map(p => {
      if (p.startsWith('{') && p.endsWith('}')) {
        const name = p.slice(1, -1)
        return 'By' + name.charAt(0).toUpperCase() + name.slice(1)
      }
      // camelCase kebab-cased segments (e.g. "return-book" → "ReturnBook")
      return p.split('-').map(seg => seg.charAt(0).toUpperCase() + seg.slice(1)).join('')
    })
  return method + parts.join('')
}

// --- Path grouping ---

interface PathEntry {
  fullPath: string
  endpoint: EndpointSchema
  key: string
}

function groupByPath(api: ApiSchema): Map<string, PathEntry[]> {
  const map = new Map<string, PathEntry[]>()
  const baseUrl = api.baseUrl ?? ''

  for (const [key, endpoint] of Object.entries(api.endpoints)) {
    const rawPath = endpoint.path === '' ? '' : endpoint.path
    // Convert Express-style :param to OpenAPI {param}
    const combined = (baseUrl + rawPath).replace(/:([a-zA-Z_]+)/g, '{$1}')
    // Normalize: ensure leading slash, strip trailing slash unless root
    const withSlash = combined.startsWith('/') ? combined : '/' + combined
    const normalized = withSlash.length > 1 ? withSlash.replace(/\/$/, '') : withSlash

    if (!map.has(normalized)) map.set(normalized, [])
    map.get(normalized)!.push({ fullPath: normalized, endpoint, key })
  }

  return map
}

// --- Auto-generated transition endpoints ---

function toKebab(s: string): string {
  return s.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`).replace(/^-/, '')
}

function toPlural(name: string): string {
  if (name.endsWith('y') && !/[aeiou]y$/.test(name)) {
    return name.slice(0, -1) + 'ies'
  }
  if (name.endsWith('s') || name.endsWith('sh') || name.endsWith('ch') || name.endsWith('x') || name.endsWith('z')) {
    return name + 'es'
  }
  return name + 's'
}

interface SyntheticEndpointEntry {
  oaPath: string
  endpoint: EndpointSchema
  key: string
}

function buildSyntheticTransitionEndpoints(schema: FabricSchema): SyntheticEndpointEntry[] {
  // Collect all behavior refs already declared in explicit APIs
  const coveredBehaviors = new Set<string>()
  for (const api of Object.values(schema.apis)) {
    for (const endpoint of Object.values(api.endpoints)) {
      if (endpoint.behavior) coveredBehaviors.add(endpoint.behavior)
    }
  }

  const entries: SyntheticEndpointEntry[] = []

  for (const entity of Object.values(schema.entities)) {
    if (!entity.stateMachine) continue
    const seenTriggers = new Set<string>()

    for (const transition of entity.stateMachine.transitions) {
      const trigger = transition.trigger
      if (seenTriggers.has(trigger)) continue
      seenTriggers.add(trigger)

      const behaviorRef = `${entity.name}.${trigger}`
      if (coveredBehaviors.has(behaviorRef)) continue

      const behavior = entity.behaviors[trigger]
      const resourcePath = `/${toPlural(toKebab(entity.name))}/{id}/${toKebab(trigger)}`
      const endpoint: EndpointSchema = {
        method: 'POST',
        path: resourcePath,
        description: behavior?.description ?? `Trigger ${trigger} on ${entity.name}`,
        behavior: behaviorRef,
        auth: behavior?.auth,
      }
      entries.push({ oaPath: resourcePath, endpoint, key: `POST ${resourcePath}` })
    }
  }

  return entries
}

// --- Full document ---

function generateOpenApiDoc(schema: FabricSchema): string {
  const lines: string[] = []

  lines.push('openapi: 3.0.3')
  lines.push('info:')
  lines.push(`  title: ${yamlStr(schema.meta.name)}`)
  if (schema.meta.description) lines.push(`  description: ${yamlStr(schema.meta.description)}`)
  lines.push(`  version: ${yamlStr(schema.meta.version ?? '1.0.0')}`)

  // Collect all input schemas needed (explicit APIs + synthetics)
  const inputSchemas: Array<{ name: string; input: Record<string, FieldSchema> }> = []
  for (const entity of Object.values(schema.entities)) {
    for (const [, behavior] of Object.entries(entity.behaviors)) {
      if (behavior.input && Object.keys(behavior.input).length > 0) {
        inputSchemas.push({ name: `${entity.name}_${behavior.name}_Input`, input: behavior.input })
      }
    }
  }

  const syntheticEntries = buildSyntheticTransitionEndpoints(schema)

  // paths
  lines.push('')
  lines.push('paths:')

  for (const api of Object.values(schema.apis)) {
    const byPath = groupByPath(api)
    for (const [oaPath, entries] of byPath) {
      lines.push(`  ${yamlStr(oaPath)}:`)
      for (const { key, endpoint } of entries) {
        lines.push(renderEndpoint(key, endpoint, schema, 2, oaPath))
      }
    }
  }

  // Group synthetic endpoints by path
  const byPath = new Map<string, SyntheticEndpointEntry[]>()
  for (const entry of syntheticEntries) {
    if (!byPath.has(entry.oaPath)) byPath.set(entry.oaPath, [])
    byPath.get(entry.oaPath)!.push(entry)
  }
  for (const [oaPath, entries] of byPath) {
    lines.push(`  ${yamlStr(oaPath)}:`)
    for (const { key, endpoint } of entries) {
      lines.push(renderEndpoint(key, endpoint, schema, 2, oaPath))
    }
  }

  // components
  lines.push('')
  lines.push('components:')
  lines.push('  securitySchemes:')
  lines.push('    bearerAuth:')
  lines.push('      type: http')
  lines.push('      scheme: bearer')
  lines.push('      bearerFormat: JWT')

  lines.push('  schemas:')

  for (const entity of Object.values(schema.entities)) {
    lines.push(`    ${entity.name}:`)
    lines.push(renderEntitySchema(entity, 3))
  }

  for (const { name, input } of inputSchemas) {
    lines.push(`    ${name}:`)
    lines.push(renderInputSchema(input, 3))
  }

  return lines.join('\n') + '\n'
}

export class OpenApiGenerator implements Generator {
  readonly name = 'openapi'
  readonly dependsOn: string[] = ['typescript']

  async generate(schema: FabricSchema, _ctx: GeneratorContext): Promise<GeneratorOutput> {
    const content = generateOpenApiDoc(schema)

    return {
      files: [
        {
          path: 'openapi/openapi.yaml',
          content,
          header: '# @generated by @quoin/generator-openapi — do not edit\n',
        },
      ],
    }
  }
}

import type {
  FabricSchema,
  EntitySchema,
  FieldSchema,
  BehaviorSchema,
  StateMachineSchema,
  TransitionSchema,
  StateSchema,
  ApiSchema,
  EndpointSchema,
  GdprCategory,
  ConceptRole,
} from './types'
import type {
  FabricInput,
  EntityInput,
  FieldInput,
  StateMachineInput,
  BehaviorInput,
  ApiInput,
  EndpointInput,
} from './input-types'
import { CURRENT_IR_VERSION } from './version'

const VALID_CONCEPT_ROLES: readonly ConceptRole[] = ['entity', 'material', 'item', 'creature', 'biome', 'system']

function normalizeField(name: string, raw: FieldInput, context?: string): FieldSchema {
  const loc = context ? `${context}.fields.${name}` : `fields.${name}`
  if (!raw.type) throw new Error(`${loc}: missing required property "type"`)
  if (raw.type === 'enum' && !raw.enumValues && !raw.values) {
    throw new Error(`${loc}: enum field must specify "values" or "enumValues"`)
  }

  const gdprCategory = raw.gdprCategory ?? raw.gdpr?.category
  const gdprRetention = raw.gdprRetention ?? raw.gdpr?.retention
  const gdprLegalBasis = raw.gdprLegalBasis ?? raw.gdpr?.legalBasis

  return {
    name,
    type: raw.type,
    description: raw.description,
    nullable: raw.nullable ?? false,
    primaryKey: raw.primaryKey ?? false,
    enumValues: raw.type === 'enum' ? (raw.enumValues ?? raw.values) : undefined,
    foreignKey: raw.foreignKey,
    pii: raw.pii ?? false,
    gdprCategory,
    gdprRetention,
    gdprLegalBasis,
  }
}

function normalizeTransition(
  raw: { from: string | string[], to: string, trigger: string, guard?: string, guards?: string[], effect?: string, effects?: string[] },
  behaviorRules?: string[],
  context?: string,
): TransitionSchema {
  const loc = context ?? 'transition'
  if (!raw.to) throw new Error(`${loc}: transition is missing required "to" state`)
  if (!raw.from && raw.from !== '') throw new Error(`${loc}: transition is missing required "from" state`)
  const explicitGuards = raw.guards ?? (raw.guard ? [raw.guard] : null)
  const guards = explicitGuards ?? behaviorRules ?? []
  const effects = raw.effects ?? (raw.effect ? [raw.effect] : [])
  return { from: raw.from, to: raw.to, trigger: raw.trigger, guards, effects }
}

function normalizeState(name: string, raw: { description?: string, terminal?: boolean } | string): StateSchema {
  if (typeof raw === 'string') {
    return { name, description: raw, terminal: false }
  }
  return { name, description: raw.description ?? '', terminal: raw.terminal ?? false }
}

function normalizeStateMachine(raw: StateMachineInput, behaviors: Record<string, BehaviorSchema>, entityName: string): StateMachineSchema {
  if (!raw.field) throw new Error(`entities.${entityName}.stateMachine: missing required "field" property`)
  if (!raw.initial) throw new Error(`entities.${entityName}.stateMachine: missing required "initial" state`)
  if (!raw.states || Object.keys(raw.states).length === 0) {
    throw new Error(`entities.${entityName}.stateMachine: must declare at least one state`)
  }
  const states: Record<string, StateSchema> = {}
  for (const [name, s] of Object.entries(raw.states)) {
    states[name] = normalizeState(name, s)
  }
  return {
    field: raw.field,
    initial: raw.initial,
    states,
    transitions: (raw.transitions ?? []).map((t, i) => {
      const loc = `entities.${entityName}.stateMachine.transitions[${i}]`
      const behaviorRules = t.trigger && behaviors[t.trigger]?.rules
      return normalizeTransition(t, behaviorRules || undefined, loc)
    }),
  }
}

function normalizeBehavior(name: string, raw: BehaviorInput, entityName: string): BehaviorSchema {
  const loc = `entities.${entityName}.behaviors.${name}`
  const input: Record<string, FieldSchema> | undefined = raw.input
    ? Object.fromEntries(Object.entries(raw.input).map(([k, v]) => [k, normalizeField(k, v, loc)]))
    : undefined
  return {
    name,
    description: raw.description ?? '',
    rules: raw.rules ?? [],
    input,
    output: raw.output,
    auth: raw.auth,
    transitions: raw.transitions,
  }
}

function normalizeEntity(name: string, raw: EntityInput): EntitySchema {
  const fields: Record<string, FieldSchema> = {}
  const pii: string[] = []
  const gdpr: Record<string, GdprCategory> = {}

  for (const [fieldName, rawField] of Object.entries(raw.fields ?? {})) {
    const field = normalizeField(fieldName, rawField, `entities.${name}`)
    fields[fieldName] = field
    if (field.pii) pii.push(fieldName)
    if (field.gdprCategory) gdpr[fieldName] = field.gdprCategory
  }

  const behaviors: Record<string, BehaviorSchema> = {}
  for (const [bName, rawB] of Object.entries(raw.behaviors ?? {})) {
    behaviors[bName] = normalizeBehavior(bName, rawB, name)
  }

  const role = raw.role ?? 'entity'
  if (!VALID_CONCEPT_ROLES.includes(role)) {
    throw new Error(`entities.${name}: invalid role "${role}". Must be one of: ${VALID_CONCEPT_ROLES.join(', ')}`)
  }

  return {
    name,
    role,
    description: raw.description ?? '',
    goal: raw.goal,
    fields,
    relations: raw.relations ?? {},
    behaviors,
    stateMachine: raw.stateMachine ? normalizeStateMachine(raw.stateMachine, behaviors, name) : undefined,
    pii,
    gdpr,
  }
}

function normalizeEndpoint(key: string, raw: EndpointInput, apiName: string): EndpointSchema {
  const spaceIdx = key.indexOf(' ')
  if (spaceIdx === -1) {
    throw new Error(`apis.${apiName}.endpoints["${key}"]: endpoint key must be "METHOD /path" (e.g. "POST /orders")`)
  }
  const method = key.slice(0, spaceIdx).toUpperCase()
  const path = key.slice(spaceIdx + 1)
  return { method, path, description: raw.description, behavior: raw.behavior, returns: raw.returns, auth: raw.auth }
}

function normalizeApi(name: string, raw: ApiInput): ApiSchema {
  const endpoints: Record<string, EndpointSchema> = {}
  for (const [key, rawEp] of Object.entries(raw.endpoints ?? {})) {
    endpoints[key] = normalizeEndpoint(key, rawEp, name)
  }
  return { name, baseUrl: raw.baseUrl, endpoints }
}

export function normalizeSchema(raw: unknown): FabricSchema {
  const r = raw as FabricInput
  if (!r || typeof r !== 'object') throw new Error('fabric export must be a plain object')
  if (!r.meta?.name) throw new Error('fabric export must have a "meta.name" field')

  const entities: Record<string, EntitySchema> = {}
  for (const [name, rawEntity] of Object.entries(r.entities ?? {})) {
    entities[name] = normalizeEntity(name, rawEntity)
  }

  const apis: Record<string, ApiSchema> = {}
  for (const [name, rawApi] of Object.entries(r.apis ?? {})) {
    apis[name] = normalizeApi(name, rawApi)
  }

  return {
    version: CURRENT_IR_VERSION,
    meta: {
      name: r.meta.name,
      description: r.meta.description,
      version: r.meta.version,
      namespace: r.meta.namespace,
    },
    entities,
    apis,
  }
}

import type { FabricSchema, ConceptRole } from './types'
import type { Patch, MergePatch, SuppressPatch } from './patch'

const VALID_CONCEPT_ROLES: readonly ConceptRole[] = ['entity', 'material', 'item', 'creature', 'biome', 'system']

/**
 * Returns a deep-cloned FabricSchema with all merge patches applied.
 * Does NOT filter suppressed files — suppression is handled by the runner
 * after generators produce their output, since only the runner knows file paths.
 *
 * Throws a descriptive error if a patch target path does not resolve.
 */
export function applyPatches(schema: FabricSchema, patches: Patch[]): FabricSchema {
  const merges = patches.filter((p): p is MergePatch => p.op === 'merge')
  if (merges.length === 0) return schema

  // Deep clone so the original IR is never mutated.
  let result = JSON.parse(JSON.stringify(schema)) as FabricSchema

  for (const patch of merges) {
    result = applyMerge(result, patch)
  }

  return result
}

/**
 * Returns the set of suppress patterns from the patch list.
 * The runner uses these to filter generated files by path.
 */
export function collectSuppressPatterns(patches: Patch[]): string[] {
  return patches
    .filter((p): p is SuppressPatch => p.op === 'suppress')
    .map(p => p.pattern)
}

/**
 * Returns true if `filePath` matches any of the suppress patterns.
 * Patterns support `*` as a wildcard within a single path segment.
 */
export function isSuppressed(filePath: string, patterns: string[]): boolean {
  return patterns.some(pattern => matchGlob(pattern, filePath))
}

function matchGlob(pattern: string, filePath: string): boolean {
  // Escape regex metacharacters except *, then replace * with [^/]*
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  return new RegExp(`^${escaped}$`).test(filePath)
}

function applyMerge(schema: FabricSchema, patch: MergePatch): FabricSchema {
  const segments = patch.target.split('.')

  if (segments[0] === 'meta' && segments.length === 1) {
    return { ...schema, meta: { ...schema.meta, ...patch.value } }
  }

  if (segments[0] === 'entity') {
    return applyEntityMerge(schema, segments, patch)
  }

  if (segments[0] === 'api') {
    return applyApiMerge(schema, segments, patch)
  }

  throw new Error(
    `patch target "${patch.target}" is not supported. ` +
    `Valid roots: meta, entity.<Name>[.fields.<field>|.behaviors.<b>|.stateMachine.states.<s>], ` +
    `api.<Name>[.endpoints.<key>]`
  )
}

function applyEntityMerge(schema: FabricSchema, segments: string[], patch: MergePatch): FabricSchema {
  const [, entityName, ...rest] = segments

  if (!entityName) {
    throw new Error(`patch target "${patch.target}": missing entity name`)
  }
  if (!(entityName in schema.entities)) {
    throw new Error(`patch target "${patch.target}": entity "${entityName}" not found in schema`)
  }

  const entity = schema.entities[entityName]

  let patchedEntity = entity
  if (rest.length === 0) {
    if ('role' in patch.value && !VALID_CONCEPT_ROLES.includes(patch.value.role as ConceptRole)) {
      throw new Error(
        `patch target "${patch.target}": invalid role "${patch.value.role}". Must be one of: ${VALID_CONCEPT_ROLES.join(', ')}`
      )
    }
    patchedEntity = { ...entity, ...patch.value } as typeof entity
  } else if (rest[0] === 'fields') {
    patchedEntity = applyFieldMerge(entity, rest, patch)
  } else if (rest[0] === 'behaviors') {
    patchedEntity = applyBehaviorMerge(entity, rest, patch)
  } else if (rest[0] === 'stateMachine') {
    patchedEntity = applyStateMachineMerge(entity, rest, patch)
  } else {
    throw new Error(
      `patch target "${patch.target}": unsupported entity sub-path "${rest[0]}". ` +
      `Supported: fields, behaviors, stateMachine`
    )
  }

  return {
    ...schema,
    entities: { ...schema.entities, [entityName]: patchedEntity },
  }
}

function applyFieldMerge(
  entity: FabricSchema['entities'][string],
  rest: string[],
  patch: MergePatch,
): FabricSchema['entities'][string] {
  const [, fieldName] = rest
  if (!fieldName) {
    throw new Error(`patch target "${patch.target}": missing field name after "fields"`)
  }
  if (!(fieldName in entity.fields)) {
    throw new Error(`patch target "${patch.target}": field "${fieldName}" not found on entity "${entity.name}"`)
  }
  return {
    ...entity,
    fields: {
      ...entity.fields,
      [fieldName]: { ...entity.fields[fieldName], ...patch.value },
    },
  }
}

function applyBehaviorMerge(
  entity: FabricSchema['entities'][string],
  rest: string[],
  patch: MergePatch,
): FabricSchema['entities'][string] {
  const [, behaviorName] = rest
  if (!behaviorName) {
    throw new Error(`patch target "${patch.target}": missing behavior name after "behaviors"`)
  }
  if (!(behaviorName in entity.behaviors)) {
    throw new Error(`patch target "${patch.target}": behavior "${behaviorName}" not found on entity "${entity.name}"`)
  }
  return {
    ...entity,
    behaviors: {
      ...entity.behaviors,
      [behaviorName]: { ...entity.behaviors[behaviorName], ...patch.value },
    },
  }
}

function applyStateMachineMerge(
  entity: FabricSchema['entities'][string],
  rest: string[],
  patch: MergePatch,
): FabricSchema['entities'][string] {
  if (!entity.stateMachine) {
    throw new Error(`patch target "${patch.target}": entity "${entity.name}" has no state machine`)
  }
  if (rest.length === 1) {
    // merge into stateMachine root
    return { ...entity, stateMachine: { ...entity.stateMachine, ...patch.value } as typeof entity.stateMachine }
  }
  if (rest[1] === 'states') {
    const stateName = rest[2]
    if (!stateName) {
      throw new Error(`patch target "${patch.target}": missing state name after "states"`)
    }
    if (!(stateName in entity.stateMachine.states)) {
      throw new Error(`patch target "${patch.target}": state "${stateName}" not found in entity "${entity.name}" state machine`)
    }
    return {
      ...entity,
      stateMachine: {
        ...entity.stateMachine,
        states: {
          ...entity.stateMachine.states,
          [stateName]: { ...entity.stateMachine.states[stateName], ...patch.value },
        },
      },
    }
  }
  throw new Error(
    `patch target "${patch.target}": unsupported stateMachine sub-path "${rest[1]}". Supported: states`
  )
}

function applyApiMerge(schema: FabricSchema, segments: string[], patch: MergePatch): FabricSchema {
  const [, apiName, ...rest] = segments

  if (!apiName) {
    throw new Error(`patch target "${patch.target}": missing api name`)
  }
  if (!(apiName in schema.apis)) {
    throw new Error(`patch target "${patch.target}": api "${apiName}" not found in schema`)
  }

  const api = schema.apis[apiName]

  let patchedApi = api
  if (rest.length === 0) {
    patchedApi = { ...api, ...patch.value } as typeof api
  } else if (rest[0] === 'endpoints') {
    const endpointKey = rest[1]
    if (!endpointKey) {
      throw new Error(`patch target "${patch.target}": missing endpoint key after "endpoints"`)
    }
    if (!(endpointKey in api.endpoints)) {
      throw new Error(`patch target "${patch.target}": endpoint "${endpointKey}" not found in api "${apiName}"`)
    }
    patchedApi = {
      ...api,
      endpoints: {
        ...api.endpoints,
        [endpointKey]: { ...api.endpoints[endpointKey], ...patch.value },
      },
    }
  } else {
    throw new Error(
      `patch target "${patch.target}": unsupported api sub-path "${rest[0]}". Supported: endpoints`
    )
  }

  return {
    ...schema,
    apis: { ...schema.apis, [apiName]: patchedApi },
  }
}

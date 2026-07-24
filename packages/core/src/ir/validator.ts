import type { FabricSchema, EntitySchema, StateMachineSchema, ConceptRole } from './types'

const VALID_CONCEPT_ROLES: readonly ConceptRole[] = ['entity', 'material', 'item', 'creature', 'biome', 'system']

export interface ValidationError {
  path: string
  message: string
}

export interface ValidationWarning {
  path: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

function err(path: string, message: string): ValidationError {
  return { path, message }
}

function warn(path: string, message: string): ValidationWarning {
  return { path, message }
}

function validateStateMachine(
  sm: StateMachineSchema,
  entity: EntitySchema,
  entityName: string,
): { errors: ValidationError[], warnings: ValidationWarning[] } {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []
  const base = `entities.${entityName}.stateMachine`
  const stateNames = new Set(Object.keys(sm.states))

  if (!stateNames.has(sm.initial)) {
    errors.push(err(`${base}.initial`, `initial state "${sm.initial}" is not declared in states`))
  }

  if (!(sm.field in entity.fields)) {
    errors.push(err(`${base}.field`, `state machine field "${sm.field}" does not exist on entity`))
  }

  for (let i = 0; i < sm.transitions.length; i++) {
    const t = sm.transitions[i]
    const tBase = `${base}.transitions[${i}]`

    const froms = Array.isArray(t.from) ? t.from : [t.from]
    for (const f of froms) {
      if (!stateNames.has(f)) {
        errors.push(err(`${tBase}.from`, `state "${f}" is not declared in states`))
      }
    }

    if (!stateNames.has(t.to)) {
      errors.push(err(`${tBase}.to`, `state "${t.to}" is not declared in states`))
    }

    if (t.trigger && !(t.trigger in entity.behaviors)) {
      errors.push(err(`${tBase}.trigger`, `trigger "${t.trigger}" does not match any behavior on entity "${entityName}"`))
    } else if (t.trigger && t.guards.length > 0) {
      const behavior = entity.behaviors[t.trigger]
      if (behavior) {
        const guardSet = new Set(t.guards)
        const ruleSet = new Set(behavior.rules)
        const guardsDifferFromRules = t.guards.some(g => !ruleSet.has(g)) || behavior.rules.some(r => !guardSet.has(r))
        if (guardsDifferFromRules) {
          warnings.push(warn(
            `${tBase}.guards`,
            `transition guards differ from behavior "${t.trigger}" rules — prefer letting the normalizer derive guards from rules to avoid duplication`,
          ))
        }
      }
    }
  }

  return { errors, warnings }
}

function validateEntity(
  name: string,
  entity: EntitySchema,
  schema: FabricSchema,
): { errors: ValidationError[], warnings: ValidationWarning[] } {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  if (!VALID_CONCEPT_ROLES.includes(entity.role)) {
    errors.push(err(`entities.${name}.role`, `invalid role "${entity.role}". Must be one of: ${VALID_CONCEPT_ROLES.join(', ')}`))
  }

  for (const [bName, behavior] of Object.entries(entity.behaviors)) {
    if (behavior.auth?.ownerField && !(behavior.auth.ownerField in entity.fields)) {
      errors.push(err(
        `entities.${name}.behaviors.${bName}.auth.ownerField`,
        `ownerField "${behavior.auth.ownerField}" does not exist on entity "${name}"`,
      ))
    }
  }

  for (const [fieldName, field] of Object.entries(entity.fields)) {
    const base = `entities.${name}.fields.${fieldName}`
    if (field.type === 'enum' && (!field.enumValues || field.enumValues.length === 0)) {
      errors.push(err(base, `enum field must have at least one value in enumValues`))
    }
    if (field.foreignKey) {
      const [refEntity] = field.foreignKey.split('.')
      if (!(refEntity in schema.entities)) {
        errors.push(err(`${base}.foreignKey`, `references unknown entity "${refEntity}"`))
      }
    }
  }

  for (const [relName, rel] of Object.entries(entity.relations)) {
    if (!(rel.target in schema.entities)) {
      errors.push(err(`entities.${name}.relations.${relName}.target`, `references unknown entity "${rel.target}"`))
    }
  }

  if (entity.stateMachine) {
    const smResult = validateStateMachine(entity.stateMachine, entity, name)
    errors.push(...smResult.errors)
    warnings.push(...smResult.warnings)
  }

  return { errors, warnings }
}

function validateApis(schema: FabricSchema): ValidationError[] {
  const errors: ValidationError[] = []

  for (const [apiName, api] of Object.entries(schema.apis)) {
    for (const [key, endpoint] of Object.entries(api.endpoints)) {
      const base = `apis.${apiName}.endpoints["${key}"]`
      if (endpoint.returns && !(endpoint.returns in schema.entities)) {
        errors.push(err(`${base}.returns`, `references unknown entity "${endpoint.returns}"`))
      }

      if (endpoint.auth?.ownerField) {
        const [entityName] = (endpoint.behavior ?? '').split('.')
        const entity = entityName ? schema.entities[entityName] : undefined
        if (entity && !(endpoint.auth.ownerField in entity.fields)) {
          errors.push(err(`${base}.auth.ownerField`, `ownerField "${endpoint.auth.ownerField}" does not exist on entity "${entityName}"`))
        }
      }
    }
  }

  return errors
}

export function validateSchema(schema: FabricSchema): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  for (const [name, entity] of Object.entries(schema.entities)) {
    const result = validateEntity(name, entity, schema)
    errors.push(...result.errors)
    warnings.push(...result.warnings)
  }

  errors.push(...validateApis(schema))

  return { valid: errors.length === 0, errors, warnings }
}

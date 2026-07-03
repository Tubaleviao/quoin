import type { FabricSchema, EntitySchema, StateMachineSchema } from './types'

export interface ValidationError {
  path: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

function err(path: string, message: string): ValidationError {
  return { path, message }
}

function validateStateMachine(sm: StateMachineSchema, entity: EntitySchema, entityName: string): ValidationError[] {
  const errors: ValidationError[] = []
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
    }
  }

  return errors
}

function validateEntity(name: string, entity: EntitySchema, schema: FabricSchema): ValidationError[] {
  const errors: ValidationError[] = []

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
    errors.push(...validateStateMachine(entity.stateMachine, entity, name))
  }

  return errors
}

function validateApis(schema: FabricSchema): ValidationError[] {
  const errors: ValidationError[] = []

  for (const [apiName, api] of Object.entries(schema.apis)) {
    for (const [key, endpoint] of Object.entries(api.endpoints)) {
      const base = `apis.${apiName}.endpoints["${key}"]`
      if (endpoint.returns && !(endpoint.returns in schema.entities)) {
        errors.push(err(`${base}.returns`, `references unknown entity "${endpoint.returns}"`))
      }
    }
  }

  return errors
}

export function validateSchema(schema: FabricSchema): ValidationResult {
  const errors: ValidationError[] = []

  for (const [name, entity] of Object.entries(schema.entities)) {
    errors.push(...validateEntity(name, entity, schema))
  }

  errors.push(...validateApis(schema))

  return { valid: errors.length === 0, errors }
}

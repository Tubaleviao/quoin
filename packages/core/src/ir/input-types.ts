import type { FieldType, GdprCategory, GdprLegalBasis, RelationSchema, SchemaMeta, ConceptRole } from './types'

export type GdprInput = {
  category?: GdprCategory
  retention?: string
  legalBasis?: GdprLegalBasis
}

export type FieldInput = {
  type: FieldType
  description?: string
  nullable?: boolean
  primaryKey?: boolean
  /** Enum values — alias for enumValues */
  values?: string[]
  enumValues?: string[]
  foreignKey?: string
  pii?: boolean
  /** Nested GDPR object — alternative to flat gdprCategory/gdprRetention/gdprLegalBasis */
  gdpr?: GdprInput
  gdprCategory?: GdprCategory
  gdprRetention?: string
  gdprLegalBasis?: GdprLegalBasis
}

export type TransitionInput = {
  from: string | string[]
  to: string
  trigger: string
  /** Single guard string — normalised to guards[] */
  guard?: string
  guards?: string[]
  /** Single effect string — normalised to effects[] */
  effect?: string
  effects?: string[]
}

export type StateInput = {
  description?: string
  terminal?: boolean
}

export type StateMachineInput = {
  field: string
  initial: string
  /** State value may be a plain description string or a StateInput object */
  states: Record<string, StateInput | string>
  transitions: TransitionInput[]
}

export type AuthInput = {
  roles: string[]
  ownerField?: string
}

export type BehaviorInput = {
  description: string
  rules?: string[]
  input?: Record<string, FieldInput>
  output?: string
  auth?: AuthInput
  transitions?: string[]
}

export type EndpointInput = {
  description?: string
  behavior?: string
  returns?: string
  auth?: AuthInput
}

export type ApiInput = {
  baseUrl?: string
  endpoints: Record<string, EndpointInput>
}

export type EntityInput = {
  role?: ConceptRole
  description?: string
  goal?: string
  fields?: Record<string, FieldInput>
  relations?: Record<string, RelationSchema>
  behaviors?: Record<string, BehaviorInput>
  stateMachine?: StateMachineInput
}

export type FabricInput = {
  meta: Partial<SchemaMeta> & { name: string }
  entities?: Record<string, EntityInput>
  apis?: Record<string, ApiInput>
}

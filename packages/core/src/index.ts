export { fabric, FabricBuilder } from './builders/fabric'
export { defineConfig } from './config'
export { EntityBuilder } from './builders/entity'
export { TypedFieldBuilder, FieldBuilder } from './builders/field'
export { RelationBuilder } from './builders/relation'
export { BehaviorBuilder } from './builders/behavior'
export { StateMachineBuilder } from './builders/statemachine'
export { ApiBuilder } from './builders/api'

export { normalizeSchema } from './ir/normalizer'
export { CURRENT_IR_VERSION } from './ir/version'
export { validateSchema } from './ir/validator'
export type { ValidationResult, ValidationError, ValidationWarning } from './ir/validator'
export { defineEntity, defineApi, defineFabric } from './ir/define'
export type {
  FabricInput,
  EntityInput,
  FieldInput,
  ApiInput,
  EndpointInput,
  BehaviorInput,
  StateMachineInput,
  TransitionInput,
  StateInput,
  AuthInput,
  GdprInput,
} from './ir/input-types'

export type {
  ConceptRole,
  FabricSchema,
  EntitySchema,
  FieldSchema,
  FieldType,
  RelationSchema,
  BehaviorSchema,
  StateMachineSchema,
  StateSchema,
  TransitionSchema,
  ApiSchema,
  EndpointSchema,
  EventSchema,
  GraphSchema,
  SchemaMeta,
  GdprCategory,
  GdprLegalBasis,
  AuthSchema,
} from './ir/types'

export type {
  Generator,
  GeneratorContext,
  GeneratorOutput,
  GeneratedFile,
} from './runner/types'

export { runGenerators } from './runner/runner'
export { topoSort } from './runner/dag'
export { checkDrift } from './runner/drift'
export { readManifest, writeManifest, hashContent, hashSchema } from './runner/manifest'
export type { Manifest, ManifestEntry } from './runner/manifest'
export { readSnapshot, writeSnapshot, buildSnapshot } from './runner/snapshot'
export type { IRSnapshot } from './runner/snapshot'

export { definePatchSet } from './ir/patch'
export type { Patch, MergePatch, SuppressPatch, PatchSet } from './ir/patch'
export { applyPatches, collectSuppressPatterns, isSuppressed } from './ir/apply-patches'

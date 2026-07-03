import type { FabricSchema, SchemaMeta, EntitySchema, ApiSchema } from '../ir/types'
import { CURRENT_IR_VERSION } from '../ir/version'
import { EntityBuilder } from './entity'
import { ApiBuilder } from './api'

class MetaBuilder {
  private _meta: SchemaMeta = { name: 'unnamed' }

  name(name: string): this {
    this._meta.name = name
    return this
  }

  description(desc: string): this {
    this._meta.description = desc
    return this
  }

  version(version: string): this {
    this._meta.version = version
    return this
  }

  namespace(ns: string): this {
    this._meta.namespace = ns
    return this
  }

  toIR(): SchemaMeta {
    return { ...this._meta }
  }
}

export class FabricBuilder {
  private _meta: MetaBuilder = new MetaBuilder()
  private _entities: Record<string, EntitySchema> = {}
  private _apis: Record<string, ApiSchema> = {}

  meta(fn: (m: MetaBuilder) => MetaBuilder | void): this {
    fn(this._meta)
    return this
  }

  entity(name: string, fn: (e: EntityBuilder) => EntityBuilder | void): this {
    const b = new EntityBuilder(name)
    fn(b)
    this._entities[name] = b.toIR()
    return this
  }

  api(name: string, fn: (a: ApiBuilder) => ApiBuilder | void): this {
    const b = new ApiBuilder(name)
    fn(b)
    this._apis[name] = b.toIR()
    return this
  }

  toIR(): FabricSchema {
    return {
      version: CURRENT_IR_VERSION,
      meta: this._meta.toIR(),
      entities: { ...this._entities },
      apis: { ...this._apis },
    }
  }
}

export function fabric(): FabricBuilder {
  return new FabricBuilder()
}

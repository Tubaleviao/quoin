import type { EntitySchema, FieldSchema, RelationSchema, BehaviorSchema, GdprCategory, ConceptRole } from '../ir/types'
import { TypedFieldBuilder } from './field'
import { RelationBuilder } from './relation'
import { BehaviorBuilder } from './behavior'
import { StateMachineBuilder } from './statemachine'

export class EntityBuilder {
  private _name: string
  private _role: ConceptRole = 'entity'
  private _description: string = ''
  private _goal: string | undefined
  private _fields: Record<string, FieldSchema> = {}
  private _relations: Record<string, RelationSchema> = {}
  private _behaviors: Record<string, BehaviorSchema> = {}
  private _stateMachine: ReturnType<StateMachineBuilder['toIR']> | undefined
  private _pii: string[] = []
  private _gdpr: Record<string, GdprCategory> = {}

  constructor(name: string) {
    this._name = name
  }

  description(desc: string): this {
    this._description = desc
    return this
  }

  role(role: ConceptRole): this {
    this._role = role
    return this
  }

  goal(goal: string): this {
    this._goal = goal
    return this
  }

  field(name: string, fn: (f: TypedFieldBuilder) => TypedFieldBuilder | void): this {
    const b = new TypedFieldBuilder(name)
    fn(b)
    const ir = b.toIR()
    this._fields[name] = ir
    if (ir.pii) this._pii.push(name)
    if (ir.gdprCategory) this._gdpr[name] = ir.gdprCategory
    return this
  }

  relation(name: string, fn: (r: RelationBuilder) => RelationBuilder | void): this {
    const b = new RelationBuilder(name)
    fn(b)
    this._relations[name] = b.toIR()
    return this
  }

  behavior(name: string, fn: (b: BehaviorBuilder) => BehaviorBuilder | void): this {
    const b = new BehaviorBuilder(name)
    fn(b)
    this._behaviors[name] = b.toIR()
    return this
  }

  stateMachine(field: string, fn: (sm: StateMachineBuilder) => StateMachineBuilder | void): this {
    const b = new StateMachineBuilder(field)
    fn(b)
    this._stateMachine = b.toIR()
    return this
  }

  toIR(): EntitySchema {
    return {
      name: this._name,
      role: this._role,
      description: this._description,
      goal: this._goal,
      fields: { ...this._fields },
      relations: { ...this._relations },
      behaviors: { ...this._behaviors },
      stateMachine: this._stateMachine,
      pii: [...this._pii],
      gdpr: { ...this._gdpr },
    }
  }
}

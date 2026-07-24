import { normalizeSchema } from './normalizer'

describe('normalizeSchema', () => {
  it('rejects non-objects', () => {
    expect(() => normalizeSchema(null)).toThrow('plain object')
    expect(() => normalizeSchema('string')).toThrow('plain object')
  })

  it('rejects missing meta.name', () => {
    expect(() => normalizeSchema({ meta: {} })).toThrow('meta.name')
  })

  it('reports entity and field name when type is missing', () => {
    expect(() => normalizeSchema({
      meta: { name: 'Test' },
      entities: { Order: { fields: { status: {} } } },
    })).toThrow('entities.Order.fields.status: missing required property "type"')
  })

  it('reports entity and field name when enum has no values', () => {
    expect(() => normalizeSchema({
      meta: { name: 'Test' },
      entities: { Order: { fields: { status: { type: 'enum' } } } },
    })).toThrow('entities.Order.fields.status: enum field must specify "values" or "enumValues"')
  })

  it('reports entity and field name in behavior input fields', () => {
    expect(() => normalizeSchema({
      meta: { name: 'Test' },
      entities: {
        Order: {
          fields: { id: { type: 'uuid' } },
          behaviors: {
            placeOrder: { description: 'Place', rules: [], input: { qty: {} } },
          },
        },
      },
    })).toThrow('entities.Order.behaviors.placeOrder.fields.qty: missing required property "type"')
  })

  it('reports stateMachine errors with entity context', () => {
    expect(() => normalizeSchema({
      meta: { name: 'Test' },
      entities: {
        Order: {
          fields: { status: { type: 'enum', values: ['draft'] } },
          stateMachine: { field: '', initial: 'draft', states: { draft: 'Draft' }, transitions: [] },
        },
      },
    })).toThrow('entities.Order.stateMachine: missing required "field" property')
  })

  it('reports endpoint format errors with api context', () => {
    expect(() => normalizeSchema({
      meta: { name: 'Test' },
      apis: { OrderAPI: { endpoints: { '/orders': { returns: 'Order' } } } },
    })).toThrow('apis.OrderAPI.endpoints["/orders"]: endpoint key must be "METHOD /path"')
  })

  it('produces a valid schema from minimal input', () => {
    const schema = normalizeSchema({ meta: { name: 'Test' } })
    expect(schema.version).toBe('2.0.0')
    expect(schema.meta.name).toBe('Test')
    expect(schema.entities).toEqual({})
    expect(schema.apis).toEqual({})
  })

  it('defaults entity role to "entity" when omitted', () => {
    const schema = normalizeSchema({
      meta: { name: 'Test' },
      entities: { Book: { fields: { id: { type: 'uuid', primaryKey: true } } } },
    })
    expect(schema.entities['Book'].role).toBe('entity')
  })

  it('preserves an explicit role on an entity', () => {
    const schema = normalizeSchema({
      meta: { name: 'Test' },
      entities: { Wolf: { role: 'creature', fields: { id: { type: 'uuid', primaryKey: true } } } },
    })
    expect(schema.entities['Wolf'].role).toBe('creature')
  })

  it('normalises field defaults', () => {
    const schema = normalizeSchema({
      meta: { name: 'Test' },
      entities: {
        Book: {
          fields: {
            id: { type: 'uuid', primaryKey: true },
            title: { type: 'string' },
          },
        },
      },
    })
    const { id, title } = schema.entities['Book'].fields
    expect(id.primaryKey).toBe(true)
    expect(id.nullable).toBe(false)
    expect(id.pii).toBe(false)
    expect(title.primaryKey).toBe(false)
    expect(title.nullable).toBe(false)
  })

  it('normalises enum values alias', () => {
    const schema = normalizeSchema({
      meta: { name: 'Test' },
      entities: {
        Book: {
          fields: {
            status: { type: 'enum', values: ['available', 'borrowed'] },
          },
        },
      },
    })
    expect(schema.entities['Book'].fields['status'].enumValues).toEqual(['available', 'borrowed'])
  })

  it('normalises flat GDPR keys', () => {
    const schema = normalizeSchema({
      meta: { name: 'Test' },
      entities: {
        Member: {
          fields: {
            email: { type: 'email', pii: true, gdprCategory: 'contact', gdprRetention: '7y', gdprLegalBasis: 'contract' },
          },
        },
      },
    })
    const email = schema.entities['Member'].fields['email']
    expect(email.pii).toBe(true)
    expect(email.gdprCategory).toBe('contact')
    expect(email.gdprRetention).toBe('7y')
    expect(email.gdprLegalBasis).toBe('contract')
  })

  it('normalises nested GDPR object', () => {
    const schema = normalizeSchema({
      meta: { name: 'Test' },
      entities: {
        Member: {
          fields: {
            email: { type: 'email', pii: true, gdpr: { category: 'contact', retention: '7y', legalBasis: 'consent' } },
          },
        },
      },
    })
    const email = schema.entities['Member'].fields['email']
    expect(email.gdprCategory).toBe('contact')
    expect(email.gdprRetention).toBe('7y')
    expect(email.gdprLegalBasis).toBe('consent')
  })

  it('derives entity pii and gdpr index from fields', () => {
    const schema = normalizeSchema({
      meta: { name: 'Test' },
      entities: {
        Member: {
          fields: {
            id:    { type: 'uuid' },
            email: { type: 'email', pii: true, gdprCategory: 'contact' },
            name:  { type: 'string', pii: true, gdprCategory: 'identity' },
          },
        },
      },
    })
    const entity = schema.entities['Member']
    expect(entity.pii).toContain('email')
    expect(entity.pii).toContain('name')
    expect(entity.pii).not.toContain('id')
    expect(entity.gdpr['email']).toBe('contact')
    expect(entity.gdpr['name']).toBe('identity')
  })

  it('normalises singular guard/effect on transitions', () => {
    const schema = normalizeSchema({
      meta: { name: 'Test' },
      entities: {
        Book: {
          fields: { status: { type: 'enum', values: ['available', 'borrowed'] } },
          stateMachine: {
            field: 'status',
            initial: 'available',
            states: {
              available: { description: 'On shelf' },
              borrowed: { description: 'With member' },
            },
            transitions: [
              { from: 'available', to: 'borrowed', trigger: 'borrow', guard: 'Member must be active', effect: 'Sends confirmation' },
            ],
          },
        },
      },
    })
    const t = schema.entities['Book'].stateMachine!.transitions[0]
    expect(t.guards).toEqual(['Member must be active'])
    expect(t.effects).toEqual(['Sends confirmation'])
  })

  it('normalises array guards/effects on transitions', () => {
    const schema = normalizeSchema({
      meta: { name: 'Test' },
      entities: {
        Book: {
          fields: { status: { type: 'enum', values: ['available', 'borrowed'] } },
          stateMachine: {
            field: 'status',
            initial: 'available',
            states: { available: 'On shelf', borrowed: 'With member' },
            transitions: [
              { from: ['available'], to: 'borrowed', trigger: 'borrow', guards: ['Rule A', 'Rule B'], effects: ['Effect 1'] },
            ],
          },
        },
      },
    })
    const t = schema.entities['Book'].stateMachine!.transitions[0]
    expect(t.guards).toEqual(['Rule A', 'Rule B'])
    expect(t.effects).toEqual(['Effect 1'])
  })

  it('accepts string shorthand for state descriptions', () => {
    const schema = normalizeSchema({
      meta: { name: 'Test' },
      entities: {
        Book: {
          fields: { status: { type: 'enum', values: ['available'] } },
          stateMachine: {
            field: 'status',
            initial: 'available',
            states: { available: 'On shelf' },
            transitions: [],
          },
        },
      },
    })
    expect(schema.entities['Book'].stateMachine!.states['available'].description).toBe('On shelf')
    expect(schema.entities['Book'].stateMachine!.states['available'].terminal).toBe(false)
  })

  it('auto-derives guards from behavior rules when no explicit guard is set', () => {
    const schema = normalizeSchema({
      meta: { name: 'Test' },
      entities: {
        Order: {
          fields: { status: { type: 'enum', values: ['draft', 'placed'] } },
          behaviors: {
            placeOrder: { description: 'Place the order', rules: ['Must have items', 'Customer must be active'] },
          },
          stateMachine: {
            field: 'status',
            initial: 'draft',
            states: { draft: 'Draft', placed: 'Placed' },
            transitions: [
              { from: 'draft', to: 'placed', trigger: 'placeOrder' },
            ],
          },
        },
      },
    })
    const t = schema.entities['Order'].stateMachine!.transitions[0]
    expect(t.guards).toEqual(['Must have items', 'Customer must be active'])
  })

  it('keeps explicit guards when set on a transition (no auto-derivation)', () => {
    const schema = normalizeSchema({
      meta: { name: 'Test' },
      entities: {
        Order: {
          fields: { status: { type: 'enum', values: ['draft', 'placed'] } },
          behaviors: {
            placeOrder: { description: 'Place the order', rules: ['Must have items'] },
          },
          stateMachine: {
            field: 'status',
            initial: 'draft',
            states: { draft: 'Draft', placed: 'Placed' },
            transitions: [
              { from: 'draft', to: 'placed', trigger: 'placeOrder', guard: 'Explicit guard' },
            ],
          },
        },
      },
    })
    const t = schema.entities['Order'].stateMachine!.transitions[0]
    expect(t.guards).toEqual(['Explicit guard'])
  })

  it('leaves guards empty when behavior has no rules and no explicit guard', () => {
    const schema = normalizeSchema({
      meta: { name: 'Test' },
      entities: {
        Book: {
          fields: { status: { type: 'enum', values: ['available', 'borrowed'] } },
          behaviors: {
            borrow: { description: 'Borrow a book', rules: [] },
          },
          stateMachine: {
            field: 'status',
            initial: 'available',
            states: { available: 'On shelf', borrowed: 'With member' },
            transitions: [
              { from: 'available', to: 'borrowed', trigger: 'borrow' },
            ],
          },
        },
      },
    })
    const t = schema.entities['Book'].stateMachine!.transitions[0]
    expect(t.guards).toEqual([])
  })

  it('normalises API endpoints', () => {
    const schema = normalizeSchema({
      meta: { name: 'Test' },
      apis: {
        LibraryAPI: {
          endpoints: {
            'POST /loans': { behavior: 'Loan.borrow', description: 'Borrow a book' },
            'GET /books':  { returns: 'Book', auth: { roles: ['member', 'admin'] } },
          },
        },
      },
    })
    const api = schema.apis['LibraryAPI']
    expect(api.endpoints['POST /loans'].method).toBe('POST')
    expect(api.endpoints['POST /loans'].path).toBe('/loans')
    expect(api.endpoints['GET /books'].returns).toBe('Book')
    expect(api.endpoints['GET /books'].auth?.roles).toContain('member')
  })
})

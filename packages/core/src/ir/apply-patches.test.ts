import { applyPatches, collectSuppressPatterns, isSuppressed } from './apply-patches'
import type { FabricSchema } from './types'
import type { Patch } from './patch'

const baseSchema: FabricSchema = {
  version: '2.0.0',
  meta: { name: 'TestApp', version: '1.0.0' },
  entities: {
    Book: {
      name: 'Book',
      role: 'entity',
      description: 'A book',
      fields: {
        id: { name: 'id', type: 'uuid', nullable: false, primaryKey: true, pii: false },
        title: { name: 'title', type: 'string', nullable: false, primaryKey: false, pii: false },
        status: { name: 'status', type: 'enum', enumValues: ['available', 'borrowed'], nullable: false, primaryKey: false, pii: false },
      },
      relations: {},
      behaviors: {
        borrow: { name: 'borrow', description: 'Borrow a book', rules: ['Member must be active'] },
      },
      stateMachine: {
        field: 'status',
        initial: 'available',
        states: {
          available: { name: 'available', description: 'On the shelf', terminal: false },
          borrowed: { name: 'borrowed', description: 'With a member', terminal: false },
        },
        transitions: [
          { from: 'available', to: 'borrowed', trigger: 'borrow', guards: [], effects: [] },
        ],
      },
      pii: [],
      gdpr: {},
    },
  },
  apis: {
    LibraryAPI: {
      name: 'LibraryAPI',
      endpoints: {
        'GET /books': { method: 'GET', path: '/books', description: 'List books' },
      },
    },
  },
}

describe('applyPatches', () => {
  it('returns the same schema reference when there are no merge patches', () => {
    const patches: Patch[] = [{ op: 'suppress', pattern: 'typescript/index.ts' }]
    const result = applyPatches(baseSchema, patches)
    expect(result).toBe(baseSchema)
  })

  it('does not mutate the original schema', () => {
    const patches: Patch[] = [{ op: 'merge', target: 'meta', value: { description: 'Patched' } }]
    applyPatches(baseSchema, patches)
    expect(baseSchema.meta.description).toBeUndefined()
  })

  it('merges into meta', () => {
    const patches: Patch[] = [{ op: 'merge', target: 'meta', value: { description: 'A test app', namespace: 'test' } }]
    const result = applyPatches(baseSchema, patches)
    expect(result.meta.description).toBe('A test app')
    expect(result.meta.namespace).toBe('test')
    expect(result.meta.name).toBe('TestApp')
  })

  it('merges into an entity top-level', () => {
    const patches: Patch[] = [{ op: 'merge', target: 'entity.Book', value: { goal: 'Track books' } }]
    const result = applyPatches(baseSchema, patches)
    expect(result.entities.Book.goal).toBe('Track books')
    expect(result.entities.Book.description).toBe('A book')
  })

  it('merges into an entity field', () => {
    const patches: Patch[] = [{ op: 'merge', target: 'entity.Book.fields.title', value: { description: 'The full title of the book' } }]
    const result = applyPatches(baseSchema, patches)
    expect(result.entities.Book.fields.title.description).toBe('The full title of the book')
    expect(result.entities.Book.fields.id.description).toBeUndefined()
  })

  it('merges into a behavior', () => {
    const patches: Patch[] = [{ op: 'merge', target: 'entity.Book.behaviors.borrow', value: { description: 'Lend a book to a member' } }]
    const result = applyPatches(baseSchema, patches)
    expect(result.entities.Book.behaviors.borrow.description).toBe('Lend a book to a member')
  })

  it('merges into a state machine state', () => {
    const patches: Patch[] = [{ op: 'merge', target: 'entity.Book.stateMachine.states.available', value: { description: 'Available for borrowing' } }]
    const result = applyPatches(baseSchema, patches)
    expect(result.entities.Book.stateMachine!.states.available.description).toBe('Available for borrowing')
  })

  it('merges into an api', () => {
    const patches: Patch[] = [{ op: 'merge', target: 'api.LibraryAPI', value: { baseUrl: 'https://api.example.com' } }]
    const result = applyPatches(baseSchema, patches)
    expect(result.apis.LibraryAPI.baseUrl).toBe('https://api.example.com')
  })

  it('merges into an endpoint', () => {
    const patches: Patch[] = [{ op: 'merge', target: 'api.LibraryAPI.endpoints.GET /books', value: { description: 'Returns all books in the library' } }]
    const result = applyPatches(baseSchema, patches)
    expect(result.apis.LibraryAPI.endpoints['GET /books'].description).toBe('Returns all books in the library')
  })

  it('applies multiple patches in order', () => {
    const patches: Patch[] = [
      { op: 'merge', target: 'meta', value: { description: 'First' } },
      { op: 'merge', target: 'meta', value: { description: 'Second' } },
    ]
    const result = applyPatches(baseSchema, patches)
    expect(result.meta.description).toBe('Second')
  })

  it('throws on unknown entity', () => {
    const patches: Patch[] = [{ op: 'merge', target: 'entity.Unknown.fields.id', value: {} }]
    expect(() => applyPatches(baseSchema, patches)).toThrow('entity "Unknown" not found')
  })

  it('throws on unknown field', () => {
    const patches: Patch[] = [{ op: 'merge', target: 'entity.Book.fields.nonexistent', value: {} }]
    expect(() => applyPatches(baseSchema, patches)).toThrow('field "nonexistent" not found')
  })

  it('throws on unknown behavior', () => {
    const patches: Patch[] = [{ op: 'merge', target: 'entity.Book.behaviors.missing', value: {} }]
    expect(() => applyPatches(baseSchema, patches)).toThrow('behavior "missing" not found')
  })

  it('throws on unknown state', () => {
    const patches: Patch[] = [{ op: 'merge', target: 'entity.Book.stateMachine.states.missing', value: {} }]
    expect(() => applyPatches(baseSchema, patches)).toThrow('state "missing" not found')
  })

  it('throws on unsupported root', () => {
    const patches: Patch[] = [{ op: 'merge', target: 'events.MyEvent', value: {} }]
    expect(() => applyPatches(baseSchema, patches)).toThrow('is not supported')
  })
})

describe('collectSuppressPatterns', () => {
  it('returns only suppress patterns', () => {
    const patches: Patch[] = [
      { op: 'merge', target: 'meta', value: {} },
      { op: 'suppress', pattern: 'typescript/index.ts' },
      { op: 'suppress', pattern: 'sql/*.sql' },
    ]
    expect(collectSuppressPatterns(patches)).toEqual(['typescript/index.ts', 'sql/*.sql'])
  })

  it('returns empty array when no suppress patches', () => {
    const patches: Patch[] = [{ op: 'merge', target: 'meta', value: {} }]
    expect(collectSuppressPatterns(patches)).toEqual([])
  })
})

describe('isSuppressed', () => {
  it('matches exact path', () => {
    expect(isSuppressed('typescript/index.ts', ['typescript/index.ts'])).toBe(true)
  })

  it('matches wildcard pattern', () => {
    expect(isSuppressed('sql/000001_init.sql', ['sql/*.sql'])).toBe(true)
    expect(isSuppressed('sql/000002_add_col.sql', ['sql/*.sql'])).toBe(true)
  })

  it('does not match across path separators', () => {
    expect(isSuppressed('sql/sub/000001_init.sql', ['sql/*.sql'])).toBe(false)
  })

  it('returns false when no patterns match', () => {
    expect(isSuppressed('docs/Book.md', ['typescript/index.ts'])).toBe(false)
  })

  it('returns false for empty pattern list', () => {
    expect(isSuppressed('typescript/index.ts', [])).toBe(false)
  })
})

import { UiGenerator } from './index'
import type { FabricSchema, GeneratorContext, GeneratorOutput } from '@newel/core'

const makeCtx = (): GeneratorContext => ({
  outputDir: '/tmp/test-ui',
  outputs: new Map<string, GeneratorOutput>(),
})

const richSchema: FabricSchema = {
  version: '2.0.0',
  meta: { name: 'LibraryApp', version: '1.0.0' },
  entities: {
    Book: {
      name: 'Book',
      role: 'entity',
      description: 'A book in the catalogue',
      fields: {
        id:     { name: 'id',     type: 'uuid',   nullable: false, primaryKey: true,  pii: false },
        title:  { name: 'title',  type: 'string', nullable: false, primaryKey: false, pii: false, description: 'Book title' },
        status: { name: 'status', type: 'enum',   nullable: false, primaryKey: false, pii: false, enumValues: ['available', 'borrowed'] },
        notes:  { name: 'notes',  type: 'string', nullable: true,  primaryKey: false, pii: false },
      },
      relations: {},
      behaviors: {
        borrow: {
          name: 'borrow',
          description: 'Borrow a book',
          rules: ['Member must be active'],
          auth: { roles: ['member', 'librarian'] },
        },
        returnBook: {
          name: 'returnBook',
          description: 'Return a book',
          rules: [],
          auth: { roles: ['member', 'librarian'] },
        },
      },
      stateMachine: {
        field: 'status',
        initial: 'available',
        states: {
          available: { name: 'available', description: 'On the shelf',  terminal: false },
          borrowed:  { name: 'borrowed',  description: 'With a member', terminal: false },
        },
        transitions: [
          { from: 'available', to: 'borrowed',  trigger: 'borrow',     guards: ['Member must be active'], effects: [] },
          { from: 'borrowed',  to: 'available', trigger: 'returnBook', guards: [],                        effects: [] },
        ],
      },
      pii: [],
      gdpr: {},
    },
    Member: {
      name: 'Member',
      role: 'entity',
      description: 'A library member',
      fields: {
        id:   { name: 'id',   type: 'uuid',   nullable: false, primaryKey: true,  pii: false },
        name: { name: 'name', type: 'string', nullable: false, primaryKey: false, pii: true },
      },
      relations: {},
      behaviors: {},
      stateMachine: undefined,
      pii: ['name'],
      gdpr: {},
    },
  },
  apis: {},
}

const minimalSchema: FabricSchema = {
  version: '2.0.0',
  meta: { name: 'EmptyApp', version: '1.0.0' },
  entities: {},
  apis: {},
}

describe('UiGenerator', () => {
  it('declares dependsOn typescript', () => {
    const gen = new UiGenerator()
    expect(gen.dependsOn).toContain('typescript')
  })

  it('generates one .tsx file per entity plus an index', async () => {
    const gen = new UiGenerator()
    const result = await gen.generate(richSchema, makeCtx())
    const paths = result.files.map(f => f.path)
    expect(paths).toContain('ui/Book.tsx')
    expect(paths).toContain('ui/Member.tsx')
    expect(paths).toContain('ui/index.ts')
  })

  it('generates only an index file when there are no entities', async () => {
    const gen = new UiGenerator()
    const result = await gen.generate(minimalSchema, makeCtx())
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe('ui/index.ts')
  })

  it('exposes artifacts with entity names', async () => {
    const gen = new UiGenerator()
    const result = await gen.generate(richSchema, makeCtx())
    expect(result.artifacts?.['entities']).toEqual(expect.arrayContaining(['Book', 'Member']))
  })

  describe('entity form', () => {
    it('generates a form component named <Entity>Form', async () => {
      const gen = new UiGenerator()
      const result = await gen.generate(richSchema, makeCtx())
      const bookFile = result.files.find(f => f.path === 'ui/Book.tsx')!
      expect(bookFile.content).toContain('export function BookForm(')
    })

    it('generates a FormValues interface with editable fields', async () => {
      const gen = new UiGenerator()
      const result = await gen.generate(richSchema, makeCtx())
      const bookFile = result.files.find(f => f.path === 'ui/Book.tsx')!
      expect(bookFile.content).toContain('export interface BookFormValues {')
      expect(bookFile.content).toContain('title:')
      expect(bookFile.content).toContain('status:')
    })

    it('excludes primary key fields from the form', async () => {
      const gen = new UiGenerator()
      const result = await gen.generate(richSchema, makeCtx())
      const bookFile = result.files.find(f => f.path === 'ui/Book.tsx')!
      // id is the primary key — should not appear in FormValues
      expect(bookFile.content).not.toMatch(/^\s+id[?]?:.*$/m)
    })

    it('renders enum fields as <select>', async () => {
      const gen = new UiGenerator()
      const result = await gen.generate(richSchema, makeCtx())
      const bookFile = result.files.find(f => f.path === 'ui/Book.tsx')!
      expect(bookFile.content).toContain('<select')
      expect(bookFile.content).toContain('<option value="available">')
      expect(bookFile.content).toContain('<option value="borrowed">')
    })

    it('marks non-nullable fields as required', async () => {
      const gen = new UiGenerator()
      const result = await gen.generate(richSchema, makeCtx())
      const bookFile = result.files.find(f => f.path === 'ui/Book.tsx')!
      // title is non-nullable → required={true}
      expect(bookFile.content).toContain('required={true}')
    })

    it('wraps the form in #region / #endregion markers', async () => {
      const gen = new UiGenerator()
      const result = await gen.generate(richSchema, makeCtx())
      const bookFile = result.files.find(f => f.path === 'ui/Book.tsx')!
      expect(bookFile.content).toContain('// #region BookForm')
      expect(bookFile.content).toContain('// #endregion BookForm')
    })
  })

  describe('action panel', () => {
    it('generates an ActionPanel component for entities with a state machine', async () => {
      const gen = new UiGenerator()
      const result = await gen.generate(richSchema, makeCtx())
      const bookFile = result.files.find(f => f.path === 'ui/Book.tsx')!
      expect(bookFile.content).toContain('export function BookActionPanel(')
    })

    it('skips the action panel for entities without a state machine', async () => {
      const gen = new UiGenerator()
      const result = await gen.generate(richSchema, makeCtx())
      const memberFile = result.files.find(f => f.path === 'ui/Member.tsx')!
      expect(memberFile.content).not.toContain('export function MemberActionPanel(')
      expect(memberFile.content).toContain('has no state machine')
    })

    it('renders one button per unique trigger', async () => {
      const gen = new UiGenerator()
      const result = await gen.generate(richSchema, makeCtx())
      const bookFile = result.files.find(f => f.path === 'ui/Book.tsx')!
      expect(bookFile.content).toContain("onAction('borrow')")
      expect(bookFile.content).toContain("onAction('returnBook')")
    })

    it('gates each button on the valid from-states', async () => {
      const gen = new UiGenerator()
      const result = await gen.generate(richSchema, makeCtx())
      const bookFile = result.files.find(f => f.path === 'ui/Book.tsx')!
      // borrow is only valid from 'available'
      expect(bookFile.content).toContain('"available"')
      // returnBook is only valid from 'borrowed'
      expect(bookFile.content).toContain('"borrowed"')
    })

    it('gates buttons on behavior auth roles', async () => {
      const gen = new UiGenerator()
      const result = await gen.generate(richSchema, makeCtx())
      const bookFile = result.files.find(f => f.path === 'ui/Book.tsx')!
      expect(bookFile.content).toContain('"member"')
      expect(bookFile.content).toContain('"librarian"')
      expect(bookFile.content).toContain('userRoles')
    })

    it('adds a title attribute with guard text when guards exist', async () => {
      const gen = new UiGenerator()
      const result = await gen.generate(richSchema, makeCtx())
      const bookFile = result.files.find(f => f.path === 'ui/Book.tsx')!
      // borrow transition has guard 'Member must be active'
      expect(bookFile.content).toContain('title="Member must be active"')
    })

    it('exports a BookState type union', async () => {
      const gen = new UiGenerator()
      const result = await gen.generate(richSchema, makeCtx())
      const bookFile = result.files.find(f => f.path === 'ui/Book.tsx')!
      expect(bookFile.content).toContain('export type BookState =')
      expect(bookFile.content).toContain('"available"')
      expect(bookFile.content).toContain('"borrowed"')
    })

    it('wraps the action panel in #region / #endregion markers', async () => {
      const gen = new UiGenerator()
      const result = await gen.generate(richSchema, makeCtx())
      const bookFile = result.files.find(f => f.path === 'ui/Book.tsx')!
      expect(bookFile.content).toContain('// #region BookActionPanel')
      expect(bookFile.content).toContain('// #endregion BookActionPanel')
    })
  })

  describe('index file', () => {
    it('re-exports form and panel from each entity file', async () => {
      const gen = new UiGenerator()
      const result = await gen.generate(richSchema, makeCtx())
      const indexFile = result.files.find(f => f.path === 'ui/index.ts')!
      expect(indexFile.content).toContain("from './Book'")
      expect(indexFile.content).toContain("from './Member'")
      expect(indexFile.content).toContain('BookForm')
      expect(indexFile.content).toContain('MemberForm')
      expect(indexFile.content).toContain('BookActionPanel')
      expect(indexFile.content).toContain('MemberActionPanel')
    })
  })
})

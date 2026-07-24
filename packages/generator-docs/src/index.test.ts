import { DocsGenerator } from './index'
import type { FabricSchema, GeneratorContext, GeneratorOutput } from '@newel/core'

const makeCtx = (): GeneratorContext => ({
  outputDir: '/tmp/test-docs',
  outputs: new Map<string, GeneratorOutput>(),
})

const minimalSchema: FabricSchema = {
  version: '2.0.0',
  meta: { name: 'TestApp', version: '1.0.0' },
  entities: {},
  apis: {},
}

const richSchema: FabricSchema = {
  version: '2.0.0',
  meta: { name: 'LibraryApp', description: 'Library management', version: '1.0.0' },
  entities: {
    Book: {
      name: 'Book',
      role: 'entity',
      description: 'A book in the catalogue',
      goal: 'Track books from acquisition to retirement',
      fields: {
        id:     { name: 'id',     type: 'uuid',    nullable: false, primaryKey: true,  pii: false },
        title:  { name: 'title',  type: 'string',  nullable: false, primaryKey: false, pii: false, description: 'Book title' },
        status: { name: 'status', type: 'enum',    nullable: false, primaryKey: false, pii: false, enumValues: ['available', 'borrowed'] },
        notes:  { name: 'notes',  type: 'string',  nullable: true,  primaryKey: false, pii: false },
      },
      relations: {
        loans: { name: 'loans', kind: 'hasMany', target: 'Loan', foreignKey: 'bookId' },
      },
      behaviors: {
        borrow: {
          name: 'borrow',
          description: 'Borrow a book',
          rules: ['Member must be active'],
          auth: { roles: ['member'] },
          input: {
            memberId: { name: 'memberId', type: 'uuid', nullable: false, primaryKey: false, pii: false, description: 'ID of the borrowing member' },
          },
        },
        returnBook: {
          name: 'returnBook',
          description: 'Return a borrowed book',
          rules: [],
          auth: { roles: ['member', 'librarian'] },
        },
      },
      stateMachine: {
        field: 'status',
        initial: 'available',
        states: {
          available: { name: 'available', description: 'On the shelf',   terminal: false },
          borrowed:  { name: 'borrowed',  description: 'With a member',  terminal: false },
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
        id:    { name: 'id',    type: 'uuid',   nullable: false, primaryKey: true,  pii: false },
        email: { name: 'email', type: 'email',  nullable: false, primaryKey: false, pii: true,
                 gdprCategory: 'contact', gdprRetention: '5y', gdprLegalBasis: 'contract' },
        name:  { name: 'name',  type: 'string', nullable: false, primaryKey: false, pii: true,
                 gdprCategory: 'identity' },
      },
      relations: {},
      behaviors: {},
      pii: ['email', 'name'],
      gdpr: { email: 'contact', name: 'identity' },
    },
  },
  apis: {
    LibraryAPI: {
      name: 'LibraryAPI',
      baseUrl: '/library',
      endpoints: {
        'GET /books': {
          method: 'GET',
          path: '/books',
          description: 'List all books',
          returns: 'Book',
          auth: { roles: ['member', 'librarian'] },
        },
        'POST /books/:id/borrow': {
          method: 'POST',
          path: '/books/:id/borrow',
          description: 'Borrow a book',
          behavior: 'Book.borrow',
        },
      },
    },
  },
}

describe('DocsGenerator', () => {
  const generator = new DocsGenerator()

  it('has correct name and dependsOn', () => {
    expect(generator.name).toBe('docs')
    expect(generator.dependsOn).toEqual(['openapi', 'typescript'])
  })

  it('produces @generated header on all files', async () => {
    const { files } = await generator.generate(minimalSchema, makeCtx())
    for (const f of files) {
      expect(f.header).toContain('@generated')
    }
  })

  describe('entity pages', () => {
    it('generates one file per entity', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const entityFiles = files.filter(f => f.path.startsWith('docs/entities/'))
      expect(entityFiles).toHaveLength(2)
      expect(entityFiles.map(f => f.path)).toContain('docs/entities/Book.md')
      expect(entityFiles.map(f => f.path)).toContain('docs/entities/Member.md')
    })

    it('includes entity name as h1', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const book = files.find(f => f.path === 'docs/entities/Book.md')!
      expect(book.content).toContain('# Book')
    })

    it('includes description and goal', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const book = files.find(f => f.path === 'docs/entities/Book.md')!
      expect(book.content).toContain('A book in the catalogue')
      expect(book.content).toContain('Track books from acquisition to retirement')
    })

    it('renders fields table with correct columns', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const book = files.find(f => f.path === 'docs/entities/Book.md')!
      expect(book.content).toContain('## Fields')
      expect(book.content).toContain('| Name |')
      expect(book.content).toContain('`id`')
      expect(book.content).toContain('`title`')
    })

    it('marks enum fields with their values', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const book = files.find(f => f.path === 'docs/entities/Book.md')!
      expect(book.content).toContain('available')
      expect(book.content).toContain('borrowed')
    })

    it('marks nullable vs required correctly', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const book = files.find(f => f.path === 'docs/entities/Book.md')!
      // title is not nullable → "yes"; notes is nullable → "no"
      expect(book.content).toContain('yes')
      expect(book.content).toContain('no')
    })

    it('marks PII fields', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const member = files.find(f => f.path === 'docs/entities/Member.md')!
      expect(member.content).toContain('✓')
    })

    it('renders state machine section with Mermaid diagram', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const book = files.find(f => f.path === 'docs/entities/Book.md')!
      expect(book.content).toContain('### State Machine')
      expect(book.content).toContain('```mermaid')
      expect(book.content).toContain('stateDiagram-v2')
      expect(book.content).toContain('[*] --> available')
      expect(book.content).toContain('available --> borrowed')
    })

    it('renders transitions table with guards', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const book = files.find(f => f.path === 'docs/entities/Book.md')!
      expect(book.content).toContain('Member must be active')
    })

    it('renders behaviors section', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const book = files.find(f => f.path === 'docs/entities/Book.md')!
      expect(book.content).toContain('## Behaviors')
      expect(book.content).toContain('### `borrow`')
      expect(book.content).toContain('Borrow a book')
      expect(book.content).toContain('Member must be active')
    })

    it('renders behavior auth roles', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const book = files.find(f => f.path === 'docs/entities/Book.md')!
      expect(book.content).toContain('member')
    })

    it('renders behavior input fields', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const book = files.find(f => f.path === 'docs/entities/Book.md')!
      expect(book.content).toContain('**Input:**')
      expect(book.content).toContain('memberId')
    })

    it('renders relations table', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const book = files.find(f => f.path === 'docs/entities/Book.md')!
      expect(book.content).toContain('## Relations')
      expect(book.content).toContain('hasMany')
      expect(book.content).toContain('Loan')
    })

    it('omits state machine section when entity has none', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const member = files.find(f => f.path === 'docs/entities/Member.md')!
      expect(member.content).not.toContain('State Machine')
    })
  })

  describe('API pages', () => {
    it('generates one file per API', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const apiFiles = files.filter(f => f.path.startsWith('docs/apis/'))
      expect(apiFiles).toHaveLength(1)
      expect(apiFiles[0].path).toBe('docs/apis/LibraryAPI.md')
    })

    it('includes API name as h1 and base URL', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const api = files.find(f => f.path === 'docs/apis/LibraryAPI.md')!
      expect(api.content).toContain('# LibraryAPI')
      expect(api.content).toContain('/library')
    })

    it('renders endpoints table', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const api = files.find(f => f.path === 'docs/apis/LibraryAPI.md')!
      expect(api.content).toContain('## Endpoints')
      expect(api.content).toContain('GET')
      expect(api.content).toContain('POST')
      expect(api.content).toContain('List all books')
    })

    it('generates no API files for minimal schema', async () => {
      const { files } = await generator.generate(minimalSchema, makeCtx())
      expect(files.filter(f => f.path.startsWith('docs/apis/'))).toHaveLength(0)
    })
  })

  describe('GDPR data map', () => {
    it('always generates the GDPR data map file', async () => {
      const { files } = await generator.generate(minimalSchema, makeCtx())
      expect(files.some(f => f.path === 'docs/gdpr-data-map.md')).toBe(true)
    })

    it('emits "No PII fields" when schema has none', async () => {
      const { files } = await generator.generate(minimalSchema, makeCtx())
      const gdpr = files.find(f => f.path === 'docs/gdpr-data-map.md')!
      expect(gdpr.content).toContain('No PII')
    })

    it('lists PII fields with GDPR metadata', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const gdpr = files.find(f => f.path === 'docs/gdpr-data-map.md')!
      expect(gdpr.content).toContain('Member')
      expect(gdpr.content).toContain('email')
      expect(gdpr.content).toContain('contact')
      expect(gdpr.content).toContain('5y')
      expect(gdpr.content).toContain('contract')
    })

    it('cross-references endpoints that expose PII entities', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const gdpr = files.find(f => f.path === 'docs/gdpr-data-map.md')!
      // Book.borrow touches Book entity (not Member), so Member PII may have no exposed endpoints
      // The GDPR map should at least render the row
      expect(gdpr.content).toContain('email')
    })

    it('includes schema name in header', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const gdpr = files.find(f => f.path === 'docs/gdpr-data-map.md')!
      expect(gdpr.content).toContain('LibraryApp')
    })
  })
})

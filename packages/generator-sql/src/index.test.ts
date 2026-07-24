import { SqlGenerator } from './index'
import type { FabricSchema, GeneratorContext, GeneratorOutput, IRSnapshot } from '@newel/core'

const makeCtx = (prev?: IRSnapshot): GeneratorContext => ({
  outputDir: '/tmp/test-sql',
  outputs: new Map<string, GeneratorOutput>(),
  previousSnapshot: prev,
})

const minimalSchema: FabricSchema = {
  version: '2.0.0',
  meta: { name: 'TestApp', version: '1.0.0' },
  entities: {},
  apis: {},
}

const bookSchema: FabricSchema = {
  version: '2.0.0',
  meta: { name: 'LibraryApp', version: '1.0.0' },
  entities: {
    Book: {
      name: 'Book',
      role: 'entity',
      description: 'A book',
      fields: {
        id:     { name: 'id',     type: 'uuid',    nullable: false, primaryKey: true,  pii: false },
        title:  { name: 'title',  type: 'string',  nullable: false, primaryKey: false, pii: false },
        status: { name: 'status', type: 'enum',    nullable: false, primaryKey: false, pii: false, enumValues: ['available', 'borrowed'] },
        notes:  { name: 'notes',  type: 'string',  nullable: true,  primaryKey: false, pii: false },
        borrowerId: { name: 'borrowerId', type: 'uuid', nullable: true, primaryKey: false, pii: false, foreignKey: 'Member.id' },
      },
      relations: {},
      behaviors: {},
      stateMachine: {
        field: 'status',
        initial: 'available',
        states: {
          available: { name: 'available', description: 'On the shelf', terminal: false },
          borrowed:  { name: 'borrowed',  description: 'Checked out',  terminal: false },
          lost:      { name: 'lost',      description: 'Permanently lost', terminal: true },
        },
        transitions: [
          { from: 'available', to: 'borrowed', trigger: 'borrow',  guards: [], effects: [] },
          { from: 'borrowed',  to: 'available', trigger: 'return', guards: [], effects: [] },
          { from: 'borrowed',  to: 'lost',      trigger: 'markLost', guards: [], effects: [] },
        ],
      },
      pii: [],
      gdpr: {},
    },
  },
  apis: {},
}

const makeSnapshot = (schema: FabricSchema): IRSnapshot => ({
  generatedAt: '2026-01-01T00:00:00Z',
  schemaHash: 'abc123',
  schema,
})

describe('SqlGenerator', () => {
  const generator = new SqlGenerator()

  it('has correct name', () => {
    expect(generator.name).toBe('sql')
  })

  it('declares dependsOn typescript', () => {
    expect(generator.dependsOn).toEqual(['typescript'])
  })

  describe('initial generation (no previous snapshot)', () => {
    it('produces schema.sql and one init migration', async () => {
      const result = await generator.generate(bookSchema, makeCtx())
      const paths = result.files.map(f => f.path)
      expect(paths).toContain('sql/schema.sql')
      expect(paths.some(p => p.startsWith('sql/migrations/'))).toBe(true)
      expect(paths.length).toBe(2)
    })

    it('migration is numbered 000001', async () => {
      const result = await generator.generate(bookSchema, makeCtx())
      const migPath = result.files.find(f => f.path.startsWith('sql/migrations/'))?.path ?? ''
      expect(migPath).toMatch(/000001__/)
    })

    it('includes @generated header on all files', async () => {
      const result = await generator.generate(bookSchema, makeCtx())
      for (const file of result.files) {
        expect(file.header).toContain('@generated')
      }
    })
  })

  describe('schema.sql DDL', () => {
    let content: string

    beforeAll(async () => {
      const result = await generator.generate(bookSchema, makeCtx())
      content = result.files.find(f => f.path === 'sql/schema.sql')!.content
    })

    it('creates table for each entity', () => {
      expect(content).toContain('CREATE TABLE IF NOT EXISTS books')
    })

    it('maps uuid field to UUID type with PRIMARY KEY', () => {
      expect(content).toContain('id UUID PRIMARY KEY')
    })

    it('maps string field to TEXT NOT NULL', () => {
      expect(content).toContain('title TEXT NOT NULL')
    })

    it('maps nullable string to TEXT without NOT NULL', () => {
      expect(content).toContain('notes TEXT')
      expect(content).not.toMatch(/notes TEXT NOT NULL/)
    })

    it('maps enum field to a named enum type', () => {
      expect(content).toContain('CREATE TYPE book_status_enum AS ENUM')
      expect(content).toContain("'available'")
      expect(content).toContain("'borrowed'")
      expect(content).toContain('status book_status_enum')
    })

    it('renders FK constraint for foreignKey fields', () => {
      expect(content).toContain('CONSTRAINT fk_book_borrower_id')
      expect(content).toContain('REFERENCES members (id)')
    })

    it('renders terminal state CHECK constraint', () => {
      expect(content).toContain('chk_books_terminal_status')
      expect(content).toContain("CHECK (status NOT IN ('lost')")
    })

    it('does not emit CHECK constraint when no terminal states', async () => {
      const noTerminalSchema: FabricSchema = {
        ...bookSchema,
        entities: {
          Tag: {
            name: 'Tag',
            role: 'entity',
            description: 'A tag',
            fields: {
              id: { name: 'id', type: 'uuid', nullable: false, primaryKey: true, pii: false },
            },
            relations: {},
            behaviors: {},
            stateMachine: {
              field: 'status',
              initial: 'active',
              states: { active: { name: 'active', description: 'Active', terminal: false } },
              transitions: [],
            },
            pii: [],
            gdpr: {},
          },
        },
      }
      const result = await generator.generate(noTerminalSchema, makeCtx())
      const ddl = result.files.find(f => f.path === 'sql/schema.sql')!.content
      expect(ddl).not.toContain('chk_')
    })
  })

  describe('incremental migrations', () => {
    it('emits no migration file when schema is unchanged', async () => {
      const prev = makeSnapshot(bookSchema)
      const result = await generator.generate(bookSchema, makeCtx(prev))
      const migrPaths = result.files.filter(f => f.path.startsWith('sql/migrations/'))
      expect(migrPaths).toHaveLength(0)
    })

    it('emits migration when a field is added', async () => {
      const prev = makeSnapshot(bookSchema)
      const next: FabricSchema = {
        ...bookSchema,
        entities: {
          Book: {
            ...bookSchema.entities.Book,
            fields: {
              ...bookSchema.entities.Book.fields,
              publishedAt: { name: 'publishedAt', type: 'timestamp', nullable: true, primaryKey: false, pii: false },
            },
          },
        },
      }
      const result = await generator.generate(next, makeCtx(prev))
      const migFile = result.files.find(f => f.path.startsWith('sql/migrations/'))
      expect(migFile).toBeDefined()
      expect(migFile!.content).toContain('ADD COLUMN IF NOT EXISTS published_at')
    })

    it('emits MANUAL REVIEW block for removed columns', async () => {
      const prev = makeSnapshot(bookSchema)
      const withoutNotes: FabricSchema = {
        ...bookSchema,
        entities: {
          Book: {
            ...bookSchema.entities.Book,
            fields: Object.fromEntries(
              Object.entries(bookSchema.entities.Book.fields).filter(([k]) => k !== 'notes')
            ),
          },
        },
      }
      const result = await generator.generate(withoutNotes, makeCtx(prev))
      const migFile = result.files.find(f => f.path.startsWith('sql/migrations/'))
      expect(migFile).toBeDefined()
      expect(migFile!.content).toContain('MANUAL REVIEW')
      expect(migFile!.content).toContain('notes')
    })

    it('emits CREATE TABLE for new entity', async () => {
      const prev = makeSnapshot(minimalSchema)
      const result = await generator.generate(bookSchema, makeCtx(prev))
      const migFile = result.files.find(f => f.path.startsWith('sql/migrations/'))
      expect(migFile).toBeDefined()
      expect(migFile!.content).toContain('CREATE TABLE IF NOT EXISTS books')
    })

    it('emits MANUAL REVIEW for dropped table', async () => {
      const prev = makeSnapshot(bookSchema)
      const result = await generator.generate(minimalSchema, makeCtx(prev))
      const migFile = result.files.find(f => f.path.startsWith('sql/migrations/'))
      expect(migFile).toBeDefined()
      expect(migFile!.content).toContain('MANUAL REVIEW')
      expect(migFile!.content).toContain('books')
    })

    it('emits ALTER TYPE ADD VALUE for new enum values', async () => {
      const prev = makeSnapshot(bookSchema)
      const withReserved: FabricSchema = {
        ...bookSchema,
        entities: {
          Book: {
            ...bookSchema.entities.Book,
            fields: {
              ...bookSchema.entities.Book.fields,
              status: {
                ...bookSchema.entities.Book.fields.status,
                enumValues: ['available', 'borrowed', 'reserved'],
              },
            },
          },
        },
      }
      const result = await generator.generate(withReserved, makeCtx(prev))
      const migFile = result.files.find(f => f.path.startsWith('sql/migrations/'))
      expect(migFile).toBeDefined()
      expect(migFile!.content).toContain("ALTER TYPE book_status_enum ADD VALUE IF NOT EXISTS 'reserved'")
    })

    it('adds DEFAULT placeholder for NOT NULL added columns', async () => {
      const prev = makeSnapshot(bookSchema)
      const withRequired: FabricSchema = {
        ...bookSchema,
        entities: {
          Book: {
            ...bookSchema.entities.Book,
            fields: {
              ...bookSchema.entities.Book.fields,
              isbn: { name: 'isbn', type: 'string', nullable: false, primaryKey: false, pii: false },
            },
          },
        },
      }
      const result = await generator.generate(withRequired, makeCtx(prev))
      const migFile = result.files.find(f => f.path.startsWith('sql/migrations/'))
      expect(migFile!.content).toContain('NOT NULL DEFAULT')
      expect(migFile!.content).toContain('TODO: backfill')
    })

    it('emits SET NOT NULL for column made non-nullable', async () => {
      const prev = makeSnapshot(bookSchema)
      const notesRequired: FabricSchema = {
        ...bookSchema,
        entities: {
          Book: {
            ...bookSchema.entities.Book,
            fields: {
              ...bookSchema.entities.Book.fields,
              notes: { ...bookSchema.entities.Book.fields.notes, nullable: false },
            },
          },
        },
      }
      const result = await generator.generate(notesRequired, makeCtx(prev))
      const migFile = result.files.find(f => f.path.startsWith('sql/migrations/'))
      expect(migFile!.content).toContain('ALTER COLUMN notes SET NOT NULL')
    })

    it('emits DROP NOT NULL for column made nullable', async () => {
      const prev = makeSnapshot(bookSchema)
      const titleNullable: FabricSchema = {
        ...bookSchema,
        entities: {
          Book: {
            ...bookSchema.entities.Book,
            fields: {
              ...bookSchema.entities.Book.fields,
              title: { ...bookSchema.entities.Book.fields.title, nullable: true },
            },
          },
        },
      }
      const result = await generator.generate(titleNullable, makeCtx(prev))
      const migFile = result.files.find(f => f.path.startsWith('sql/migrations/'))
      expect(migFile!.content).toContain('ALTER COLUMN title DROP NOT NULL')
    })
  })

  describe('join tables', () => {
    it('emits a join table for manyToMany relations', async () => {
      const schema: FabricSchema = {
        ...minimalSchema,
        entities: {
          Book: {
            name: 'Book',
            role: 'entity',
            description: 'Book',
            fields: { id: { name: 'id', type: 'uuid', nullable: false, primaryKey: true, pii: false } },
            relations: {
              authors: { name: 'authors', kind: 'manyToMany', target: 'Author' },
            },
            behaviors: {},
            pii: [],
            gdpr: {},
          },
        },
      }
      const result = await generator.generate(schema, makeCtx())
      const ddl = result.files.find(f => f.path === 'sql/schema.sql')!.content
      expect(ddl).toContain('CREATE TABLE IF NOT EXISTS book_author')
    })
  })

  describe('toSnakeCase / tableName', () => {
    it('converts camelCase entity names to snake_case plural table names', async () => {
      const schema: FabricSchema = {
        ...minimalSchema,
        entities: {
          LoanRecord: {
            name: 'LoanRecord',
            role: 'entity',
            description: 'A loan record',
            fields: { id: { name: 'id', type: 'uuid', nullable: false, primaryKey: true, pii: false } },
            relations: {},
            behaviors: {},
            pii: [],
            gdpr: {},
          },
        },
      }
      const result = await generator.generate(schema, makeCtx())
      const ddl = result.files.find(f => f.path === 'sql/schema.sql')!.content
      expect(ddl).toContain('CREATE TABLE IF NOT EXISTS loan_records')
    })
  })
})

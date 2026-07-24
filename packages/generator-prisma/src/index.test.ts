import { PrismaGenerator } from './index'
import type { FabricSchema, GeneratorContext, GeneratorOutput } from '@newel/core'

const makeCtx = (): GeneratorContext => ({
  outputDir: '/tmp/test-prisma',
  outputs: new Map<string, GeneratorOutput>(),
})

const schema: FabricSchema = {
  version: '2.0.0',
  meta: { name: 'LibraryApp', version: '1.0.0' },
  entities: {
    Book: {
      name: 'Book',
      role: 'entity',
      description: 'A book in the catalogue',
      fields: {
        id:     { name: 'id',     type: 'uuid',   nullable: false, primaryKey: true,  pii: false },
        title:  { name: 'title',  type: 'string', nullable: false, primaryKey: false, pii: false },
        status: { name: 'status', type: 'enum',   nullable: false, primaryKey: false, pii: false, enumValues: ['available', 'borrowed'] },
      },
      relations: {},
      behaviors: {
        borrow: {
          name: 'borrow',
          description: 'Borrows a book',
          rules: ['Member must have no overdue loans'],
          auth: { roles: ['member', 'librarian'] },
        },
        return: {
          name: 'return',
          description: 'Returns a book',
          rules: [],
          auth: { roles: ['member', 'librarian'] },
        },
      },
      pii: [],
      gdpr: {},
      stateMachine: {
        field: 'status',
        initial: 'available',
        states: {
          available: { name: 'available', description: 'On shelf',      terminal: false },
          borrowed:  { name: 'borrowed',  description: 'With a member', terminal: false },
        },
        transitions: [
          { from: 'available', to: 'borrowed',  trigger: 'borrow', guards: ['Member must have no overdue loans'], effects: [] },
          { from: 'borrowed',  to: 'available', trigger: 'return', guards: [], effects: [] },
        ],
      },
    },
    Loan: {
      name: 'Loan',
      role: 'entity',
      description: 'A loan record',
      fields: {
        id:     { name: 'id',     type: 'uuid',      nullable: false, primaryKey: true,  pii: false },
        bookId: { name: 'bookId', type: 'uuid',      nullable: false, primaryKey: false, pii: false, foreignKey: 'Book.id' },
        dueAt:  { name: 'dueAt',  type: 'timestamp', nullable: false, primaryKey: false, pii: false },
      },
      relations: {
        book: { name: 'book', kind: 'belongsTo', target: 'Book', foreignKey: 'bookId' },
      },
      behaviors: {},
      pii: [],
      gdpr: {},
    },
  },
  apis: {},
}

describe('PrismaGenerator', () => {
  it('has name "prisma" and dependsOn typescript', () => {
    const gen = new PrismaGenerator()
    expect(gen.name).toBe('prisma')
    expect(gen.dependsOn).toEqual(['typescript'])
  })

  it('generates exactly 3 files', async () => {
    const gen = new PrismaGenerator()
    const result = await gen.generate(schema, makeCtx())
    expect(result.files).toHaveLength(3)
  })

  it('generates prisma/schema.prisma', async () => {
    const gen = new PrismaGenerator()
    const result = await gen.generate(schema, makeCtx())
    const file = result.files.find(f => f.path === 'prisma/schema.prisma')
    expect(file).toBeDefined()
    expect(file!.content).toContain('generator client')
    expect(file!.content).toContain('datasource db')
    expect(file!.content).toContain('provider = "postgresql"')
  })

  it('emits a model for each entity', async () => {
    const gen = new PrismaGenerator()
    const result = await gen.generate(schema, makeCtx())
    const content = result.files.find(f => f.path === 'prisma/schema.prisma')!.content
    expect(content).toContain('model Book {')
    expect(content).toContain('model Loan {')
  })

  it('maps enum field to Prisma enum and uses it in the model', async () => {
    const gen = new PrismaGenerator()
    const result = await gen.generate(schema, makeCtx())
    const content = result.files.find(f => f.path === 'prisma/schema.prisma')!.content
    expect(content).toMatch(/enum BookStatusEnum/)
    expect(content).toContain('AVAILABLE')
    expect(content).toContain('BORROWED')
    expect(content).toContain('BookStatusEnum')
  })

  it('emits @id on primary key fields', async () => {
    const gen = new PrismaGenerator()
    const result = await gen.generate(schema, makeCtx())
    const content = result.files.find(f => f.path === 'prisma/schema.prisma')!.content
    expect(content).toContain('@id')
    expect(content).toContain('@default(uuid())')
  })

  it('emits @relation for belongsTo relations', async () => {
    const gen = new PrismaGenerator()
    const result = await gen.generate(schema, makeCtx())
    const content = result.files.find(f => f.path === 'prisma/schema.prisma')!.content
    expect(content).toContain('@relation(fields: [bookId], references: [id])')
  })

  it('generates prisma/client.ts with singleton PrismaClient', async () => {
    const gen = new PrismaGenerator()
    const result = await gen.generate(schema, makeCtx())
    const file = result.files.find(f => f.path === 'prisma/client.ts')
    expect(file).toBeDefined()
    expect(file!.content).toContain("import { PrismaClient } from '@prisma/client'")
    expect(file!.content).toContain('export const prisma')
    expect(file!.content).toContain('new PrismaClient()')
  })

  it('generates prisma/repository.ts with CRUD methods', async () => {
    const gen = new PrismaGenerator()
    const result = await gen.generate(schema, makeCtx())
    const file = result.files.find(f => f.path === 'prisma/repository.ts')
    expect(file).toBeDefined()
    const content = file!.content
    expect(content).toContain('class BookRepository')
    expect(content).toContain('findById')
    expect(content).toContain('findAll')
    expect(content).toContain('create')
    expect(content).toContain('update')
    expect(content).toContain('delete')
  })

  it('emits behavior methods for state machine transitions', async () => {
    const gen = new PrismaGenerator()
    const result = await gen.generate(schema, makeCtx())
    const content = result.files.find(f => f.path === 'prisma/repository.ts')!.content
    expect(content).toContain('async borrow(')
    expect(content).toContain('async return(')
  })

  it('behavior method includes guard comment and state check', async () => {
    const gen = new PrismaGenerator()
    const result = await gen.generate(schema, makeCtx())
    const content = result.files.find(f => f.path === 'prisma/repository.ts')!.content
    expect(content).toContain('Rule: Member must have no overdue loans')
    expect(content).toContain('entity.status === "available"')
    expect(content).toContain('"borrowed"')
  })

  it('exports a singleton repository instance per entity', async () => {
    const gen = new PrismaGenerator()
    const result = await gen.generate(schema, makeCtx())
    const content = result.files.find(f => f.path === 'prisma/repository.ts')!.content
    expect(content).toContain('export const bookRepository = new BookRepository()')
    expect(content).toContain('export const loanRepository = new LoanRepository()')
  })

  it('attaches @generated header to all files', async () => {
    const gen = new PrismaGenerator()
    const result = await gen.generate(schema, makeCtx())
    for (const file of result.files) {
      expect(file.header).toContain('@generated by @newel/generator-prisma')
    }
  })
})

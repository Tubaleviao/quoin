import { ExpressGenerator } from './index'
import type { FabricSchema, GeneratorContext, GeneratorOutput } from '@newel/core'

const makeCtx = (): GeneratorContext => ({
  outputDir: '/tmp/test-express',
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
          available: { name: 'available', description: 'On shelf',       terminal: false },
          borrowed:  { name: 'borrowed',  description: 'With a member',  terminal: false },
        },
        transitions: [
          { from: 'available', to: 'borrowed',  trigger: 'borrow', guards: ['Member must have no overdue loans'], effects: [] },
          { from: 'borrowed',  to: 'available', trigger: 'return', guards: [],                                    effects: [] },
        ],
      },
    },
  },
  apis: {
    BookAPI: {
      name: 'BookAPI',
      baseUrl: '/books',
      endpoints: {
        'GET /':    { method: 'GET',    path: '/',    description: 'List books',   auth: { roles: ['member'] }, returns: 'Book' },
        'GET /:id': { method: 'GET',    path: '/:id', description: 'Get book',     auth: { roles: ['member'] }, returns: 'Book' },
        'POST /':   { method: 'POST',   path: '/',    description: 'Create book',  auth: { roles: ['librarian'] }, behavior: 'Book.borrow' },
      },
    },
  },
}

describe('ExpressGenerator', () => {
  it('has name "express" and dependsOn typescript', () => {
    const gen = new ExpressGenerator()
    expect(gen.name).toBe('express')
    expect(gen.dependsOn).toEqual(['typescript'])
  })

  it('generates exactly 4 files', async () => {
    const gen = new ExpressGenerator()
    const result = await gen.generate(schema, makeCtx())
    expect(result.files).toHaveLength(4)
  })

  it('generates routes file at express/routes/index.ts', async () => {
    const gen = new ExpressGenerator()
    const result = await gen.generate(schema, makeCtx())
    const routes = result.files.find(f => f.path === 'express/routes/index.ts')
    expect(routes).toBeDefined()
    expect(routes!.content).toContain("import { Router, Request, Response } from 'express'")
    expect(routes!.content).toContain("const router = Router()")
    expect(routes!.content).toContain("export default router")
  })

  it('renders GET, POST routes with correct paths', async () => {
    const gen = new ExpressGenerator()
    const result = await gen.generate(schema, makeCtx())
    const content = result.files.find(f => f.path === 'express/routes/index.ts')!.content
    expect(content).toContain("router.get('/books/'")
    expect(content).toContain("router.get('/books/:id'")
    expect(content).toContain("router.post('/books/'")
  })

  it('includes requireRoles import when any endpoint has auth', async () => {
    const gen = new ExpressGenerator()
    const result = await gen.generate(schema, makeCtx())
    const content = result.files.find(f => f.path === 'express/routes/index.ts')!.content
    expect(content).toContain("import { requireRoles } from '../middleware/auth'")
  })

  it('includes requireRoles call with correct roles', async () => {
    const gen = new ExpressGenerator()
    const result = await gen.generate(schema, makeCtx())
    const content = result.files.find(f => f.path === 'express/routes/index.ts')!.content
    expect(content).toContain("requireRoles(['member'])")
  })

  it('generates auth middleware at express/middleware/auth.ts', async () => {
    const gen = new ExpressGenerator()
    const result = await gen.generate(schema, makeCtx())
    const auth = result.files.find(f => f.path === 'express/middleware/auth.ts')
    expect(auth).toBeDefined()
    expect(auth!.content).toContain('export function requireRoles')
  })

  it('generates app entry at express/app.ts', async () => {
    const gen = new ExpressGenerator()
    const result = await gen.generate(schema, makeCtx())
    const app = result.files.find(f => f.path === 'express/app.ts')
    expect(app).toBeDefined()
    expect(app!.content).toContain("import express from 'express'")
    expect(app!.content).toContain("app.use(express.json())")
  })

  it('generates server entry at express/server.ts with app.listen', async () => {
    const gen = new ExpressGenerator()
    const result = await gen.generate(schema, makeCtx())
    const server = result.files.find(f => f.path === 'express/server.ts')
    expect(server).toBeDefined()
    expect(server!.content).toContain("import app from './app'")
    expect(server!.content).toContain('app.listen(PORT')
    expect(server!.content).toContain('LibraryApp')
  })

  it('imports entity types from typescript output for endpoints with returns', async () => {
    const gen = new ExpressGenerator()
    const result = await gen.generate(schema, makeCtx())
    const content = result.files.find(f => f.path === 'express/routes/index.ts')!.content
    expect(content).toContain("import type { Book } from '../typescript'")
  })

  it('casts res.json response with return type when returns is set', async () => {
    const gen = new ExpressGenerator()
    const result = await gen.generate(schema, makeCtx())
    const content = result.files.find(f => f.path === 'express/routes/index.ts')!.content
    expect(content).toContain('as Book')
  })

  it('auto-generates POST endpoints for uncovered state machine transitions', async () => {
    const gen = new ExpressGenerator()
    // Schema where 'return' transition has no explicit API endpoint
    const schemaNoReturn: FabricSchema = { ...schema, apis: {
      BookAPI: {
        name: 'BookAPI',
        baseUrl: '',
        endpoints: {
          'GET /books': { method: 'GET', path: '/books', description: 'List', auth: { roles: ['member'] } },
        },
      },
    }}
    const result = await gen.generate(schemaNoReturn, makeCtx())
    const content = result.files.find(f => f.path === 'express/routes/index.ts')!.content
    // Both borrow and return transitions should get synthetic endpoints
    expect(content).toContain('/books/:id/borrow')
    expect(content).toContain('/books/:id/return')
  })

  it('includes behavior rules as comments in handler body', async () => {
    const gen = new ExpressGenerator()
    const result = await gen.generate(schema, makeCtx())
    const content = result.files.find(f => f.path === 'express/routes/index.ts')!.content
    expect(content).toContain('// Rule: Member must have no overdue loans')
  })

  it('attaches @generated header to all files', async () => {
    const gen = new ExpressGenerator()
    const result = await gen.generate(schema, makeCtx())
    for (const file of result.files) {
      expect(file.header).toContain('@generated by @newel/generator-express')
    }
  })

  describe('orm: prisma', () => {
    it('includes prisma in dependsOn when orm option is set', () => {
      const gen = new ExpressGenerator({ orm: 'prisma' })
      expect(gen.dependsOn).toContain('prisma')
      expect(gen.dependsOn).toContain('typescript')
    })

    it('imports from prisma/repository instead of typescript types', async () => {
      const gen = new ExpressGenerator({ orm: 'prisma' })
      const result = await gen.generate(schema, makeCtx())
      const content = result.files.find(f => f.path === 'express/routes/index.ts')!.content
      expect(content).toContain("from '../../prisma/repository'")
      expect(content).not.toContain("from '../typescript'")
    })

    it('replaces TODO stubs with repository findAll for GET list endpoints', async () => {
      const gen = new ExpressGenerator({ orm: 'prisma' })
      const result = await gen.generate(schema, makeCtx())
      const content = result.files.find(f => f.path === 'express/routes/index.ts')!.content
      expect(content).toContain('bookRepository.findAll()')
      expect(content).not.toContain('// TODO: implement')
    })

    it('uses findById for GET /:id endpoints', async () => {
      const gen = new ExpressGenerator({ orm: 'prisma' })
      const result = await gen.generate(schema, makeCtx())
      const content = result.files.find(f => f.path === 'express/routes/index.ts')!.content
      expect(content).toContain('bookRepository.findById(id)')
    })

    it('calls the behavior repository method for state-machine POST endpoints', async () => {
      const gen = new ExpressGenerator({ orm: 'prisma' })
      // Schema without explicit API so auto-generated transition endpoints kick in
      const bare: FabricSchema = { ...schema, apis: {} }
      const result = await gen.generate(bare, makeCtx())
      const content = result.files.find(f => f.path === 'express/routes/index.ts')!.content
      expect(content).toContain('bookRepository.borrow(id)')
      expect(content).toContain('bookRepository.return(id)')
    })
  })
})

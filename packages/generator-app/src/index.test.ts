import { AppGenerator } from './index'
import type { FabricSchema, GeneratorContext, GeneratorOutput } from '@newel/core'

const PRISMA_SCHEMA_CONTENT = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Book {
  id     String @id
  title  String
  status String
}
`

const makeCtx = (): GeneratorContext => {
  const outputs = new Map<string, GeneratorOutput>()
  outputs.set('prisma', {
    files: [
      {
        path: 'prisma/schema.prisma',
        content: PRISMA_SCHEMA_CONTENT,
      },
    ],
  })
  outputs.set('ui', {
    files: [{ path: 'ui/Book.tsx', content: '' }],
    artifacts: { entities: ['Book'] },
  })
  return { outputDir: '/tmp/test-app', outputs }
}

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
          description: 'Borrow a book',
          rules: ['Member must be active'],
          auth: { roles: ['member', 'librarian'] },
        },
        return: {
          name: 'return',
          description: 'Return a book',
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
          { from: 'available', to: 'borrowed',  trigger: 'borrow', guards: ['Member must be active'], effects: [] },
          { from: 'borrowed',  to: 'available', trigger: 'return', guards: [],                        effects: [] },
        ],
      },
    },
    Member: {
      name: 'Member',
      role: 'entity',
      description: 'A library member',
      fields: {
        id:    { name: 'id',    type: 'uuid',   nullable: false, primaryKey: true,  pii: false },
        name:  { name: 'name',  type: 'string', nullable: false, primaryKey: false, pii: true  },
        email: { name: 'email', type: 'string', nullable: false, primaryKey: false, pii: true  },
      },
      relations: {},
      behaviors: {},
      pii: ['name', 'email'],
      gdpr: {},
    },
  },
  apis: {
    LibraryAPI: {
      name: 'LibraryAPI',
      baseUrl: '',
      endpoints: {
        'GET /books':    { method: 'GET',  path: '/books',    description: 'List books', auth: { roles: ['member'] } },
        'GET /books/:id': { method: 'GET', path: '/books/:id', description: 'Get book',  auth: { roles: ['member'] } },
        'POST /books':   { method: 'POST', path: '/books',    description: 'Add book',   auth: { roles: ['librarian'] } },
        'GET /members':  { method: 'GET',  path: '/members',  description: 'List members', auth: { roles: ['librarian'] } },
      },
    },
  },
}

describe('AppGenerator', () => {
  it('has name "app" and dependsOn express, prisma, ui', () => {
    const gen = new AppGenerator()
    expect(gen.name).toBe('app')
    expect(gen.dependsOn).toContain('express')
    expect(gen.dependsOn).toContain('prisma')
    expect(gen.dependsOn).toContain('ui')
  })

  it('generates at least one file per entity page plus fixed files', async () => {
    const gen = new AppGenerator()
    const result = await gen.generate(schema, makeCtx())
    // fixed files: .env, server.ts, schema.prisma, index.html, main.tsx, App.tsx, vite.config.ts, tsconfig.json, api-client.ts
    // + 1 page per entity (Book, Member) = 11
    expect(result.files.length).toBeGreaterThanOrEqual(11)
  })

  it('generates app/server.ts with CORS, dotenv, and dev auth bypass', async () => {
    const gen = new AppGenerator()
    const result = await gen.generate(schema, makeCtx())
    const server = result.files.find(f => f.path === 'app/server.ts')
    expect(server).toBeDefined()
    expect(server!.content).toContain("import cors from 'cors'")
    expect(server!.content).toContain("import dotenv from 'dotenv'")
    expect(server!.content).toContain("x-dev-roles")
    expect(server!.content).toContain('req.user')
    expect(server!.content).toContain('app.listen(PORT')
  })

  it('generates app/.env with SQLite DATABASE_URL', async () => {
    const gen = new AppGenerator()
    const result = await gen.generate(schema, makeCtx())
    const env = result.files.find(f => f.path === 'app/.env')
    expect(env).toBeDefined()
    expect(env!.content).toContain('DATABASE_URL="file:./dev.db"')
    expect(env!.content).toContain('NODE_ENV=development')
  })

  it('generates app/schema.prisma with sqlite provider', async () => {
    const gen = new AppGenerator()
    const result = await gen.generate(schema, makeCtx())
    const prisma = result.files.find(f => f.path === 'app/schema.prisma')
    expect(prisma).toBeDefined()
    expect(prisma!.content).toContain('provider = "sqlite"')
    expect(prisma!.content).not.toContain('provider = "postgresql"')
  })

  it('generates app/client/vite.config.ts with /api proxy', async () => {
    const gen = new AppGenerator()
    const result = await gen.generate(schema, makeCtx())
    const vite = result.files.find(f => f.path === 'app/client/vite.config.ts')
    expect(vite).toBeDefined()
    expect(vite!.content).toContain("'^/api/'")
    expect(vite!.content).toContain('proxy')
    expect(vite!.content).toContain('@generated')
  })

  it('generates app/client/api-client.ts with setDevRoles and apiFetch', async () => {
    const gen = new AppGenerator()
    const result = await gen.generate(schema, makeCtx())
    const client = result.files.find(f => f.path === 'app/client/api-client.ts')
    expect(client).toBeDefined()
    expect(client!.content).toContain('setDevRoles')
    expect(client!.content).toContain('X-Dev-Roles')
    expect(client!.content).toContain('apiFetch')
  })

  it('generates one page file per entity', async () => {
    const gen = new AppGenerator()
    const result = await gen.generate(schema, makeCtx())
    const bookPage = result.files.find(f => f.path === 'app/client/pages/BookPage.tsx')
    const memberPage = result.files.find(f => f.path === 'app/client/pages/MemberPage.tsx')
    expect(bookPage).toBeDefined()
    expect(memberPage).toBeDefined()
  })

  it('entity page imports the UI component from @generated', async () => {
    const gen = new AppGenerator()
    const result = await gen.generate(schema, makeCtx())
    const bookPage = result.files.find(f => f.path === 'app/client/pages/BookPage.tsx')!
    expect(bookPage.content).toContain("from '@generated/ui/Book'")
  })

  it('entity page includes ActionPanel for entities with a state machine', async () => {
    const gen = new AppGenerator()
    const result = await gen.generate(schema, makeCtx())
    const bookPage = result.files.find(f => f.path === 'app/client/pages/BookPage.tsx')!
    expect(bookPage.content).toContain('BookActionPanel')
  })

  it('entity page shows notice for entities without list endpoint', async () => {
    const gen = new AppGenerator()
    // Schema with no GET /members endpoint for Member
    const schemaNoMemberList: FabricSchema = {
      ...schema,
      apis: {
        LibraryAPI: {
          ...schema.apis['LibraryAPI']!,
          endpoints: {
            'GET /books': schema.apis['LibraryAPI']!.endpoints['GET /books']!,
          },
        },
      },
    }
    const result = await gen.generate(schemaNoMemberList, makeCtx())
    const memberPage = result.files.find(f => f.path === 'app/client/pages/MemberPage.tsx')!
    expect(memberPage.content).toContain('No list endpoint')
  })

  it('generates App.tsx with tab navigation for each entity', async () => {
    const gen = new AppGenerator()
    const result = await gen.generate(schema, makeCtx())
    const app = result.files.find(f => f.path === 'app/client/App.tsx')!
    expect(app.content).toContain('Book')
    expect(app.content).toContain('Member')
    expect(app.content).toContain('setDevRoles')
    expect(app.content).toContain('X-Dev-Roles')
  })

  it('omits schema.prisma when prisma output is unavailable', async () => {
    const gen = new AppGenerator()
    const emptyCtx: GeneratorContext = {
      outputDir: '/tmp/test-app',
      outputs: new Map(),
    }
    const result = await gen.generate(schema, emptyCtx)
    const prisma = result.files.find(f => f.path === 'app/schema.prisma')
    expect(prisma).toBeUndefined()
  })
})

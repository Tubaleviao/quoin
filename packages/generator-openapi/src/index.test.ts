import { OpenApiGenerator } from './index'
import type { FabricSchema, GeneratorContext, GeneratorOutput } from '@newel/core'

const makeCtx = (): GeneratorContext => ({
  outputDir: '/tmp/test-openapi',
  outputs: new Map<string, GeneratorOutput>(),
})

const minimalSchema: FabricSchema = {
  version: '2.0.0',
  meta: { name: 'TestApp', version: '2.0.0' },
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
      fields: {
        id:     { name: 'id',     type: 'uuid',    nullable: false, primaryKey: true,  pii: false },
        title:  { name: 'title',  type: 'string',  nullable: false, primaryKey: false, pii: false, description: 'Book title' },
        status: { name: 'status', type: 'enum',    nullable: false, primaryKey: false, pii: false, enumValues: ['available', 'borrowed'] },
        notes:  { name: 'notes',  type: 'string',  nullable: true,  primaryKey: false, pii: false },
      },
      relations: {},
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
          available: { name: 'available', description: 'On the shelf', terminal: false },
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
  },
  apis: {
    LibraryAPI: {
      name: 'LibraryAPI',
      baseUrl: '/books',
      endpoints: {
        'GET /': {
          method: 'GET',
          path: '/',
          description: 'List all books',
          returns: 'Book',
          auth: { roles: ['member', 'librarian'] },
        },
        'GET /:id': {
          method: 'GET',
          path: '/:id',
          description: 'Get a book',
          returns: 'Book',
        },
        'POST /:id/borrow': {
          method: 'POST',
          path: '/:id/borrow',
          description: 'Borrow a book',
          behavior: 'Book.borrow',
        },
      },
    },
  },
}

describe('OpenApiGenerator', () => {
  const generator = new OpenApiGenerator()

  it('has correct name and dependsOn', () => {
    expect(generator.name).toBe('openapi')
    expect(generator.dependsOn).toEqual(['typescript'])
  })

  it('produces a single openapi.yaml file', async () => {
    const result = await generator.generate(minimalSchema, makeCtx())
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe('openapi/openapi.yaml')
  })

  it('includes @generated header', async () => {
    const result = await generator.generate(minimalSchema, makeCtx())
    expect(result.files[0].header).toContain('@generated')
  })

  describe('info block', () => {
    it('renders title and version', async () => {
      const { files } = await generator.generate(minimalSchema, makeCtx())
      const content = files[0].content
      expect(content).toContain('title: TestApp')
      expect(content).toContain('version: 2.0.0')
    })

    it('renders description when present', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      expect(files[0].content).toContain('description: Library management')
    })

    it('defaults version to 1.0.0 when omitted', async () => {
      const { files } = await generator.generate(minimalSchema, makeCtx())
      // minimalSchema has version '2.0.0' in meta — test a schema without version
      const noVersionSchema: FabricSchema = { ...minimalSchema, meta: { name: 'Test' } }
      const r2 = await generator.generate(noVersionSchema, makeCtx())
      expect(r2.files[0].content).toContain('version: 1.0.0')
    })
  })

  describe('components/schemas', () => {
    it('renders entity schema as object type', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const content = files[0].content
      expect(content).toContain('Book:')
      expect(content).toContain('type: object')
      expect(content).toContain('description: A book in the catalogue')
    })

    it('lists non-nullable fields as required', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const content = files[0].content
      expect(content).toContain('required:')
      expect(content).toContain('- id')
      expect(content).toContain('- title')
      expect(content).toContain('- status')
      // nullable field should NOT be in required
      expect(content).not.toMatch(/required:[\s\S]*?- notes/)
    })

    it('renders enum field with type string and enum values', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const content = files[0].content
      expect(content).toContain('type: string')
      expect(content).toContain('enum:')
      expect(content).toContain('- available')
      expect(content).toContain('- borrowed')
    })

    it('renders uuid field with format uuid', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const content = files[0].content
      expect(content).toContain('format: uuid')
    })

    it('renders nullable field with nullable: true', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const content = files[0].content
      // notes field is nullable
      expect(content).toMatch(/notes:[\s\S]*?nullable: true/)
    })

    it('renders behavior input schemas', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const content = files[0].content
      expect(content).toContain('Book_borrow_Input:')
      expect(content).toContain('memberId:')
    })
  })

  describe('paths', () => {
    it('renders explicit API endpoints', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const content = files[0].content
      expect(content).toContain('/books:')
      expect(content).toContain('get:')
      expect(content).toContain('summary: List all books')
    })

    it('renders path parameters', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const content = files[0].content
      // Paths with {param} are YAML-quoted
      expect(content).toContain('"/books/{id}"')
      expect(content).toContain('in: path')
      expect(content).toContain('required: true')
    })

    it('renders security for authenticated endpoints', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const content = files[0].content
      expect(content).toContain('security:')
      expect(content).toContain('bearerAuth: [member]')
      expect(content).toContain('bearerAuth: [librarian]')
    })

    it('renders 401/403 responses for secured endpoints', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const content = files[0].content
      expect(content).toContain("'401':")
      expect(content).toContain("'403':")
    })

    it('renders requestBody for POST endpoints with behavior input', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const content = files[0].content
      expect(content).toContain('requestBody:')
      expect(content).toContain("$ref: '#/components/schemas/Book_borrow_Input'")
    })

    it('renders $ref for returns endpoints', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const content = files[0].content
      expect(content).toContain("$ref: '#/components/schemas/Book'")
    })

    it('renders 204 for DELETE endpoints', async () => {
      const deleteSchema: FabricSchema = {
        ...minimalSchema,
        apis: {
          BookAPI: {
            name: 'BookAPI',
            endpoints: {
              'DELETE /:id': { method: 'DELETE', path: '/:id', description: 'Delete a book' },
            },
          },
        },
      }
      const { files } = await generator.generate(deleteSchema, makeCtx())
      expect(files[0].content).toContain("'204':")
    })

    it('builds correct operationId from method and path', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const content = files[0].content
      expect(content).toContain('operationId: getBooks')
      expect(content).toContain('operationId: getBooksById')
    })
  })

  describe('security schemes', () => {
    it('includes bearerAuth security scheme in components', async () => {
      const { files } = await generator.generate(minimalSchema, makeCtx())
      const content = files[0].content
      expect(content).toContain('securitySchemes:')
      expect(content).toContain('bearerAuth:')
      expect(content).toContain('scheme: bearer')
      expect(content).toContain('bearerFormat: JWT')
    })
  })

  describe('auto-generated transition endpoints', () => {
    it('generates endpoints for uncovered state machine transitions', async () => {
      // richSchema has 'borrow' covered by 'POST /:id/borrow', but 'returnBook' is not covered
      const { files } = await generator.generate(richSchema, makeCtx())
      const content = files[0].content
      expect(content).toContain('return-book')
    })

    it('does not duplicate endpoints already declared in APIs', async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const content = files[0].content
      // 'borrow' is already declared at POST /books/:id/borrow — should not appear twice
      const borrowCount = (content.match(/borrow/g) ?? []).length
      // It appears in the explicit endpoint summary + operationId + auto-gen check, but not as a duplicate path
      const postBorrowPaths = (content.match(/\/books\/\{id\}\/borrow/g) ?? []).length
      expect(postBorrowPaths).toBeLessThanOrEqual(1)
    })

    it('skips auto-generation when entity has no state machine', async () => {
      const noSmSchema: FabricSchema = {
        ...minimalSchema,
        entities: {
          Tag: {
            name: 'Tag',
            role: 'entity',
            description: 'A tag',
            fields: { id: { name: 'id', type: 'uuid', nullable: false, primaryKey: true, pii: false } },
            relations: {},
            behaviors: {},
            pii: [],
            gdpr: {},
          },
        },
      }
      const { files } = await generator.generate(noSmSchema, makeCtx())
      const content = files[0].content
      // No synthetic paths beyond info/components
      expect(content).not.toContain('/tags/')
    })
  })
})

import { JsonSchemaGenerator } from './index'
import type { FabricSchema, GeneratorContext, GeneratorOutput } from '@newel/core'

const makeCtx = (): GeneratorContext => ({
  outputDir: '/tmp/test-jsonschema',
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
  meta: { name: 'LibraryApp', version: '1.0.0', namespace: 'https://example.com/library/' },
  entities: {
    Book: {
      name: 'Book',
      role: 'entity',
      description: 'A book in the catalogue',
      fields: {
        id:        { name: 'id',        type: 'uuid',    nullable: false, primaryKey: true,  pii: false },
        title:     { name: 'title',     type: 'string',  nullable: false, primaryKey: false, pii: false, description: 'Book title' },
        status:    { name: 'status',    type: 'enum',    nullable: false, primaryKey: false, pii: false, enumValues: ['available', 'borrowed'] },
        pages:     { name: 'pages',     type: 'integer', nullable: false, primaryKey: false, pii: false },
        price:     { name: 'price',     type: 'decimal', nullable: true,  primaryKey: false, pii: false },
        notes:     { name: 'notes',     type: 'string',  nullable: true,  primaryKey: false, pii: false },
        active:    { name: 'active',    type: 'boolean', nullable: false, primaryKey: false, pii: false },
        publishedAt: { name: 'publishedAt', type: 'timestamp', nullable: true, primaryKey: false, pii: false },
        releaseDate: { name: 'releaseDate', type: 'date',      nullable: true, primaryKey: false, pii: false },
        coverUrl:  { name: 'coverUrl',  type: 'url',     nullable: true,  primaryKey: false, pii: false },
        data:      { name: 'data',      type: 'json',    nullable: true,  primaryKey: false, pii: false },
      },
      relations: {},
      behaviors: {},
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
      },
      relations: {},
      behaviors: {},
      pii: ['email'],
      gdpr: { email: 'contact' },
    },
  },
  apis: {},
}

describe('JsonSchemaGenerator', () => {
  const generator = new JsonSchemaGenerator()

  it('has correct name and no dependencies', () => {
    expect(generator.name).toBe('jsonschema')
    expect(generator.dependsOn).toEqual([])
  })

  it('produces no files for empty schema', async () => {
    const { files } = await generator.generate(minimalSchema, makeCtx())
    expect(files).toHaveLength(0)
  })

  it('produces one file per entity', async () => {
    const { files } = await generator.generate(richSchema, makeCtx())
    expect(files).toHaveLength(2)
    expect(files.map(f => f.path)).toContain('jsonschema/Book.schema.json')
    expect(files.map(f => f.path)).toContain('jsonschema/Member.schema.json')
  })

  it('emits a @generated header', async () => {
    const { files } = await generator.generate(richSchema, makeCtx())
    for (const f of files) {
      expect(f.header).toContain('@generated')
    }
  })

  describe('schema structure', () => {
    let bookSchema: Record<string, unknown>

    beforeEach(async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const file = files.find(f => f.path === 'jsonschema/Book.schema.json')!
      bookSchema = JSON.parse(file.content)
    })

    it('sets $schema to draft-07', () => {
      expect(bookSchema['$schema']).toBe('http://json-schema.org/draft-07/schema#')
    })

    it('uses namespace in $id', () => {
      expect(bookSchema['$id']).toBe('https://example.com/library/Book')
    })

    it('sets title to entity name', () => {
      expect(bookSchema['title']).toBe('Book')
    })

    it('includes entity description', () => {
      expect(bookSchema['description']).toBe('A book in the catalogue')
    })

    it('is always object type', () => {
      expect(bookSchema['type']).toBe('object')
    })

    it('disallows additional properties', () => {
      expect(bookSchema['additionalProperties']).toBe(false)
    })

    it('lists required non-nullable fields', () => {
      const required = bookSchema['required'] as string[]
      expect(required).toContain('id')
      expect(required).toContain('title')
      expect(required).toContain('status')
      expect(required).not.toContain('price')
      expect(required).not.toContain('notes')
    })
  })

  describe('field type mapping', () => {
    let props: Record<string, Record<string, unknown>>

    beforeEach(async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      const file = files.find(f => f.path === 'jsonschema/Book.schema.json')!
      const parsed = JSON.parse(file.content)
      props = parsed['properties']
    })

    it('maps uuid to string/uuid', () => {
      expect(props['id']['type']).toBe('string')
      expect(props['id']['format']).toBe('uuid')
    })

    it('maps string to string', () => {
      expect(props['title']['type']).toBe('string')
    })

    it('maps enum to string with enum values', () => {
      expect(props['status']['type']).toBe('string')
      expect(props['status']['enum']).toEqual(['available', 'borrowed'])
    })

    it('maps integer to integer', () => {
      expect(props['pages']['type']).toBe('integer')
    })

    it('maps decimal to number', () => {
      const type = props['price']['type'] as string[]
      expect(type).toContain('number')
    })

    it('maps boolean to boolean', () => {
      expect(props['active']['type']).toBe('boolean')
    })

    it('maps timestamp to string/date-time', () => {
      const type = props['publishedAt']['type'] as string[]
      expect(type).toContain('string')
      expect(props['publishedAt']['format']).toBe('date-time')
    })

    it('maps date to string/date', () => {
      const type = props['releaseDate']['type'] as string[]
      expect(type).toContain('string')
      expect(props['releaseDate']['format']).toBe('date')
    })

    it('maps url to string/uri', () => {
      const type = props['coverUrl']['type'] as string[]
      expect(type).toContain('string')
      expect(props['coverUrl']['format']).toBe('uri')
    })

    it('includes field description in property', () => {
      expect(props['title']['description']).toBe('Book title')
    })

    it('makes nullable fields a type array including null', () => {
      const type = props['price']['type'] as string[]
      expect(Array.isArray(type)).toBe(true)
      expect(type).toContain('null')
    })

    it('makes non-nullable fields a plain string type', () => {
      expect(typeof props['title']['type']).toBe('string')
    })
  })

  describe('$id without namespace', () => {
    it('falls back to schema.org-style namespace', async () => {
      const schema = { ...richSchema, meta: { name: 'MyApp', version: '1.0.0' } }
      const { files } = await generator.generate(schema, makeCtx())
      const file = files.find(f => f.path === 'jsonschema/Book.schema.json')!
      const parsed = JSON.parse(file.content)
      expect(parsed['$id']).toContain('MyApp')
      expect(parsed['$id']).toContain('Book')
    })
  })
})

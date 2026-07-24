import { RdfGenerator } from './index'
import type { FabricSchema, GeneratorContext, GeneratorOutput } from '@newel/core'

const makeCtx = (): GeneratorContext => ({
  outputDir: '/tmp/test-rdf',
  outputs: new Map<string, GeneratorOutput>(),
})

const minimalSchema: FabricSchema = {
  version: '2.0.0',
  meta: { name: 'TestApp', version: '1.0.0', namespace: 'https://example.com/test/' },
  entities: {},
  apis: {},
}

const richSchema: FabricSchema = {
  version: '2.0.0',
  meta: { name: 'LibraryApp', description: 'Library management system', version: '1.0.0', namespace: 'https://example.com/library/' },
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
        active: { name: 'active', type: 'boolean', nullable: false, primaryKey: false, pii: false },
        pages:  { name: 'pages',  type: 'integer', nullable: false, primaryKey: false, pii: false },
        price:  { name: 'price',  type: 'decimal', nullable: true,  primaryKey: false, pii: false },
        publishedAt: { name: 'publishedAt', type: 'timestamp', nullable: true, primaryKey: false, pii: false },
        siteUrl: { name: 'siteUrl', type: 'url', nullable: true, primaryKey: false, pii: false },
      },
      relations: {
        loans: { name: 'loans', kind: 'hasMany', target: 'Loan', foreignKey: 'bookId' },
      },
      behaviors: {
        borrow: {
          name: 'borrow',
          description: 'Borrow a book',
          rules: ['Member must be active'],
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
    Member: {
      name: 'Member',
      role: 'entity',
      description: 'A library member',
      fields: {
        id:    { name: 'id',    type: 'uuid',  nullable: false, primaryKey: true,  pii: false },
        email: { name: 'email', type: 'email', nullable: false, primaryKey: false, pii: true,
                 gdprCategory: 'contact', gdprRetention: '5y', gdprLegalBasis: 'consent' },
        name:  { name: 'name',  type: 'string', nullable: false, primaryKey: false, pii: true,
                 gdprCategory: 'identity', gdprRetention: '5y', gdprLegalBasis: 'contract' },
      },
      relations: {},
      behaviors: {},
      pii: ['email', 'name'],
      gdpr: { email: 'contact', name: 'identity' },
    },
  },
  apis: {},
}

describe('RdfGenerator', () => {
  const generator = new RdfGenerator()

  it('has correct name and no dependencies', () => {
    expect(generator.name).toBe('rdf')
    expect(generator.dependsOn).toEqual([])
  })

  it('produces exactly one file', async () => {
    const { files } = await generator.generate(minimalSchema, makeCtx())
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('rdf/ontology.ttl')
  })

  it('emits a @generated header', async () => {
    const { files } = await generator.generate(richSchema, makeCtx())
    expect(files[0].header).toContain('@generated')
  })

  it('exposes turtle and namespace as artifacts', async () => {
    const { artifacts } = await generator.generate(richSchema, makeCtx())
    expect(typeof artifacts!['turtle']).toBe('string')
    expect(artifacts!['namespace']).toBe('https://example.com/library/')
  })

  describe('Turtle prefixes', () => {
    let turtle: string

    beforeEach(async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      turtle = files[0].content
    })

    it('declares rdf prefix', () => {
      expect(turtle).toContain('@prefix rdf:')
    })

    it('declares rdfs prefix', () => {
      expect(turtle).toContain('@prefix rdfs:')
    })

    it('declares owl prefix', () => {
      expect(turtle).toContain('@prefix owl:')
    })

    it('declares xsd prefix', () => {
      expect(turtle).toContain('@prefix xsd:')
    })

    it('declares dpvo prefix', () => {
      expect(turtle).toContain('@prefix dpvo:')
    })

    it('declares skos prefix', () => {
      expect(turtle).toContain('@prefix skos:')
    })

    it('declares colon prefix with namespace', () => {
      expect(turtle).toContain('@prefix :     <https://example.com/library/>')
    })
  })

  describe('ontology declaration', () => {
    let turtle: string

    beforeEach(async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      turtle = files[0].content
    })

    it('declares the ontology IRI', () => {
      expect(turtle).toContain('<https://example.com/library/>')
      expect(turtle).toContain('a owl:Ontology')
    })

    it('includes schema name as rdfs:label', () => {
      expect(turtle).toContain('"LibraryApp"')
    })

    it('includes description as rdfs:comment', () => {
      expect(turtle).toContain('Library management system')
    })

    it('includes version as owl:versionInfo', () => {
      expect(turtle).toContain('"1.0.0"')
    })
  })

  describe('meta classes', () => {
    let turtle: string

    beforeEach(async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      turtle = files[0].content
    })

    it('declares Behavior class', () => {
      expect(turtle).toContain('Behavior')
      expect(turtle).toContain('a owl:Class')
    })

    it('declares LifecycleState class', () => {
      expect(turtle).toContain('LifecycleState')
    })

    it('declares hasRule annotation property', () => {
      expect(turtle).toContain('hasRule')
      expect(turtle).toContain('owl:AnnotationProperty')
    })
  })

  describe('entity classes', () => {
    let turtle: string

    beforeEach(async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      turtle = files[0].content
    })

    it('declares each entity as owl:Class', () => {
      expect(turtle).toContain('<https://example.com/library/Book>')
      expect(turtle).toContain('<https://example.com/library/Member>')
    })

    it('labels entity with rdfs:label', () => {
      expect(turtle).toContain('"Book"')
      expect(turtle).toContain('"Member"')
    })

    it('includes entity description', () => {
      expect(turtle).toContain('A book in the catalogue')
    })

    it('includes entity goal via skos:definition', () => {
      expect(turtle).toContain('Track books from acquisition to retirement')
      expect(turtle).toContain('skos:definition')
    })
  })

  describe('datatype properties (fields)', () => {
    let turtle: string

    beforeEach(async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      turtle = files[0].content
    })

    it('declares each field as owl:DatatypeProperty', () => {
      expect(turtle).toContain('<https://example.com/library/Book_id>')
      expect(turtle).toContain('a owl:DatatypeProperty')
    })

    it('sets rdfs:domain to the owning entity', () => {
      expect(turtle).toContain('rdfs:domain <https://example.com/library/Book>')
    })

    it('maps uuid to xsd:string', () => {
      expect(turtle).toContain('xsd:string')
    })

    it('maps boolean to xsd:boolean', () => {
      expect(turtle).toContain('xsd:boolean')
    })

    it('maps integer to xsd:integer', () => {
      expect(turtle).toContain('xsd:integer')
    })

    it('maps decimal to xsd:decimal', () => {
      expect(turtle).toContain('xsd:decimal')
    })

    it('maps timestamp to xsd:dateTime', () => {
      expect(turtle).toContain('xsd:dateTime')
    })

    it('maps url to xsd:anyURI', () => {
      expect(turtle).toContain('xsd:anyURI')
    })

    it('annotates PII fields with dpvo:hasPersonalDataCategory', () => {
      expect(turtle).toContain('dpvo:hasPersonalDataCategory')
      expect(turtle).toContain('dpvo:PersonalData')
    })

    it('includes gdprCategory as DPVO category', () => {
      expect(turtle).toContain('dpvo:ContactData')
    })

    it('includes gdprRetention as dpvo:hasStorageDuration', () => {
      expect(turtle).toContain('dpvo:hasStorageDuration')
      expect(turtle).toContain('"5y"')
    })

    it('includes gdprLegalBasis as dpvo:hasLegalBasis', () => {
      expect(turtle).toContain('dpvo:hasLegalBasis')
      expect(turtle).toContain('dpvo:Consent')
    })

    it('maps contract legal basis to dpvo:Contract', () => {
      expect(turtle).toContain('dpvo:Contract')
    })
  })

  describe('object properties (relations)', () => {
    let turtle: string

    beforeEach(async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      turtle = files[0].content
    })

    it('declares relations as owl:ObjectProperty', () => {
      expect(turtle).toContain('<https://example.com/library/Book_loans>')
      expect(turtle).toContain('a owl:ObjectProperty')
    })

    it('sets rdfs:range to the target entity', () => {
      expect(turtle).toContain('rdfs:range <https://example.com/library/Loan>')
    })
  })

  describe('behavior individuals', () => {
    let turtle: string

    beforeEach(async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      turtle = files[0].content
    })

    it('declares behaviors as owl:NamedIndividual', () => {
      expect(turtle).toContain('<https://example.com/library/Book_borrow>')
      expect(turtle).toContain('a owl:NamedIndividual')
    })

    it('includes behavior description', () => {
      expect(turtle).toContain('Borrow a book')
    })

    it('includes rules via hasRule', () => {
      expect(turtle).toContain('Member must be active')
    })

    it('includes auth roles via requiresRole', () => {
      expect(turtle).toContain('requiresRole')
      expect(turtle).toContain('member')
    })
  })

  describe('state machine individuals', () => {
    let turtle: string

    beforeEach(async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      turtle = files[0].content
    })

    it('declares each state as LifecycleState individual', () => {
      expect(turtle).toContain('<https://example.com/library/Book_available>')
      expect(turtle).toContain('<https://example.com/library/Book_borrowed>')
    })

    it('marks the initial state', () => {
      expect(turtle).toContain('isInitial')
    })

    it('does not mark non-terminal states as terminal', () => {
      // "isTerminal true" only appears when a state is explicitly terminal
      expect(turtle).not.toContain('isTerminal> true')
    })
  })

  describe('namespace fallback', () => {
    it('falls back to schema.org-style URI when no namespace configured', async () => {
      const schema = { ...richSchema, meta: { name: 'MyApp', version: '1.0.0' } }
      const { artifacts } = await generator.generate(schema, makeCtx())
      expect(artifacts!['namespace']).toContain('MyApp')
    })
  })
})

import { OwlGenerator } from './index'
import type { FabricSchema, GeneratorContext, GeneratorOutput } from '@newel/core'

const NS = 'https://example.com/library/'

const makeCtx = (turtle = ''): GeneratorContext => ({
  outputDir: '/tmp/test-owl',
  outputs: new Map<string, GeneratorOutput>([
    ['rdf', {
      files: [{ path: 'rdf/ontology.ttl', content: turtle }],
      artifacts: { turtle, namespace: NS },
    }],
  ]),
})

const richSchema: FabricSchema = {
  version: '2.0.0',
  meta: { name: 'LibraryApp', version: '1.0.0', namespace: NS },
  entities: {
    Book: {
      name: 'Book',
      role: 'entity',
      description: 'A book in the catalogue',
      fields: {
        id:    { name: 'id',    type: 'uuid',   nullable: false, primaryKey: true,  pii: false },
        title: { name: 'title', type: 'string', nullable: false, primaryKey: false, pii: false },
        notes: { name: 'notes', type: 'string', nullable: true,  primaryKey: false, pii: false },
      },
      relations: {
        loans:  { name: 'loans',  kind: 'hasMany',    target: 'Loan',   foreignKey: 'bookId' },
        author: { name: 'author', kind: 'belongsTo',  target: 'Author', foreignKey: 'authorId' },
        cover:  { name: 'cover',  kind: 'hasOne',     target: 'Cover',  foreignKey: 'bookId' },
      },
      behaviors: {},
      stateMachine: {
        field: 'status',
        initial: 'available',
        states: {
          available: { name: 'available', description: 'On the shelf',  terminal: false },
          borrowed:  { name: 'borrowed',  description: 'With a member', terminal: false },
          retired:   { name: 'retired',   description: 'Decommissioned', terminal: true },
        },
        transitions: [
          { from: 'available', to: 'borrowed',  trigger: 'borrow',  guards: [], effects: [] },
          { from: 'borrowed',  to: 'available', trigger: 'return',  guards: [], effects: [] },
          { from: ['available', 'borrowed'], to: 'retired', trigger: 'retire', guards: [], effects: [] },
        ],
      },
      pii: [],
      gdpr: {},
    },
  },
  apis: {},
}

describe('OwlGenerator', () => {
  const generator = new OwlGenerator()

  it('has correct name', () => {
    expect(generator.name).toBe('owl')
  })

  it('depends on rdf', () => {
    expect(generator.dependsOn).toEqual(['rdf'])
  })

  it('produces exactly one file', async () => {
    const { files } = await generator.generate(richSchema, makeCtx())
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('owl/ontology.owl.ttl')
  })

  it('emits a @generated header', async () => {
    const { files } = await generator.generate(richSchema, makeCtx())
    expect(files[0].header).toContain('@generated')
  })

  describe('Turtle prefixes', () => {
    let owl: string

    beforeEach(async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      owl = files[0].content
    })

    it('declares rdf prefix', () => {
      expect(owl).toContain('@prefix rdf:')
    })

    it('declares owl prefix', () => {
      expect(owl).toContain('@prefix owl:')
    })

    it('declares xsd prefix', () => {
      expect(owl).toContain('@prefix xsd:')
    })

    it('declares colon prefix with namespace', () => {
      expect(owl).toContain(`@prefix :     <${NS}>`)
    })
  })

  describe('ontology declaration', () => {
    let owl: string

    beforeEach(async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      owl = files[0].content
    })

    it('declares the OWL ontology IRI', () => {
      expect(owl).toContain(`<${NS}owl>`)
      expect(owl).toContain('a owl:Ontology')
    })

    it('imports the RDF ontology', () => {
      expect(owl).toContain(`owl:imports <${NS}>`)
    })

    it('includes schema name in label', () => {
      expect(owl).toContain('LibraryApp')
    })
  })

  describe('transition annotation properties', () => {
    let owl: string

    beforeEach(async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      owl = files[0].content
    })

    it('declares fromState object property', () => {
      expect(owl).toContain('fromState')
      expect(owl).toContain('a owl:ObjectProperty')
    })

    it('declares toState object property', () => {
      expect(owl).toContain('toState')
    })
  })

  describe('cardinality restrictions', () => {
    let owl: string

    beforeEach(async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      owl = files[0].content
    })

    it('emits owl:Restriction blocks', () => {
      expect(owl).toContain('a owl:Restriction')
    })

    it('adds exactly-1 cardinality for primary key fields', () => {
      expect(owl).toContain('owl:qualifiedCardinality')
    })

    it('adds min-1 cardinality for required non-pk fields', () => {
      expect(owl).toContain('owl:minQualifiedCardinality')
    })

    it('does not emit cardinality for nullable fields', () => {
      // notes is nullable — should not appear in a min/exactly restriction
      const owlBook_notes = owl.indexOf('Book_notes')
      expect(owlBook_notes).toBe(-1)
    })
  })

  describe('inverse properties (hasMany / hasOne)', () => {
    let owl: string

    beforeEach(async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      owl = files[0].content
    })

    it('declares owl:inverseOf for hasMany relations', () => {
      expect(owl).toContain('owl:inverseOf')
      expect(owl).toContain('Book_loans')
    })

    it('declares inverse property domain and range', () => {
      expect(owl).toContain(`rdfs:domain <${NS}Loan>`)
    })

    it('declares owl:inverseOf for hasOne relations', () => {
      expect(owl).toContain('Book_cover')
    })
  })

  describe('functional properties (belongsTo)', () => {
    let owl: string

    beforeEach(async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      owl = files[0].content
    })

    it('marks belongsTo relations as owl:FunctionalProperty', () => {
      expect(owl).toContain('owl:FunctionalProperty')
      expect(owl).toContain('Book_author')
    })
  })

  describe('state machine lifecycle axioms', () => {
    let owl: string

    beforeEach(async () => {
      const { files } = await generator.generate(richSchema, makeCtx())
      owl = files[0].content
    })

    it('declares a named individual per transition', () => {
      expect(owl).toContain('Book_transition_available_borrowed')
      expect(owl).toContain('Book_transition_borrowed_available')
    })

    it('expands array "from" into separate transition individuals', () => {
      // retire transition has from: ['available', 'borrowed']
      expect(owl).toContain('Book_transition_available_retired')
      expect(owl).toContain('Book_transition_borrowed_retired')
    })

    it('uses trigger as rdfs:label for transition individuals', () => {
      expect(owl).toContain('"borrow"')
      expect(owl).toContain('"return"')
      expect(owl).toContain('"retire"')
    })

    it('links fromState and toState on each transition', () => {
      // generator uses full IRI predicates for fromState/toState
      expect(owl).toContain(`<${NS}fromState> <${NS}Book_available>`)
      expect(owl).toContain(`<${NS}toState> <${NS}Book_borrowed>`)
    })
  })

  describe('works without upstream RDF artifacts', () => {
    it('generates valid output even if rdf output is absent', async () => {
      const emptyCtx: GeneratorContext = {
        outputDir: '/tmp/test-owl',
        outputs: new Map(),
      }
      const { files } = await generator.generate(richSchema, emptyCtx)
      expect(files).toHaveLength(1)
      expect(files[0].content).toContain('owl:Ontology')
    })
  })
})

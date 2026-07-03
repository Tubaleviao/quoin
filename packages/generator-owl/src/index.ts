import type {
  Generator,
  GeneratorContext,
  GeneratorOutput,
  FabricSchema,
  EntitySchema,
  RelationSchema,
  StateMachineSchema,
} from '@quoin/core'

function ttlIri(ns: string, local: string): string {
  return `<${ns}${local}>`
}

// Cardinality restriction for a property on a class
function renderCardinalityRestriction(
  ns: string,
  entityName: string,
  propLocalName: string,
  cardinality: 'exactly' | 'min' | 'max',
  value: number,
  onDataRange?: string,
): string {
  const owlCard = cardinality === 'exactly'
    ? 'owl:qualifiedCardinality'
    : cardinality === 'min'
      ? 'owl:minQualifiedCardinality'
      : 'owl:maxQualifiedCardinality'
  const rangeKey = onDataRange ? 'owl:onDataRange' : 'owl:onClass'
  const rangeVal = onDataRange ?? ttlIri(ns, propLocalName.split('_')[1] ?? 'Thing')

  return [
    `${ttlIri(ns, entityName)}`,
    `  rdfs:subClassOf [`,
    `    a owl:Restriction ;`,
    `    owl:onProperty ${ttlIri(ns, `${entityName}_${propLocalName}`)} ;`,
    `    ${owlCard} "${value}"^^xsd:nonNegativeInteger ;`,
    `    ${rangeKey} ${rangeVal}`,
    `  ] .`,
  ].join('\n')
}

// Inverse object property
function renderInverseProperty(ns: string, entityName: string, rel: RelationSchema): string | null {
  if (rel.kind !== 'hasMany' && rel.kind !== 'hasOne') return null
  const fwdIri = ttlIri(ns, `${entityName}_${rel.name}`)
  const invIri = ttlIri(ns, `${rel.target}_${entityName.toLowerCase()}`)
  return [
    `${fwdIri} owl:inverseOf ${invIri} .`,
    `${invIri} a owl:ObjectProperty ; rdfs:label "${entityName.toLowerCase()}" ; rdfs:domain ${ttlIri(ns, rel.target)} ; rdfs:range ${ttlIri(ns, entityName)} .`,
  ].join('\n')
}

// owl:FunctionalProperty for belongsTo (many-to-one)
function renderFunctionalProperty(ns: string, entityName: string, rel: RelationSchema): string | null {
  if (rel.kind !== 'belongsTo') return null
  return `${ttlIri(ns, `${entityName}_${rel.name}`)} a owl:FunctionalProperty .`
}

// State machine lifecycle restrictions
function renderLifecycleAxioms(ns: string, entityName: string, sm: StateMachineSchema): string[] {
  const blocks: string[] = []

  // Each non-terminal state can transition to its successors
  for (const t of sm.transitions) {
    const froms = Array.isArray(t.from) ? t.from : [t.from]
    for (const from of froms) {
      const transIri = ttlIri(ns, `${entityName}_transition_${from}_${t.to}`)
      blocks.push([
        `${transIri}`,
        `  a owl:NamedIndividual ;`,
        `  rdfs:label "${t.trigger}" ;`,
        `  ${ttlIri(ns, 'fromState')} ${ttlIri(ns, `${entityName}_${from}`)} ;`,
        `  ${ttlIri(ns, 'toState')} ${ttlIri(ns, `${entityName}_${t.to}`)} .`,
      ].join('\n'))
    }
  }

  return blocks
}

function generateOwlAxioms(schema: FabricSchema, upstreamTurtle: string): string {
  const ns = schema.meta.namespace ?? `https://schema.org/${schema.meta.name}/`
  const blocks: string[] = []

  // Header — re-declare prefixes so this file is standalone
  blocks.push([
    `@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .`,
    `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`,
    `@prefix owl:  <http://www.w3.org/2002/07/owl#> .`,
    `@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .`,
    `@prefix :     <${ns}> .`,
  ].join('\n'))

  // Import the RDF ontology
  blocks.push([
    `<${ns}owl>`,
    `  a owl:Ontology ;`,
    `  owl:imports <${ns}> ;`,
    `  rdfs:label "${schema.meta.name} — OWL axioms" .`,
  ].join('\n'))

  // Extra annotation properties used for transitions
  blocks.push([
    `${ttlIri(ns, 'fromState')} a owl:ObjectProperty ; rdfs:label "fromState" .`,
    `${ttlIri(ns, 'toState')} a owl:ObjectProperty ; rdfs:label "toState" .`,
  ].join('\n'))

  for (const [entityName, entity] of Object.entries(schema.entities)) {
    // Cardinality: primary key field exists exactly once
    for (const field of Object.values(entity.fields)) {
      if (field.primaryKey) {
        blocks.push(renderCardinalityRestriction(ns, entityName, field.name, 'exactly', 1, 'xsd:string'))
      }
      // Nullable fields have max cardinality 1; required fields exactly 1
      else if (!field.nullable) {
        blocks.push(renderCardinalityRestriction(ns, entityName, field.name, 'min', 1, 'xsd:string'))
      }
    }

    for (const rel of Object.values(entity.relations)) {
      const inv = renderInverseProperty(ns, entityName, rel)
      if (inv) blocks.push(inv)

      const func = renderFunctionalProperty(ns, entityName, rel)
      if (func) blocks.push(func)
    }

    if (entity.stateMachine) {
      const lifecycleAxioms = renderLifecycleAxioms(ns, entityName, entity.stateMachine)
      for (const b of lifecycleAxioms) blocks.push(b)
    }
  }

  return blocks.join('\n\n') + '\n'
}

export class OwlGenerator implements Generator {
  readonly name = 'owl'
  readonly dependsOn: string[] = ['rdf']

  async generate(schema: FabricSchema, ctx: GeneratorContext): Promise<GeneratorOutput> {
    const rdfOutput = ctx.outputs.get('rdf')
    const upstreamTurtle = (rdfOutput?.artifacts?.['turtle'] as string | undefined) ?? ''

    const content = generateOwlAxioms(schema, upstreamTurtle)

    return {
      files: [
        {
          path: 'owl/ontology.owl.ttl',
          content,
          header: '# @generated by @quoin/generator-owl — do not edit\n',
        },
      ],
    }
  }
}

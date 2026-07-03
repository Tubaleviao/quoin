import type {
  Generator,
  GeneratorContext,
  GeneratorOutput,
  FabricSchema,
  EntitySchema,
  FieldSchema,
  RelationSchema,
  BehaviorSchema,
  StateMachineSchema,
} from '@quoin/core'

// XSD type mapping for RDF datatype properties
const XSD_MAP: Record<string, string> = {
  string:    'xsd:string',
  number:    'xsd:double',
  integer:   'xsd:integer',
  decimal:   'xsd:decimal',
  boolean:   'xsd:boolean',
  uuid:      'xsd:string',
  timestamp: 'xsd:dateTime',
  date:      'xsd:date',
  email:     'xsd:string',
  url:       'xsd:anyURI',
  json:      'xsd:string',
  enum:      'xsd:string',
}

function ttlIri(ns: string, local: string): string {
  return `<${ns}${local}>`
}

function ttlComment(text: string): string {
  return `# ${text.replace(/\n/g, '\n# ')}`
}

function renderEntityClass(ns: string, entity: EntitySchema): string {
  const iri = ttlIri(ns, entity.name)
  const lines: string[] = [
    `${iri}`,
    `  a owl:Class ;`,
    `  rdfs:label "${entity.name}" ;`,
  ]
  if (entity.description) lines.push(`  rdfs:comment "${entity.description.replace(/"/g, '\\"')}" ;`)
  if (entity.goal) lines.push(`  skos:definition "${entity.goal.replace(/"/g, '\\"')}" ;`)
  lines[lines.length - 1] = lines[lines.length - 1].replace(/ ;$/, ' .')
  return lines.join('\n')
}

function renderDatatypeProperty(ns: string, entityName: string, field: FieldSchema): string {
  const iri = ttlIri(ns, `${entityName}_${field.name}`)
  const xsdType = XSD_MAP[field.type] ?? 'xsd:string'
  const lines: string[] = [
    `${iri}`,
    `  a owl:DatatypeProperty ;`,
    `  rdfs:label "${field.name}" ;`,
    `  rdfs:domain ${ttlIri(ns, entityName)} ;`,
    `  rdfs:range ${xsdType} ;`,
  ]
  if (field.description) lines.push(`  rdfs:comment "${field.description.replace(/"/g, '\\"')}" ;`)
  if (field.pii) lines.push(`  dpvo:hasPersonalDataCategory dpvo:PersonalData ;`)
  if (field.gdprCategory) lines.push(`  dpvo:hasPersonalDataCategory dpvo:${capitalise(field.gdprCategory)}Data ;`)
  if (field.gdprRetention) lines.push(`  dpvo:hasStorageDuration "${field.gdprRetention}" ;`)
  if (field.gdprLegalBasis) lines.push(`  dpvo:hasLegalBasis dpvo:${legalBasisToOwl(field.gdprLegalBasis)} ;`)
  lines[lines.length - 1] = lines[lines.length - 1].replace(/ ;$/, ' .')
  return lines.join('\n')
}

function renderObjectProperty(ns: string, entityName: string, rel: RelationSchema): string {
  const iri = ttlIri(ns, `${entityName}_${rel.name}`)
  const lines: string[] = [
    `${iri}`,
    `  a owl:ObjectProperty ;`,
    `  rdfs:label "${rel.name}" ;`,
    `  rdfs:domain ${ttlIri(ns, entityName)} ;`,
    `  rdfs:range ${ttlIri(ns, rel.target)} ;`,
  ]
  lines[lines.length - 1] = lines[lines.length - 1].replace(/ ;$/, ' .')
  return lines.join('\n')
}

function renderBehaviorIndividual(ns: string, entityName: string, behavior: BehaviorSchema): string {
  const iri = ttlIri(ns, `${entityName}_${behavior.name}`)
  const lines: string[] = [
    `${iri}`,
    `  a owl:NamedIndividual, ${ttlIri(ns, 'Behavior')} ;`,
    `  rdfs:label "${behavior.name}" ;`,
  ]
  if (behavior.description) lines.push(`  rdfs:comment "${behavior.description.replace(/"/g, '\\"')}" ;`)
  for (const rule of behavior.rules) {
    lines.push(`  ${ttlIri(ns, 'hasRule')} "${rule.replace(/"/g, '\\"')}" ;`)
  }
  if (behavior.auth?.roles.length) {
    lines.push(`  ${ttlIri(ns, 'requiresRole')} "${behavior.auth.roles.join(', ')}" ;`)
  }
  lines[lines.length - 1] = lines[lines.length - 1].replace(/ ;$/, ' .')
  return lines.join('\n')
}

function renderStateMachineIndividuals(ns: string, entityName: string, sm: StateMachineSchema): string[] {
  const blocks: string[] = []

  for (const state of Object.values(sm.states)) {
    const iri = ttlIri(ns, `${entityName}_${state.name}`)
    const lines: string[] = [
      `${iri}`,
      `  a owl:NamedIndividual, ${ttlIri(ns, 'LifecycleState')} ;`,
      `  rdfs:label "${state.name}" ;`,
      `  rdfs:comment "${state.description.replace(/"/g, '\\"')}" ;`,
    ]
    if (state.terminal) lines.push(`  ${ttlIri(ns, 'isTerminal')} true ;`)
    if (state.name === sm.initial) lines.push(`  ${ttlIri(ns, 'isInitial')} true ;`)
    lines[lines.length - 1] = lines[lines.length - 1].replace(/ ;$/, ' .')
    blocks.push(lines.join('\n'))
  }

  return blocks
}

function legalBasisToOwl(lb: string): string {
  const map: Record<string, string> = {
    'consent': 'Consent',
    'contract': 'Contract',
    'legal-obligation': 'LegalObligation',
    'legitimate-interest': 'LegitimateInterest',
  }
  return map[lb] ?? lb
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function generateTurtle(schema: FabricSchema): string {
  const ns = schema.meta.namespace ?? `https://schema.org/${schema.meta.name}/`
  const blocks: string[] = []

  // Prefixes
  blocks.push([
    `@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .`,
    `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`,
    `@prefix owl:  <http://www.w3.org/2002/07/owl#> .`,
    `@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .`,
    `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .`,
    `@prefix dpvo: <https://w3id.org/dpv#> .`,
    `@prefix :     <${ns}> .`,
  ].join('\n'))

  // Ontology declaration
  blocks.push([
    `<${ns}>`,
    `  a owl:Ontology ;`,
    `  rdfs:label "${schema.meta.name}" ;`,
    schema.meta.description ? `  rdfs:comment "${schema.meta.description.replace(/"/g, '\\"')}" ;` : null,
    `  owl:versionInfo "${schema.meta.version ?? '1.0.0'}" .`,
  ].filter(Boolean).join('\n'))

  // Meta classes used by the ontology
  blocks.push([
    `${ttlIri(ns, 'Behavior')} a owl:Class ; rdfs:label "Behavior" .`,
    `${ttlIri(ns, 'LifecycleState')} a owl:Class ; rdfs:label "LifecycleState" .`,
    `${ttlIri(ns, 'hasRule')} a owl:AnnotationProperty ; rdfs:label "hasRule" .`,
    `${ttlIri(ns, 'requiresRole')} a owl:AnnotationProperty ; rdfs:label "requiresRole" .`,
    `${ttlIri(ns, 'isTerminal')} a owl:AnnotationProperty ; rdfs:label "isTerminal" .`,
    `${ttlIri(ns, 'isInitial')} a owl:AnnotationProperty ; rdfs:label "isInitial" .`,
  ].join('\n'))

  for (const [entityName, entity] of Object.entries(schema.entities)) {
    blocks.push(ttlComment(`--- Entity: ${entityName} ---`))
    blocks.push(renderEntityClass(ns, entity))

    for (const field of Object.values(entity.fields)) {
      blocks.push(renderDatatypeProperty(ns, entityName, field))
    }

    for (const rel of Object.values(entity.relations)) {
      blocks.push(renderObjectProperty(ns, entityName, rel))
    }

    for (const behavior of Object.values(entity.behaviors)) {
      blocks.push(renderBehaviorIndividual(ns, entityName, behavior))
    }

    if (entity.stateMachine) {
      const stateBlocks = renderStateMachineIndividuals(ns, entityName, entity.stateMachine)
      for (const b of stateBlocks) blocks.push(b)
    }
  }

  return blocks.join('\n\n') + '\n'
}

export class RdfGenerator implements Generator {
  readonly name = 'rdf'
  readonly dependsOn: string[] = []

  async generate(schema: FabricSchema, _ctx: GeneratorContext): Promise<GeneratorOutput> {
    const content = generateTurtle(schema)

    return {
      files: [
        {
          path: 'rdf/ontology.ttl',
          content,
          header: '# @generated by @quoin/generator-rdf — do not edit\n',
        },
      ],
      artifacts: {
        turtle: content,
        namespace: schema.meta.namespace ?? `https://schema.org/${schema.meta.name}/`,
      },
    }
  }
}

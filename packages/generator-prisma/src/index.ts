import type {
  Generator,
  GeneratorContext,
  GeneratorOutput,
  FabricSchema,
  EntitySchema,
  FieldSchema,
  RelationSchema,
} from '@quoin/core'

// --- Naming helpers ---

function lcFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

function toSnakeCase(s: string): string {
  return s.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
}

function tableName(name: string): string {
  // Prisma uses PascalCase model names; snake_case is the @map table convention
  const snake = toSnakeCase(name)
  if (snake.endsWith('s')) return snake
  if (snake.endsWith('y') && !/[aeiou]y$/.test(snake)) return snake.slice(0, -1) + 'ies'
  return snake + 's'
}

// --- Field type mapping: quoin IR → Prisma scalar ---

const PRISMA_TYPE_MAP: Record<string, string> = {
  string:    'String',
  number:    'Float',
  integer:   'Int',
  decimal:   'Decimal',
  boolean:   'Boolean',
  uuid:      'String',
  timestamp: 'DateTime',
  date:      'DateTime',
  email:     'String',
  url:       'String',
  json:      'Json',
}

function fieldToPrismaType(entityName: string, field: FieldSchema): string {
  if (field.type === 'enum' && field.enumValues) {
    return `${entityName}${field.name.charAt(0).toUpperCase() + field.name.slice(1)}Enum`
  }
  return PRISMA_TYPE_MAP[field.type] ?? 'String'
}

// --- Prisma schema generation ---

function renderPrismaEnum(entityName: string, field: FieldSchema): string {
  const enumName = `${entityName}${field.name.charAt(0).toUpperCase() + field.name.slice(1)}Enum`
  const members = (field.enumValues ?? []).map(v => `  ${v.toUpperCase().replace(/-/g, '_')}`).join('\n')
  return `enum ${enumName} {\n${members}\n}`
}

function renderPrismaField(entityName: string, field: FieldSchema): string {
  const prismaType = fieldToPrismaType(entityName, field)
  const optional = field.nullable ? '?' : ''
  const attrs: string[] = []

  if (field.primaryKey) attrs.push('@id')
  if (field.primaryKey && field.type === 'uuid') attrs.push('@default(uuid())')
  if (field.type === 'timestamp' && field.name === 'createdAt') attrs.push('@default(now())')

  const colName = toSnakeCase(field.name)
  if (colName !== field.name) attrs.push(`@map("${colName}")`)

  const attrStr = attrs.length > 0 ? `  ${attrs.join(' ')}` : ''
  return `  ${field.name}  ${prismaType}${optional}${attrStr}`
}

function renderRelationField(rel: RelationSchema, entity: EntitySchema): string[] {
  const lines: string[] = []
  switch (rel.kind) {
    case 'hasMany':
    case 'manyToMany':
      lines.push(`  ${rel.name}  ${rel.target}[]`)
      break
    case 'hasOne':
      lines.push(`  ${rel.name}  ${rel.target}?`)
      break
    case 'belongsTo': {
      // The FK field is already emitted as a scalar; add the relation field + @relation
      const fkField = rel.foreignKey ?? `${lcFirst(rel.target)}Id`
      lines.push(`  ${rel.name}  ${rel.target}  @relation(fields: [${fkField}], references: [id])`)
      break
    }
  }
  return lines
}

function renderPrismaModel(entityName: string, entity: EntitySchema): string {
  const lines: string[] = [`model ${entityName} {`]

  for (const field of Object.values(entity.fields)) {
    lines.push(renderPrismaField(entityName, field))
  }

  for (const rel of Object.values(entity.relations)) {
    const relLines = renderRelationField(rel, entity)
    lines.push(...relLines)
  }

  const table = tableName(entityName)
  lines.push(``)
  lines.push(`  @@map("${table}")`)
  lines.push(`}`)
  return lines.join('\n')
}

function generatePrismaSchema(schema: FabricSchema): string {
  const blocks: string[] = [
    `// Generated from ${schema.meta.name} v${schema.meta.version ?? '1.0.0'}`,
    ``,
    `generator client {`,
    `  provider = "prisma-client-js"`,
    `}`,
    ``,
    `datasource db {`,
    `  provider = "postgresql"`,
    `  url      = env("DATABASE_URL")`,
    `}`,
    ``,
  ]

  // Enums first
  for (const [name, entity] of Object.entries(schema.entities)) {
    for (const field of Object.values(entity.fields)) {
      if (field.type === 'enum' && field.enumValues) {
        blocks.push(renderPrismaEnum(name, field))
        blocks.push(``)
      }
    }
  }

  // Models
  for (const [name, entity] of Object.entries(schema.entities)) {
    blocks.push(renderPrismaModel(name, entity))
    blocks.push(``)
  }

  return blocks.join('\n')
}

// --- client.ts ---

function generateClientFile(): string {
  return [
    `import { PrismaClient } from '@prisma/client'`,
    ``,
    `const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }`,
    ``,
    `export const prisma = globalForPrisma.prisma ?? new PrismaClient()`,
    ``,
    `if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma`,
    ``,
    `export default prisma`,
    ``,
  ].join('\n')
}

// --- repository.ts ---

function tsFieldType(field: FieldSchema): string {
  if (field.type === 'enum' && field.enumValues) {
    return field.enumValues.map(v => JSON.stringify(v)).join(' | ')
  }
  const map: Record<string, string> = {
    string: 'string', number: 'number', integer: 'number', decimal: 'number',
    boolean: 'boolean', uuid: 'string', timestamp: 'Date', date: 'Date',
    email: 'string', url: 'string', json: 'unknown',
  }
  return map[field.type] ?? 'unknown'
}

function generateCreateData(entity: EntitySchema): string {
  const fields = Object.values(entity.fields).filter(f => !f.primaryKey)
  const lines = fields.map(f => {
    const optional = f.nullable ? '?' : ''
    return `    ${f.name}${optional}: ${tsFieldType(f)}`
  })
  return `{\n${lines.join('\n')}\n  }`
}

function generateUpdateData(entity: EntitySchema): string {
  const fields = Object.values(entity.fields).filter(f => !f.primaryKey)
  const lines = fields.map(f => `    ${f.name}?: ${tsFieldType(f)}`)
  return `{\n${lines.join('\n')}\n  }`
}

function generateRepositoryClass(entityName: string, entity: EntitySchema): string {
  const client = lcFirst(entityName)
  const idField = Object.values(entity.fields).find(f => f.primaryKey)
  const idType = idField ? tsFieldType(idField) : 'string'
  const createData = generateCreateData(entity)
  const updateData = generateUpdateData(entity)

  const lines: string[] = [
    `export class ${entityName}Repository {`,
    `  findById(id: ${idType}) {`,
    `    return prisma.${client}.findUniqueOrThrow({ where: { id } })`,
    `  }`,
    ``,
    `  findAll() {`,
    `    return prisma.${client}.findMany()`,
    `  }`,
    ``,
    `  create(data: ${createData}) {`,
    `    return prisma.${client}.create({ data })`,
    `  }`,
    ``,
    `  update(id: ${idType}, data: ${updateData}) {`,
    `    return prisma.${client}.update({ where: { id }, data })`,
    `  }`,
    ``,
    `  delete(id: ${idType}) {`,
    `    return prisma.${client}.delete({ where: { id } })`,
    `  }`,
  ]

  // Behavior methods — one per behavior, focused on state transitions
  if (entity.stateMachine) {
    for (const [triggerName, behavior] of Object.entries(entity.behaviors)) {
      const transition = entity.stateMachine.transitions.find(t => t.trigger === triggerName)
      if (!transition) continue

      const toState = transition.to
      const stateField = entity.stateMachine.field
      const methodLines: string[] = [``, `  async ${triggerName}(id: ${idType}): Promise<ReturnType<typeof prisma.${client}.update>> {`]

      for (const rule of behavior.rules) {
        methodLines.push(`    // Rule: ${rule}`)
      }

      // Fetch-then-guard comment pattern
      methodLines.push(`    const entity = await this.findById(id)`)
      const fromStates = Array.isArray(transition.from) ? transition.from : [transition.from]
      const fromList = fromStates.map(s => JSON.stringify(s)).join(' | ')
      methodLines.push(`    if (!(${fromStates.map(s => `entity.${stateField} === ${JSON.stringify(s)}`).join(' || ')})) {`)
      methodLines.push(`      throw new Error(\`${triggerName}: entity must be in state ${fromList} but is \${entity.${stateField}}\`)`)
      methodLines.push(`    }`)

      if (behavior.rules && behavior.rules.length > 0) {
        for (const rule of behavior.rules) {
          methodLines.push(`    // TODO guard: ${rule}`)
        }
      }

      methodLines.push(`    return prisma.${client}.update({ where: { id }, data: { ${stateField}: ${JSON.stringify(toState)} } })`)
      methodLines.push(`  }`)
      lines.push(...methodLines)
    }
  }

  lines.push(`}`)
  lines.push(``)
  lines.push(`export const ${client}Repository = new ${entityName}Repository()`)
  return lines.join('\n')
}

function generateRepositoryFile(schema: FabricSchema): string {
  const lines: string[] = [
    `import { prisma } from './client'`,
    ``,
  ]

  for (const [name, entity] of Object.entries(schema.entities)) {
    lines.push(generateRepositoryClass(name, entity))
    lines.push(``)
  }

  return lines.join('\n')
}

// --- Generator ---

export class PrismaGenerator implements Generator {
  readonly name = 'prisma'
  readonly dependsOn: string[] = ['typescript']

  async generate(schema: FabricSchema, _ctx: GeneratorContext): Promise<GeneratorOutput> {
    return {
      files: [
        {
          path: 'prisma/schema.prisma',
          content: generatePrismaSchema(schema),
          header: '// @generated by @quoin/generator-prisma — do not edit\n',
        },
        {
          path: 'prisma/client.ts',
          content: generateClientFile(),
          header: '// @generated by @quoin/generator-prisma — do not edit\n',
        },
        {
          path: 'prisma/repository.ts',
          content: generateRepositoryFile(schema),
          header: '// @generated by @quoin/generator-prisma — do not edit\n',
        },
      ],
    }
  }
}

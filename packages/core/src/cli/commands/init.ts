import * as fs from 'fs'
import * as path from 'path'

const FABRIC_TEMPLATE = `import { defineFabric, defineEntity, defineApi } from '@quoin/core'

export default defineFabric({
  meta: {
    name: 'MyApp',
    description: 'My application',
    version: '1.0.0',
  },

  entities: {
    // Define your entities here. Each entity maps to a database table and
    // generates TypeScript interfaces, Zod schemas, SQL DDL, and more.
    User: defineEntity({
      description: 'A registered user of the application',

      fields: {
        id:        { type: 'uuid',      primaryKey: true },
        email:     { type: 'email',     pii: true, gdpr: { category: 'contact', legalBasis: 'contract' } },
        name:      { type: 'string',    pii: true, gdpr: { category: 'identity' } },
        status:    { type: 'enum',      values: ['active', 'suspended'] },
        createdAt: { type: 'timestamp' },
      },

      // Declare state machines for fields that have a lifecycle.
      stateMachine: {
        field: 'status',
        initial: 'active',
        states: {
          active:    'User can log in and perform actions',
          suspended: { description: 'Account suspended by admin', terminal: false },
        },
        transitions: [
          { from: 'active',    to: 'suspended', trigger: 'suspend',   guard: 'Only admins may suspend users' },
          { from: 'suspended', to: 'active',    trigger: 'reinstate', guard: 'Only admins may reinstate users' },
        ],
      },

      // Behaviors are named operations the entity supports.
      behaviors: {
        suspend: {
          description: 'Suspend the user account',
          rules: ['Only admins may suspend users'],
          input: { reason: { type: 'string', description: 'Why the account was suspended' } },
          auth: { roles: ['admin'] },
        },
        reinstate: {
          description: 'Re-activate a suspended account',
          rules: ['Only admins may reinstate users'],
          auth: { roles: ['admin'] },
        },
      },
    }),
  },

  apis: {
    // Define REST API surfaces. Each endpoint can reference a behavior or
    // declare what entity type it returns.
    UserAPI: defineApi({
      baseUrl: '/users',
      endpoints: {
        'GET /':        { returns: 'User',  description: 'List all users',   auth: { roles: ['admin'] } },
        'GET /:id':     { returns: 'User',  description: 'Get a user',       auth: { roles: ['admin', 'user'] } },
        'POST /:id/suspend': { behavior: 'User.suspend',    description: 'Suspend a user account' },
        'POST /:id/reinstate': { behavior: 'User.reinstate', description: 'Reinstate a user account' },
      },
    }),
  },
})
`

const CONFIG_TEMPLATE = `import { defineConfig } from '@quoin/core'
import { TypeScriptGenerator } from '@quoin/generator-typescript'

export default defineConfig({
  schema: './src/fabric.ts',
  output: './src/generated',
  generators: [
    new TypeScriptGenerator(),
    // Add more generators here:
    // new OpenApiGenerator() from '@quoin/generator-openapi'
    // new SqlGenerator()    from '@quoin/generator-sql'
  ],
})
`

export async function initCommand(targetDir: string): Promise<void> {
  const srcDir = path.join(targetDir, 'src')
  const fabricPath = path.join(srcDir, 'fabric.ts')
  const configPath = path.join(targetDir, 'quoin.config.ts')

  const conflicts: string[] = []
  if (fs.existsSync(fabricPath)) conflicts.push(fabricPath)
  if (fs.existsSync(configPath)) conflicts.push(configPath)

  if (conflicts.length > 0) {
    console.error('✗ init aborted — the following files already exist:')
    for (const f of conflicts) console.error(`  ${f}`)
    console.error('  Delete them or run init in an empty directory.')
    process.exit(1)
  }

  fs.mkdirSync(srcDir, { recursive: true })
  fs.writeFileSync(fabricPath, FABRIC_TEMPLATE)
  fs.writeFileSync(configPath, CONFIG_TEMPLATE)

  console.log('✓ Initialized quoin project:')
  console.log(`  ${path.relative(process.cwd(), fabricPath)}  — edit this to describe your application`)
  console.log(`  ${path.relative(process.cwd(), configPath)}  — configure generators here`)
  console.log('')
  console.log('Next steps:')
  console.log('  quoin validate    — check your fabric for errors')
  console.log('  quoin inspect     — view the resolved IR as JSON')
  console.log('  quoin generate    — generate all artifacts')
}

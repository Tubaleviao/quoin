# newel

Write one file. Generate everything.

**newel** is a TypeScript library + CLI that lets you describe your entire application — its data model, behaviors, state machines, and API — in a single declarative `fabric.ts` file, then automatically generate all the artifacts you need: TypeScript types, Zod schemas, SQL migrations, OpenAPI specs, Markdown docs, GDPR data maps, RDF/OWL ontologies, and more.

---

## Why newel?

| Tool | Data shape | DB + client | Behavior | Semantic meaning |
|------|:---:|:---:|:---:|:---:|
| LinkML | ✅ | ❌ | ❌ | ✅ |
| Prisma | ✅ | ✅ | ❌ | ❌ |
| XState | ❌ | ❌ | ✅ | ❌ |
| **newel** | ✅ | ✅ | ✅ | ✅ |

---

## Getting started

### Scaffold a new project (recommended)

Run the interactive scaffold — no global install required:

```bash
npx create-newel-app my-app
# or
pnpm create newel-app my-app
```

The wizard asks a few questions:

```
  create-newel-app — scaffold a newel project

  ✔ Project name          › my-app
  ✔ Short description     › My newel application
  ✔ Generators            › Full-stack — App scaffold (Express + React + Prisma)
  ✔ Package manager       › pnpm
  ✔ Install dependencies? › Yes
```

It then creates:

| File | Purpose |
|------|---------|
| `package.json` | Scripts + all required dependencies for the chosen generators |
| `newel.config.ts` | Generator configuration wired up and ready |
| `src/fabric.ts` | Starter schema with a `User` entity and state machine |
| `tsconfig.json` | TypeScript configuration |
| `.gitignore` | Ignores `node_modules/`, `dist/`, and `src/generated/` |

**Available presets:**

| Preset | Included generators |
|--------|---------------------|
| Minimal | `typescript` |
| API | `typescript`, `openapi`, `sql` |
| Full-stack | `typescript`, `openapi`, `sql`, `ui`, `prisma`, `express`, `app` |
| Semantic / data | `typescript`, `rdf`, `owl`, `jsonschema` |
| Custom | Pick any combination interactively |

After scaffolding:

```bash
cd my-app
newel generate       # generate all artifacts
# if you chose a full-stack preset:
pnpm run setup       # run Prisma migrations
pnpm run dev         # start Express + Vite dev servers
```

---

## Manual installation

For adding newel to an existing project, install as dev dependencies:

```bash
npm install -D @newel/core @newel/generator-typescript
# or
pnpm add -D @newel/core @newel/generator-typescript
```

---

## Quick start

### 1. Write your entity files

Split your schema across files using `defineEntity` and `defineApi` helpers — they are identity functions whose only job is to give you IDE completions and type checking.

**`src/entities/User.ts`**

```typescript
import { defineEntity } from '@newel/core'

export default defineEntity({
  description: 'A registered user',
  goal: 'Track user identity and authentication state',
  fields: {
    id:        { type: 'uuid',      primaryKey: true },
    email:     { type: 'string',    pii: true, gdpr: { category: 'contact', retention: '7y', legalBasis: 'contract' } },
    name:      { type: 'string' },
    status:    { type: 'enum',      values: ['active', 'suspended', 'deleted'] },
    createdAt: { type: 'timestamp' },
  },
  stateMachine: {
    field: 'status',
    initial: 'active',
    states: {
      active:    'User can log in and use the app',
      suspended: 'Temporarily blocked',
      deleted:   { description: 'Soft-deleted, data retained for compliance', terminal: true },
    },
    transitions: [
      { from: 'active',               to: 'suspended', trigger: 'suspend',   guard: 'Only an admin may suspend a user' },
      { from: 'suspended',            to: 'active',    trigger: 'reinstate', guard: 'Only an admin may reinstate a user' },
      { from: ['active', 'suspended'], to: 'deleted',  trigger: 'delete',    effect: 'Anonymises PII fields after retention period' },
    ],
  },
  behaviors: {
    suspend:   { description: 'Temporarily blocks a user', rules: ['Only an admin may suspend a user'], auth: { roles: ['admin'] } },
    reinstate: { description: 'Restores access for a suspended user', rules: ['Only an admin may reinstate a user'], auth: { roles: ['admin'] } },
    delete:    { description: 'Soft-deletes a user account', auth: { roles: ['admin'] } },
  },
})
```

**`src/apis/UserAPI.ts`**

```typescript
import { defineApi } from '@newel/core'

export default defineApi({
  endpoints: {
    'GET /users/:id':            { returns: 'User',          auth: { roles: ['admin'] } },
    'POST /users/:id/suspend':   { behavior: 'User.suspend' },
    'POST /users/:id/reinstate': { behavior: 'User.reinstate' },
    'DELETE /users/:id':         { behavior: 'User.delete' },
  },
})
```

### 2. Write `src/fabric.ts`

This is the root entry point that assembles your entities and APIs. It is never generated.

```typescript
import { defineFabric } from '@newel/core'
import User    from './entities/User'
import UserAPI from './apis/UserAPI'

export default defineFabric({
  meta: { name: 'MyApp', version: '1.0.0', description: 'My application schema' },
  entities: { User },
  apis: { UserAPI },
})
```

### 3. Create `newel.config.ts` in your project root

```typescript
import { defineConfig } from '@newel/core'
import { TypeScriptGenerator } from '@newel/generator-typescript'

export default defineConfig({
  schema: './src/fabric.ts',
  output: './src/generated',
  generators: [
    new TypeScriptGenerator(),
  ],
})
```

### 4. Add scripts to `package.json`

Run newel through your local install, not `npx`, so you always use the exact version you have pinned.

```json
{
  "scripts": {
    "validate":    "newel validate    -s ./src/fabric.ts",
    "inspect":     "newel inspect     -s ./src/fabric.ts",
    "generate":    "newel generate    -c ./newel.config.ts",
    "diff":        "newel diff        -c ./newel.config.ts",
    "check-drift": "newel check-drift -c ./newel.config.ts"
  }
}
```

Then run:

```bash
# Validate fabric.ts — no files written
npm run validate

# Print the full Internal Representation as JSON
npm run inspect

# Generate all artifacts
npm run generate

# Preview what generate would change without writing files
npm run diff

# Check if any generated file was manually edited
npm run check-drift
```

After `generate`, `src/generated/typescript/index.ts` will contain:

```typescript
// @generated by @newel/generator-typescript — do not edit

import { z } from 'zod'

// #region User
export enum UserState {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DELETED = 'deleted',
}

export interface User {
  id: string
  email: string
  name: string
  status: 'active' | 'suspended' | 'deleted'
  createdAt: Date
}

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  status: z.enum(['active', 'suspended', 'deleted']),
  createdAt: z.date(),
})
// #endregion User
```

---

## Available generators

| Package | Output | Depends on |
|---------|--------|------------|
| `@newel/generator-typescript` | TS interfaces + Zod schemas | — |
| `@newel/generator-openapi` | OpenAPI 3.x YAML with auto-transition endpoints | `typescript` |
| `@newel/generator-sql` | Safe incremental SQL migrations via IR diff | `typescript` |
| `@newel/generator-docs` | Markdown docs + GDPR data map | `openapi`, `typescript` |
| `@newel/generator-jsonschema` | JSON Schema draft-07 per entity | — |
| `@newel/generator-rdf` | RDF/Turtle ontology | — |
| `@newel/generator-owl` | OWL ontology (extends RDF output) | `rdf` |
| `@newel/generator-ui` | React forms + state-machine-aware action buttons | `typescript` |
| `@newel/generator-prisma` | Prisma schema + typed repositories | `typescript` |
| `@newel/generator-express` | Express router + typed handlers | `typescript` (or `prisma`) |
| `@newel/generator-app` | Full-stack scaffold (Express + Vite React) | `express`, `prisma`, `ui` |

---

## Entity roles (`ConceptRole`)

Every entity carries a `role` field that discriminates application entities from domain-specific concepts such as items in a game or simulation. The default is `'entity'`, so existing fabrics are unaffected.

```typescript
export default defineEntity({
  role: 'creature',   // 'entity' | 'material' | 'item' | 'creature' | 'biome' | 'system'
  description: 'A living creature in the world',
  fields: { ... },
})
```

Generators can use `role` to vary their output — for example, `generator-sql` can omit tables for `'system'` concepts that have no persisted state.

---

## Examples

Two worked examples are included in the repo under `examples/`:

| Example | Description |
|---------|-------------|
| `examples/library/` | Full-stack library management system — uses all generators including `ui`, `prisma`, `express`, and `app` |
| `examples/rest-api/` | Order management REST API — uses `typescript`, `openapi`, `sql`, `docs`, `jsonschema`, `rdf`, `owl` |

To run an example after building the monorepo:

```bash
cd examples/library   # or examples/rest-api
pnpm install
pnpm validate         # validate the fabric — no files written
pnpm generate         # generate all artifacts
```

---

## Writing a custom generator

Any package can implement the `Generator` interface:

```typescript
import type { Generator, GeneratorContext, GeneratorOutput, FabricSchema } from '@newel/core'

export class MyGenerator implements Generator {
  readonly name = 'my-generator'
  readonly dependsOn: string[] = [] // or ['typescript'] to receive its output

  async generate(schema: FabricSchema, ctx: GeneratorContext): Promise<GeneratorOutput> {
    const lines = Object.values(schema.entities).map(e => `entity: ${e.name}`)
    return {
      files: [{
        path: 'my-output/entities.txt',
        content: lines.join('\n'),
        header: '# @generated — do not edit\n',
      }],
    }
  }
}
```

Register it in `newel.config.ts`:

```typescript
import { defineConfig } from '@newel/core'
import { MyGenerator } from './my-generator'

export default defineConfig({
  schema: './src/fabric.ts',
  output: './src/generated',
  generators: [new MyGenerator()],
})
```

Generators declare `dependsOn` to access upstream outputs via `ctx.outputs`. The runner builds a DAG, topologically sorts it, and fails fast on circular dependencies.

---

## Design principles

1. **One source of truth.** `fabric.ts` is the only file that describes what your application is. Nothing else is authoritative.
2. **Generated files are never edited.** Every generated file carries a `@generated` header. The `check-drift` command enforces this.
3. **Customize without touching generated files.** Write a `fabric.patches.ts` to override field metadata, suppress files, or append imports. The runner applies patches to the IR before generation — drift detection stays meaningful.
4. **No runtime dependency.** `fabric.ts` exports a plain object. The CLI reads it at generation time. Your application never imports `@newel/core` at runtime.
5. **Declarative by design.** Guards, effects, and rules are strings — meaning, not code. Generators interpret them however they need to. Transition guards are automatically derived from their linked behavior's rules, eliminating duplication.
6. **Safe incremental migrations.** The SQL generator diffs IR snapshots across runs — new columns, enum additions, and renames are detected; dropped columns go to a `-- MANUAL REVIEW` block rather than being silently dropped.
7. **Open generator ecosystem.** Publish `newel-generator-*` to npm. The runner discovers generators through `newel.config.ts` — no registration required.

---

## License

MIT

# semantic-fabric — Development Plan

## What it is

A TypeScript library that lets you write a single source-of-truth file describing
everything your application *is*, *does*, and *means* — then generate all artifacts
from it automatically.

The closest existing tools:
- **LinkML** — describes how data looks, not what it does
- **Prisma** — describes data and generates DB + client, no behavior
- **XState** — models state machines, no data or API layer

**semantic-fabric** covers all three, declaratively, in one file, with full semantic
meaning attached to every construct.

---

## Core Concept: The Internal Representation (IR)

The IR is the heart of the library. It is a plain, serializable TypeScript object —
the stable contract between the builder DSL and every generator. Generators never
import from the builder; they only consume the IR.

This means:
- Generators can be written in any language that can parse JSON
- The IR can be versioned independently from the DSL
- The IR can itself be output (as JSON-LD, OWL, RDF, JSON Schema)

### IR top-level shape

```typescript
interface FabricSchema {
  version: string
  meta: SchemaMeta
  entities: Record<string, EntitySchema>
  apis: Record<string, ApiSchema>
  events?: Record<string, EventSchema>        // future: queues, topics
  graphs?: Record<string, GraphSchema>        // future: GraphQL
}

interface EntitySchema {
  name: string
  description: string
  goal?: string
  fields: Record<string, FieldSchema>
  relations: Record<string, RelationSchema>
  behaviors: Record<string, BehaviorSchema>
  stateMachine?: StateMachineSchema
  pii: string[]                               // field names marked as PII
  gdpr: Record<string, GdprCategory>          // field name → GDPR category
}

interface StateMachineSchema {
  field: string                               // the field that holds state
  initial: string
  states: Record<string, StateSchema>
  transitions: TransitionSchema[]
}

interface StateSchema {
  description: string
  terminal?: boolean
}

interface TransitionSchema {
  from: string | string[]
  to: string
  trigger: string                             // name of the behavior that causes this
  guard?: string                              // declarative rule that must be true
  effect?: string                             // declarative description of what happens
}

interface BehaviorSchema {
  name: string
  description: string
  rules: string[]                             // declarative invariants
  input?: Record<string, FieldSchema>
  output?: string                             // entity name or primitive
  auth?: AuthSchema
  transitions?: string[]                      // transition names this behavior can trigger
}
```

---

## Two User-Editable Files

### 1. `fabric.ts` — the source of truth

The only file that describes what the application *is*. Users write this. It is never
generated.

```typescript
import { fabric } from '@semantic-fabric/core'

export default fabric()
  .entity('Order', e => e
    .description('A customer purchase request')
    .goal('Track the full lifecycle of a purchase from placement to fulfillment')

    .field('id', f => f.uuid().primaryKey())
    .field('status', f => f.enum(['draft','placed','paid','shipped','delivered','cancelled'])
      .description('Current lifecycle state of the order'))
    .field('totalAmount', f => f.decimal().description('Sum of all line item prices'))
    .field('customerId', f => f.uuid().foreignKey('Customer.id'))
    .field('placedAt', f => f.timestamp().nullable())
    .field('cancelledAt', f => f.timestamp().nullable())
    .field('cancellationReason', f => f.string().nullable())

    .stateMachine('status', sm => sm
      .initial('draft')
      .state('draft',      s => s.description('Order created but not submitted'))
      .state('placed',     s => s.description('Order submitted by customer'))
      .state('paid',       s => s.description('Payment confirmed'))
      .state('shipped',    s => s.description('Package handed to carrier'))
      .state('delivered',  s => s.description('Package received by customer').terminal())
      .state('cancelled',  s => s.description('Order cancelled').terminal())

      .transition(t => t
        .from('draft').to('placed').trigger('placeOrder')
        .guard('Order must have at least one line item')
        .guard('Customer must have a valid shipping address')
        .effect('Sets placedAt to current timestamp'))
      .transition(t => t
        .from('placed').to('paid').trigger('confirmPayment')
        .guard('Payment amount must match order total')
        .effect('Triggers inventory reservation'))
      .transition(t => t
        .from(['draft', 'placed']).to('cancelled').trigger('cancel')
        .guard('Only the owning customer or an admin may cancel')
        .effect('Sets cancelledAt and cancellationReason'))
    )

    .behavior('placeOrder', b => b
      .description('Submits a draft order for processing')
      .rule('Order must have at least one line item')
      .rule('Customer must have a valid shipping address')
      .auth(a => a.roles('customer', 'admin'))
    )
    .behavior('confirmPayment', b => b
      .description('Records successful payment for an order')
      .rule('Payment amount must match order total')
      .auth(a => a.roles('payment-service'))
    )
    .behavior('cancel', b => b
      .description('Cancels an order and records the reason')
      .input('reason', f => f.string().description('Why the order was cancelled'))
      .rule('Only the owning customer or an admin may cancel')
      .auth(a => a.roles('customer', 'admin'))
    )

    .relation('lineItems', r => r.hasMany('LineItem').foreignKey('orderId'))
    .relation('customer',  r => r.belongsTo('Customer').foreignKey('customerId'))
  )

  .api('OrderAPI', a => a
    .endpoint('POST /orders', ep => ep
      .behavior('Order.placeOrder')
      .description('Place a new order'))
    .endpoint('POST /orders/:id/pay', ep => ep
      .behavior('Order.confirmPayment'))
    .endpoint('DELETE /orders/:id', ep => ep
      .behavior('Order.cancel'))
    .endpoint('GET /orders/:id', ep => ep
      .returns('Order')
      .auth(a => a.roles('customer', 'admin')))
  )
```

### 2. `semantic-fabric.config.ts` — generator configuration

Describes which generators to run and where output goes. Users edit this. It does
not affect meaning — only artifact production.

```typescript
import { defineConfig } from '@semantic-fabric/core'
import { TypeScriptGenerator } from '@semantic-fabric/generator-typescript'
import { SQLGenerator }        from '@semantic-fabric/generator-sql'
import { OpenAPIGenerator }    from '@semantic-fabric/generator-openapi'
import { DocsGenerator }       from '@semantic-fabric/generator-docs'

export default defineConfig({
  schema: './src/fabric.ts',
  output: './src/generated',
  generators: [
    new TypeScriptGenerator({ outDir: 'types' }),
    new SQLGenerator({
      dialect: 'postgresql',
      outDir: 'migrations',
      // dependsOn: ['typescript']  // implicit, declared inside the generator
    }),
    new OpenAPIGenerator({ outDir: 'openapi' }),
    new DocsGenerator({ outDir: 'docs', format: 'markdown' }),
  ]
})
```

---

## Generator Contract

The stable interface every generator must implement:

```typescript
interface Generator {
  readonly name: string
  readonly dependsOn: string[]

  generate(
    schema: FabricSchema,
    ctx: GeneratorContext
  ): Promise<GeneratorOutput>
}

interface GeneratorContext {
  outputDir: string
  outputs: Map<string, GeneratorOutput>   // upstream generator results by name
}

interface GeneratorOutput {
  files: GeneratedFile[]
  artifacts?: Record<string, unknown>     // typed data passed to downstream generators
}

interface GeneratedFile {
  path: string                            // relative to outputDir
  content: string
  header?: string                         // prepended @generated comment
}
```

Generators declare `dependsOn` internally. The runner reads this, builds a DAG,
topologically sorts it, and fails fast on circular dependencies. A downstream
generator receives the full `GeneratorOutput` from each upstream generator through
`ctx.outputs`.

---

## Planned Generators

### Core (this project)

| Package | Depends On | Output |
|---|---|---|
| `@semantic-fabric/generator-typescript` | — | TS interfaces, enums, Zod schemas |
| `@semantic-fabric/generator-sql` | typescript | CREATE TABLE DDL + migration files |
| `@semantic-fabric/generator-openapi` | typescript | OpenAPI 3.x YAML |
| `@semantic-fabric/generator-docs` | openapi, typescript | Markdown docs + PII/GDPR report |
| `@semantic-fabric/generator-jsonschema` | — | JSON Schema per entity |
| `@semantic-fabric/generator-rdf` | — | RDF/Turtle ontology |
| `@semantic-fabric/generator-owl` | rdf | OWL ontology (extends RDF output) |

### Community / future

| Package | Notes |
|---|---|
| `@semantic-fabric/generator-java` | Java POJOs + Spring annotations |
| `@semantic-fabric/generator-go` | Go structs |
| `@semantic-fabric/generator-rust` | Rust structs + serde |
| `@semantic-fabric/generator-graphql` | GraphQL schema SDL |
| `@semantic-fabric/generator-prisma` | Prisma schema |
| `@semantic-fabric/generator-kafka` | Topic + schema registry definitions |
| `@semantic-fabric/generator-statemachine-diagram` | Mermaid / PlantUML state diagrams |

The generator contract is the only thing a community generator needs to implement.
Anyone can publish `semantic-fabric-generator-*` to npm.

---

## Semantic Outputs (OWL / RDF / JSON-LD)

These outputs are what make semantic-fabric different from a code generator. They
express *meaning* in standard formats that reasoners and knowledge graphs understand.

- **Entities** → OWL Classes
- **Fields** → OWL Data Properties (with range, cardinality)
- **Relations** → OWL Object Properties
- **Behaviors** → OWL NamedIndividuals annotated with rules
- **State machines** → States become instances of a `LifecycleState` class;
  transitions become object properties with guards as `rdfs:comment` annotations
- **PII/GDPR metadata** → DPVO (Data Privacy Vocabulary) annotations

This means the fabric.ts file is effectively an OWL ontology with operational
extensions — it can be imported into Protégé, queried with SPARQL, and reasoned over.

---

## State Machine Design

State machines are first-class in the IR, not an afterthought. Key decisions:

- **One state machine per entity** (the most common case). Future: multiple orthogonal
  state machines (parallel regions) if demand exists.
- **Transitions are named and linked to behaviors** — a behavior can be the trigger for
  at most one transition per state machine. This keeps the DSL honest: you cannot have
  a behavior that transitions without being declared, or a transition without a behavior.
- **Guards and effects are declarative strings** — the SQL generator uses them as
  comments in migration files; the docs generator renders them as human-readable rules;
  a future runtime generator could compile them to executable code.
- **Terminal states** are marked explicitly — the SQL generator can add a CHECK
  constraint; the OpenAPI generator suppresses mutation endpoints for terminal-state
  resources.

---

## PII and GDPR

PII and GDPR annotations are field-level, not entity-level. Every field can carry:

```typescript
.field('email', f => f
  .email()
  .pii()                             // marks as personally identifiable
  .gdpr('identity')                  // GDPR category: identity | contact | financial
                                     //   | health | behavioral | location
  .gdprRetention('7y')               // how long to keep it
  .gdprLegalBasis('consent')         // consent | contract | legal-obligation
                                     //   | legitimate-interest
)
```

The `generator-docs` package produces a dedicated **GDPR Data Map** document listing
every PII field, its category, retention period, legal basis, and which API endpoints
expose it. This document is automatically kept in sync with `fabric.ts`.

---

## CLI

```bash
# Run all generators in dependency order
semantic-fabric generate

# Check for errors in fabric.ts without writing files
semantic-fabric validate

# Show what files would change if generate ran
semantic-fabric diff

# Detect if any generated file was manually edited
semantic-fabric check-drift

# Print the resolved IR as JSON (useful for debugging generators)
semantic-fabric inspect
```

---

## Manifest

Every `generate` run writes a `semantic-fabric.manifest.json` alongside the generated
files:

```json
{
  "generatedAt": "2026-06-30T10:00:00Z",
  "schemaHash": "sha256:abc123...",
  "files": [
    {
      "path": "types/index.ts",
      "generator": "@semantic-fabric/generator-typescript",
      "contentHash": "sha256:def456...",
      "fromSchemaHash": "sha256:abc123..."
    }
  ]
}
```

`check-drift` compares current file hashes against the manifest. `diff` compares a
fresh generation against current file content without writing.

---

## Package Structure (monorepo)

```
semantic-fabric/
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── builders/          # fluent DSL: fabric(), entity(), field(), etc.
│   │   │   ├── ir/                # FabricSchema types — the stable contract
│   │   │   ├── runner/            # DAG resolver + generator executor
│   │   │   ├── cli/               # generate / validate / diff / check-drift / inspect
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── generator-typescript/
│   ├── generator-sql/
│   ├── generator-openapi/
│   ├── generator-docs/
│   ├── generator-jsonschema/
│   ├── generator-rdf/
│   └── generator-owl/
│
├── examples/
│   └── rest-api/                  # a worked example project
│
├── pnpm-workspace.yaml
└── turbo.json
```

---

## Development Phases

### Phase 1 — IR + Builder DSL
**Goal:** The schema can be expressed and serialized. Nothing is generated yet.

- Define all IR types (`FabricSchema`, `EntitySchema`, `StateMachineSchema`, etc.)
- Implement fluent builders for: `fabric()`, `.entity()`, `.field()`, `.relation()`,
  `.behavior()`, `.stateMachine()`, `.api()`, `.endpoint()`
- `fabric().toIR()` serializes the builder state to a plain `FabricSchema` object
- `semantic-fabric validate` — loads `fabric.ts`, calls `.toIR()`, reports type errors
- `semantic-fabric inspect` — prints the IR as formatted JSON
- Unit tests covering all builder paths

**Deliverable:** A user can write `fabric.ts`, run `validate`, and see a structured IR.

---

### Phase 2 — Generator Interface + DAG Runner
**Goal:** The plugin system works. Generators can be wired and executed in order.

- Define `Generator`, `GeneratorContext`, `GeneratorOutput`, `GeneratedFile` interfaces
- Implement DAG resolver: read `dependsOn` from all generators, topological sort,
  cycle detection with a clear error message
- Implement runner: execute generators in order, thread `ctx.outputs` between them,
  write files to disk with `@generated` headers
- Implement manifest write/read
- `semantic-fabric generate` — runs all generators
- `semantic-fabric check-drift` — compares hashes
- Integration test with a no-op stub generator

**Deliverable:** A generator registered in config runs and writes a file.

---

### Phase 3 — `generator-typescript`
**Goal:** Entities become TypeScript types.

- TS interface per entity (all fields, nullability, enums)
- Zod schema per entity (field-level validation from `rules` metadata)
- State enum per state machine
- Transition type union
- No dependencies on other generators

**Deliverable:** `types/index.ts` with full type coverage.

---

### Phase 4 — API DSL + `generator-openapi`
**Goal:** REST endpoints are expressed and produce an OpenAPI spec.

- Finish `.api()` and `.endpoint()` builder (may have started in Phase 1)
- Map endpoints to OpenAPI paths/operations
- Map entity fields to OpenAPI schemas (reuse structure from Phase 3)
- Map behaviors to request bodies
- Map auth rules to OpenAPI security schemes
- State machine transitions → auto-generated transition endpoints (if not manually
  declared)
- `dependsOn: ['typescript']` — reuses TS schemas as canonical type source

**Deliverable:** `openapi/openapi.yaml` passing OpenAPI 3.x validation.

---

### Phase 5 — `generator-sql`
**Goal:** Entities become database tables with migration files.

- `CREATE TABLE` per entity with correct column types and constraints
- Foreign keys from `.relation()`
- CHECK constraints from terminal state machine states
- Enum types from `.field().enum()`
- Migration file naming: `000001_init.sql`, `000002_add_cancelled_at.sql`, etc.
- Drift detection: compare IR hash of last migration against current IR; if different,
  generate a new migration
- Reset script (separate CLI command on the generator, not in fabric.ts)
- `dependsOn: ['typescript']`

**Deliverable:** `migrations/` directory with incremental SQL files.

---

### Phase 6 — `generator-docs` + GDPR report
**Goal:** Human-readable documentation and a compliance artifact.

- Markdown page per entity: description, goal, fields table, behaviors, state machine
  diagram (Mermaid)
- API reference page per API group
- **GDPR Data Map**: table of every PII field with category, retention, legal basis,
  and which endpoints expose it
- `dependsOn: ['openapi', 'typescript']`

**Deliverable:** `docs/` directory with Markdown files.

---

### Phase 7 — `generator-jsonschema`, `generator-rdf`, `generator-owl`
**Goal:** Semantic web outputs. The library earns its "meaning" claim.

- `generator-jsonschema`: JSON Schema draft-07 per entity, from IR fields directly
- `generator-rdf`: RDF/Turtle — entities as classes, fields as data properties,
  relations as object properties, behaviors as named individuals, DPVO annotations
  for PII/GDPR
- `generator-owl`: extends RDF output with OWL axioms — cardinality restrictions,
  inverse properties, state machine as a lifecycle ontology
- Both `rdf` and `owl` have no generator dependencies (self-contained from IR)

**Deliverable:** `.ttl` and `.owl` files that can be loaded into Protégé or a
triple store.

---

### Phase 8 — `diff` command + developer experience
**Goal:** The tool is pleasant to use day-to-day.

- `semantic-fabric diff` — show a human-readable diff of what would change
- Watch mode: `semantic-fabric generate --watch` — re-generate on `fabric.ts` change
- Error messages in the builder DSL that point to the exact `.field()` or `.transition()`
  call (not just a type error)
- VS Code extension hint: `// @semantic-fabric` region markers in generated files link
  back to the source entity in `fabric.ts`

---

## Design Constraints (non-negotiable)

1. **The core has no knowledge of any generator.** Core exports only the IR types and
   the `Generator` interface. Generators are always external packages.
2. **Generated files are never edited by the user.** The `@generated` header and
   manifest enforcement make this clear. The CLI warns loudly on drift.
3. **`fabric.ts` has no runtime imports.** All builder methods return plain data at
   `toIR()` time. The user's application never depends on `@semantic-fabric/core` at
   runtime — only at build time.
4. **The IR is versioned.** Breaking IR changes are major version bumps. Generators
   declare which IR version they support.
5. **Generators are independently publishable.** The community can publish
   `semantic-fabric-generator-*` packages. The runner discovers them through the
   config file — no registration needed.
6. **State machines and behaviors are always declarative.** No executable code in
   `fabric.ts`. Intent, rules, guards, effects — all strings. Generators interpret
   them.

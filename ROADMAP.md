# Newel Roadmap

Phases 1–10 are complete. This document tracks what comes next.

---

## Completed phases

| Phase | Description |
|-------|-------------|
| 1 | IR types, Builder DSL, `validate`, `inspect` |
| 1b | Guard deduplication in normaliser |
| 2 | Generator interface, DAG runner, `generate`, `check-drift` |
| 2b | IR snapshot writing in runner |
| 3 | `generator-typescript` — TS interfaces + Zod schemas |
| 4 | `generator-openapi` — OpenAPI 3.x YAML |
| 5 | `generator-sql` + safe incremental migrations |
| 6 | `generator-docs` + GDPR report |
| 7 | `generator-jsonschema`, `generator-rdf`, `generator-owl` |
| 8 | `diff` command, watch mode, DX polish |
| 9 | Semantic patches against the IR |
| 10 | `generator-ui` — React entity forms + action panels |

---

## Phase 11 — IR extensions for non-application domains

These are targeted additions to `@newel/core` required before game or simulation
generators can produce useful output. Phase 11a is a breaking IR change (role
replaces kind; IR version bumped to 2.0.0). Phases 11b and 11c are additive.

### 11a — Entity `role` discriminator ✅ Done

Add a required `role: ConceptRole` field to `EntitySchema`. `ConceptRole` is a
closed union type — not a free string — so generators can exhaustively switch on
it and unknown values are type errors:

```ts
export type ConceptRole =
  | 'entity'
  | 'material'
  | 'item'
  | 'creature'
  | 'biome'
  | 'system'

// EntitySchema gains:
role: ConceptRole
```

`role` is optional in `EntityInput` (the user-facing layer); the normaliser
defaults to `'entity'` when omitted, so all existing fabrics are unaffected.

`kind` was considered and rejected: it is already used on `RelationSchema` for
`'hasMany' | 'hasOne' | ...`, and a plain `string` type gives generators nothing
reliable to branch on. `role` is a closed enum and required in the IR.

**Breaking change:** IR version bumped `1.0.0 → 2.0.0`.

**Acceptance criteria:**
- `ConceptRole` type is exported from `@newel/core`
- `EntitySchema` has `role: ConceptRole` (required)
- `EntityInput` has `role?: ConceptRole` (optional, defaults to `'entity'`)
- Normaliser sets `role = 'entity'` when omitted
- Existing tests still pass; two new tests cover default and explicit role
- `generator-typescript`, `generator-sql`, `generator-docs` ignore `role` (no
  change to their output)

### 11b — Weighted spawn relations

Extend `RelationSchema` (or add a parallel `SpawnSchema`) to support
probability-weighted, conditional membership — the minimum needed for biome
definitions:

```ts
interface SpawnSchema {
  target: string
  weight: number          // 0–1 relative probability
  conditions?: string[]   // declarative strings, e.g. ['night', 'rain']
}
```

Add `spawns?: SpawnSchema[]` to `EntitySchema`.

**Acceptance criteria:**
- `EntitySchema` and `EntityInput` have `spawns?`
- Normaliser validates `weight` is in range
- Existing generators ignore the new field

### 11c — System-level rule blocks

Add a top-level `systems` map to `FabricSchema` for global simulation rules
(weather, magic, economy) that are not entity instances:

```ts
interface SystemSchema {
  name: string
  description: string
  rules: string[]
  parameters?: Record<string, FieldSchema>
}

// FabricSchema gains:
systems?: Record<string, SystemSchema>
```

**Acceptance criteria:**
- `FabricSchema` and `FabricInput` have `systems?`
- CLI `inspect` lists systems if present
- Existing generators and tests unaffected

---

## Phase 12 — `generator-bible`

A new package `packages/generator-bible` that renders a static HTML/Markdown
design bible from a fabric.

**What it generates:**
- One Markdown (or HTML) page per entity, grouped by `kind`
- Index page listing all concepts with cross-links
- Systems section from `FabricSchema.systems`
- State machine diagrams (Mermaid) for entities that have one

**Dependencies:** Phase 11a (needs `kind` to group entries meaningfully)

**Acceptance criteria:**
- `pnpm generate` in a project with `BibleGenerator` produces a `bible/`
  output folder
- Each entity page includes: description, fields table, behaviors list, state
  machine diagram if present
- Cross-references resolve (item links to its required materials)
- Output is readable without a build step (plain Markdown or self-contained HTML)

---

## Phase 13 — `generator-wiki`

A new package `packages/generator-wiki` that produces wiki-ready output
(MediaWiki markup or a static site compatible with VitePress/Docusaurus).

**Difference from `generator-bible`:** The bible is an internal design document;
the wiki is player-facing public documentation. The same IR generates both, but
templates and tone differ.

**Dependencies:** Phase 12 (shares template infrastructure)

**Acceptance criteria:**
- Output is importable into a VitePress project without manual edits
- Player-facing language: no internal field names exposed
- Configurable via `quoin.config.ts` to suppress sections (e.g. hide `rules`
  that are implementation notes)

---

## Phase 14 — `generator-godot`

A new package `packages/generator-godot` that emits Godot 4.x-compatible
resource files from the IR.

**What it generates:**
- `.tres` (Godot TextResource) files for items, materials, creatures
- `*.gd` enums for entity states and field types
- `autoload/GameData.gd` — a singleton that loads all generated resources at
  runtime

**Dependencies:** Phase 11a (`kind` routing), Phase 11b (spawn weights for
biome resources)

**Acceptance criteria:**
- Generated `.tres` files load in Godot 4.x without errors
- State machine states appear as `enum` constants in corresponding `.gd` files
- `GameData.gd` exposes typed dictionaries keyed by entity name
- Generator is engine-version pinned in its README and fails loudly if the IR
  version it was built against changes

---

## Project Nihon

Project Nihon is the reference implementation that drives these phases. See
`../project-nihon/ROADMAP.md` for the game-side roadmap that maps to the
Newel phases above.

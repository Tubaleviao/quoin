import type {
  Generator,
  GeneratorContext,
  GeneratorOutput,
  FabricSchema,
  EntitySchema,
} from '@quoin/core'

// --- Helpers ---

function toKebab(s: string): string {
  return s.replace(/([A-Z])/g, m => `-${m.toLowerCase()}`).replace(/^-/, '')
}

function toPlural(name: string): string {
  if (name.endsWith('y') && !/[aeiou]y$/.test(name)) {
    return name.slice(0, -1) + 'ies'
  }
  if (/s$|sh$|ch$|x$|z$/.test(name)) return name + 'es'
  return name + 's'
}

function lcFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

// --- SQLite schema derivation ---

function toSqliteSchema(prismaSchemaContent: string): string {
  // Collect enum names before removing their blocks
  const enumNames: string[] = []
  const enumBlockRe = /^enum\s+(\w+)\s*\{[^}]*\}/gm
  let em: RegExpExecArray | null
  while ((em = enumBlockRe.exec(prismaSchemaContent)) !== null) {
    if (em[1]) enumNames.push(em[1])
  }

  let schema = prismaSchemaContent
    // Replace datasource block
    .replace(
      /datasource\s+\w+\s*\{[^}]*\}/s,
      `datasource db {\n  provider = "sqlite"\n  url      = env("DATABASE_URL")\n}`,
    )
    // Remove enum blocks entirely (SQLite does not support Prisma enums)
    .replace(/^enum\s+\w+\s*\{[^}]*\}\n?/gm, '')
    // Strip @db.* type modifiers
    .replace(/@db\.\w+(\([^)]*\))?/g, '')

  // Replace every enum type reference in field declarations with String
  for (const name of enumNames) {
    schema = schema.replace(new RegExp(`\\b${name}\\b`, 'g'), 'String')
  }

  // Prisma requires back-relations on both sides of a relation.
  // Parse @relation fields to discover which parent models need a reverse field.
  const backRelations = new Map<string, { child: string; field: string }[]>()
  let currentModel = ''
  for (const line of schema.split('\n')) {
    const mm = line.match(/^model\s+(\w+)\s*\{/)
    if (mm?.[1]) { currentModel = mm[1]; continue }
    if (line.trim() === '}') { currentModel = ''; continue }
    if (currentModel && line.includes('@relation')) {
      // e.g. "  book  Book  @relation(fields: [bookId], references: [id])"
      const rm = line.match(/^\s+\w+\s+(\w+)\s+@relation/)
      if (rm?.[1]) {
        const parent = rm[1]
        const backField = toPlural(lcFirst(currentModel))
        if (!backRelations.has(parent)) backRelations.set(parent, [])
        backRelations.get(parent)!.push({ child: currentModel, field: backField })
      }
    }
  }

  // Inject back-relation fields before each parent model's closing brace
  for (const [parent, rels] of backRelations) {
    const additions = rels.map(r => `  ${r.field}  ${r.child}[]`).join('\n')
    schema = schema.replace(
      new RegExp(`(model\\s+${parent}\\s*\\{[^}]*)\\n\\}`, 's'),
      `$1\n${additions}\n}`,
    )
  }

  // Collapse blank lines left by removed enum blocks
  return schema.replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

// --- API endpoint analysis (mirrors generator-express logic) ---

interface EndpointEntry {
  method: string
  path: string
  description?: string
  entityName: string | null
  isList: boolean
}

function resolveEntityFromPath(path: string, entityNames: string[]): string | null {
  const firstSeg = path.split('/').find(s => s && !s.startsWith(':'))
  if (!firstSeg) return null
  for (const name of entityNames) {
    if (
      toPlural(toKebab(name)) === firstSeg.toLowerCase() ||
      toKebab(name) === firstSeg.toLowerCase()
    ) {
      return name
    }
  }
  return null
}

function collectApiEndpoints(schema: FabricSchema): EndpointEntry[] {
  const entityNames = Object.keys(schema.entities)
  const entries: EndpointEntry[] = []

  for (const api of Object.values(schema.apis)) {
    const base = api.baseUrl ?? ''
    for (const ep of Object.values(api.endpoints)) {
      const fullPath = base + ep.path
      const entityName = ep.returns ?? resolveEntityFromPath(fullPath, entityNames)
      entries.push({
        method: ep.method.toLowerCase(),
        path: fullPath,
        description: ep.description,
        entityName,
        isList: ep.method === 'GET' && !ep.path.includes(':'),
      })
    }
  }

  return entries
}

// --- Generated file content ---

function generateEnvFile(): string {
  return [
    'DATABASE_URL="file:./dev.db"',
    'NODE_ENV=development',
    'PORT=3000',
    '# dev.db is the local SQLite database — add it to .gitignore',
  ].join('\n') + '\n'
}

function generateServerTs(appName: string): string {
  return `import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

// Load .env relative to this file regardless of cwd
const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '.env') })

import express from 'express'
import cors from 'cors'
import router from '../express/routes/index.js'

const app = express()
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000

app.use(cors())
app.use(express.json())

// Dev auth bypass: inject req.user.roles from X-Dev-Roles header
if (process.env.NODE_ENV !== 'production') {
  app.use((req: any, _res: any, next: any) => {
    const header = req.headers['x-dev-roles']
    if (header) {
      req.user = { roles: String(header).split(',').map((r: string) => r.trim()) }
    }
    next()
  })
}

app.use('/api', router)

app.listen(PORT, () => {
  console.log(\`${appName} API listening on http://localhost:\${PORT}/api\`)
})
`
}

function generateViteConfig(apiPort: number): string {
  // This config is always at src/generated/app/client/vite.config.ts.
  // Vite bundles TS configs with esbuild as CJS, which injects __dirname = the config's
  // own directory. We use that directly — no cwd/import.meta.url ambiguity.
  return `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// __dirname = src/generated/app/client/ (the directory of this config file)
// @generated must point to src/generated/ which is two levels up from client/
const generatedDir = path.resolve(__dirname, '../..')  // src/generated/

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@generated': generatedDir,
    },
  },
  server: {
    port: 5173,
    fs: {
      // Allow serving files from src/generated/ (UI components live outside cwd)
      allow: [generatedDir],
    },
    proxy: {
      '^/api/': {
        target: 'http://localhost:${apiPort}',
        changeOrigin: true,
      },
    },
  },
})
`
}

function generateClientTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2020',
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        paths: {
          '@generated/*': ['../../*'],
        },
      },
      include: ['.'],
    },
    null,
    2,
  ) + '\n'
}

function generateIndexHtml(appName: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${appName}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: system-ui, sans-serif; margin: 0; padding: 1rem 2rem; }
      nav { display: flex; gap: 1rem; margin-bottom: 1.5rem; border-bottom: 1px solid #ddd; padding-bottom: 0.5rem; }
      nav button { background: none; border: none; cursor: pointer; font-size: 1rem; padding: 0.25rem 0.5rem; color: #555; }
      nav button.active { font-weight: bold; color: #000; border-bottom: 2px solid #000; }
      .dev-bar { background: #fffbe6; border: 1px solid #e6c200; padding: 0.5rem 1rem; margin-bottom: 1rem; border-radius: 4px; display: flex; align-items: center; gap: 1rem; font-size: 0.875rem; }
      .dev-bar label { display: flex; align-items: center; gap: 0.5rem; }
      .dev-bar input { border: 1px solid #ccc; border-radius: 3px; padding: 0.2rem 0.5rem; width: 220px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { text-align: left; padding: 0.4rem 0.75rem; border-bottom: 1px solid #eee; }
      th { background: #f5f5f5; }
      .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem; }
      button[type=button] { padding: 0.25rem 0.75rem; cursor: pointer; }
      form label { display: block; margin-bottom: 0.75rem; }
      form span { display: block; font-size: 0.8rem; color: #555; margin-bottom: 0.2rem; }
      form input, form select { width: 100%; max-width: 400px; padding: 0.3rem 0.5rem; border: 1px solid #ccc; border-radius: 3px; }
      form button[type=submit] { margin-top: 0.5rem; padding: 0.4rem 1.2rem; }
      .error { color: red; font-size: 0.85rem; margin-top: 0.5rem; }
      .selected-row td { background: #f0f4ff; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
`
}

function generateMainTsx(): string {
  return `import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(<App />)
`
}

function generateApiClient(schema: FabricSchema): string {
  const entries = collectApiEndpoints(schema)
  const lines: string[] = []

  lines.push(`let _devRoles = 'member,librarian'`)
  lines.push(``)
  lines.push(`export function setDevRoles(roles: string): void {`)
  lines.push(`  _devRoles = roles`)
  lines.push(`}`)
  lines.push(``)
  lines.push(`async function apiFetch<T>(method: string, path: string, body?: unknown): Promise<T> {`)
  lines.push(`  const headers: Record<string, string> = {`)
  lines.push(`    'Content-Type': 'application/json',`)
  lines.push(`    'X-Dev-Roles': _devRoles,`)
  lines.push(`  }`)
  lines.push(`  const res = await fetch('/api' + path, {`)
  lines.push(`    method,`)
  lines.push(`    headers,`)
  lines.push(`    body: body !== undefined ? JSON.stringify(body) : undefined,`)
  lines.push(`  })`)
  lines.push(`  if (!res.ok) throw new Error(\`\${method} \${path} → \${res.status}\`)`)
  lines.push(`  if (res.status === 204) return undefined as T`)
  lines.push(`  return res.json()`)
  lines.push(`}`)
  lines.push(``)

  for (const entry of entries) {
    const fnName = deriveFunctionName(entry)
    const hasId = entry.path.includes('/:id')
    const hasBody = ['post', 'put', 'patch'].includes(entry.method) && !entry.path.includes('/:id/')
    const paramParts: string[] = []
    if (hasId) paramParts.push('id: string')
    if (hasBody) paramParts.push('body: Record<string, unknown>')
    const params = paramParts.join(', ')
    const resolvedPath = hasId ? `\`${entry.path.replace('/:id', '/${id}')}\`` : `'${entry.path}'`
    const bodyArg = hasBody ? ', body' : ''
    const desc = entry.description ? `  // ${entry.description}\n` : ''
    lines.push(`${desc}export function ${fnName}(${params}): Promise<unknown> {`)
    lines.push(`  return apiFetch('${entry.method.toUpperCase()}', ${resolvedPath}${bodyArg})`)
    lines.push(`}`)
    lines.push(``)
  }

  return lines.join('\n')
}

function deriveFunctionName(entry: EndpointEntry): string {
  // GET /books           → listBooks   (keep plural)
  // GET /books/:id       → getBook
  // POST /books          → createBook
  // DELETE /loans/:id    → deleteLoan
  // POST /books/:id/borrow → borrowBook
  const segments = entry.path.split('/').filter(s => s && !s.startsWith(':'))
  const entitySeg = segments[0] ?? 'item'

  if (entry.method === 'get' && entry.isList) {
    // list + PascalCase plural: books → Books
    return 'list' + toPascalCase(entitySeg)
  }

  // For all other cases use the singular entity name
  const entityName = toPascalSingular(entitySeg)

  if (entry.method === 'get') return 'get' + entityName
  if (entry.method === 'delete') return 'delete' + entityName
  if (entry.method === 'put' || entry.method === 'patch') return 'update' + entityName

  // POST: if path has an action segment beyond /:id (e.g. /books/:id/borrow) use that
  if (segments.length > 1) {
    const actionSeg = segments[segments.length - 1]!
    const actionName = toCamel(actionSeg.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()))
    return actionName + entityName
  }

  return 'create' + entityName
}

function toPascalCase(kebab: string): string {
  let s = kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function toPascalSingular(kebabPlural: string): string {
  // members → Member, books → Book, loans → Loan
  let s = kebabPlural.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  s = s.charAt(0).toUpperCase() + s.slice(1)
  // naive de-pluralize
  if (s.endsWith('ies')) return s.slice(0, -3) + 'y'
  if (s.endsWith('ses') || s.endsWith('xes') || s.endsWith('zes') || s.endsWith('ches') || s.endsWith('shes')) return s.slice(0, -2)
  if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1)
  return s
}

function toCamel(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

function generateEntityPage(entityName: string, schema: FabricSchema): string {
  const entity: EntitySchema = schema.entities[entityName]!
  const kebabPlural = toPlural(toKebab(entityName))
  const hasStateMachine = !!entity.stateMachine
  const listPath = `/${kebabPlural}`
  const entries = collectApiEndpoints(schema)

  // Find the concrete function names from the api-client (same logic as deriveFunctionName)
  const listEntry = entries.find(e => e.method === 'get' && e.isList && e.entityName === entityName)
  const createEntry = entries.find(e => e.method === 'post' && !e.path.includes('/:id/') && e.entityName === entityName)
  const listFn = listEntry ? deriveFunctionName(listEntry) : null
  const createFn = createEntry ? deriveFunctionName(createEntry) : null

  const hasListEndpoint = listFn !== null
  const hasCreateEndpoint = createFn !== null

  // Detect belongsTo relations whose target has a list endpoint in the API
  interface RelationInfo { fieldName: string; targetEntity: string; listFn: string; labelField: string }
  const relations: RelationInfo[] = []
  for (const rel of Object.values(entity.relations ?? {})) {
    if (rel.kind !== 'belongsTo' || !rel.foreignKey) continue
    const targetListEntry = entries.find(e => e.method === 'get' && e.isList && e.entityName === rel.target)
    if (!targetListEntry) continue
    const targetEntity = schema.entities[rel.target]
    if (!targetEntity) continue
    // Pick a human-readable label field: first non-pk string field
    const labelField = Object.values(targetEntity.fields).find(
      f => !f.primaryKey && (f.type === 'string'),
    )?.name ?? 'id'
    relations.push({
      fieldName: rel.foreignKey,
      targetEntity: rel.target,
      listFn: deriveFunctionName(targetListEntry),
      labelField,
    })
  }

  const fields = Object.entries(entity.fields)
    .filter(([, f]) => !f.primaryKey)
    .map(([name]) => name)

  const lines: string[] = []
  lines.push(`import React, { useEffect, useState } from 'react'`)
  const uiImports = [
    hasCreateEndpoint ? `${entityName}Form` : null,
    hasCreateEndpoint ? `${entityName}FormValues` : null,
    hasStateMachine ? `${entityName}ActionPanel` : null,
  ].filter(Boolean).join(', ')
  lines.push(`import { ${uiImports} } from '@generated/ui/${entityName}'`)
  lines.push(`import * as api from '../api-client'`)
  lines.push(``)
  lines.push(`export default function ${entityName}Page() {`)
  lines.push(`  const [items, setItems] = useState<any[]>([])`)
  lines.push(`  const [selected, setSelected] = useState<any | null>(null)`)
  if (hasCreateEndpoint) {
    lines.push(`  const [form, setForm] = useState<Partial<${entityName}FormValues>>({})`)
  }
  lines.push(`  const [error, setError] = useState('')`)
  // State for related entity options (for foreign-key selects)
  for (const rel of relations) {
    lines.push(`  const [${lcFirst(rel.targetEntity)}Options, set${rel.targetEntity}Options] = useState<any[]>([])`)
  }
  lines.push(``)

  if (hasListEndpoint) {
    lines.push(`  async function load() {`)
    lines.push(`    try {`)
    lines.push(`      const data = await api.${listFn}() as any[]`)
    lines.push(`      setItems(data)`)
    lines.push(`    } catch (e: any) {`)
    lines.push(`      setError(e.message)`)
    lines.push(`    }`)
    lines.push(`  }`)
    lines.push(``)
  }

  // Load related entity options on mount
  if (relations.length > 0) {
    lines.push(`  useEffect(() => {`)
    if (hasListEndpoint) lines.push(`    load()`)
    for (const rel of relations) {
      lines.push(`    api.${rel.listFn}().then((d: any) => set${rel.targetEntity}Options(d)).catch(() => {})`)
    }
    lines.push(`  }, [])`)
  } else if (hasListEndpoint) {
    lines.push(`  useEffect(() => { load() }, [])`)
  }
  lines.push(``)

  if (hasCreateEndpoint) {
    lines.push(`  async function handleSubmit(values: Partial<${entityName}FormValues>) {`)
    lines.push(`    try {`)
    lines.push(`      await api.${createFn}(values as Record<string, unknown>)`)
    if (hasListEndpoint) lines.push(`      await load()`)
    lines.push(`      setForm({})`)
    lines.push(`      setError('')`)
    lines.push(`    } catch (e: any) {`)
    lines.push(`      setError(e.message)`)
    lines.push(`    }`)
    lines.push(`  }`)
    lines.push(``)
  }

  if (hasStateMachine) {
    lines.push(`  async function handleAction(trigger: string) {`)
    lines.push(`    if (!selected) return`)
    lines.push(`    try {`)
    lines.push(`      await (api as any)[\`\${trigger}${entityName}\`]?.(selected.id)`)
    if (hasListEndpoint) lines.push(`      await load()`)
    lines.push(`      setSelected(null)`)
    lines.push(`      setError('')`)
    lines.push(`    } catch (e: any) {`)
    lines.push(`      setError(e.message)`)
    lines.push(`    }`)
    lines.push(`  }`)
    lines.push(``)
  }

  lines.push(`  return (`)
  lines.push(`    <div>`)
  lines.push(`      <h2>${entityName}</h2>`)
  lines.push(`      {error ? <p className="error">{error}</p> : null}`)

  if (hasListEndpoint) {
    lines.push(`      <table>`)
    lines.push(`        <thead><tr>`)
    for (const f of fields) {
      lines.push(`          <th>${f}</th>`)
    }
    lines.push(`          <th></th>`)
    lines.push(`        </tr></thead>`)
    lines.push(`        <tbody>`)
    lines.push(`          {items.map(item => (`)
    lines.push(`            <tr key={item.id} className={selected?.id === item.id ? 'selected-row' : ''}>`)
    for (const f of fields) {
      lines.push(`              <td>{String(item.${f} ?? '')}</td>`)
    }
    lines.push(`              <td>`)
    lines.push(`                <button type="button" onClick={() => setSelected(selected?.id === item.id ? null : item)}>`)
    lines.push(`                  {selected?.id === item.id ? 'Deselect' : 'Select'}`)
    lines.push(`                </button>`)
    lines.push(`              </td>`)
    lines.push(`            </tr>`)
    lines.push(`          ))}`)
    lines.push(`        </tbody>`)
    lines.push(`      </table>`)
  } else {
    lines.push(`      <p><em>No list endpoint configured — add GET ${listPath} to your API to see items here.</em></p>`)
  }

  if (hasStateMachine) {
    lines.push(`      {selected && (`)
    lines.push(`        <div className="actions">`)
    lines.push(`          <strong>Actions for selected item:</strong>`)
    lines.push(`          <${entityName}ActionPanel`)
    const stateField = entity.stateMachine!.field
    lines.push(`            currentState={selected.${stateField} as any}`)
    lines.push(`            onAction={handleAction}`)
    lines.push(`          />`)
    lines.push(`        </div>`)
    lines.push(`      )}`)
  }

  lines.push(`      <hr />`)
  if (hasCreateEndpoint) {
    lines.push(`      <h3>Add ${entityName}</h3>`)
    // Render custom selects for foreign-key fields as plain labels above the generated form.
    // LoanForm is itself a <form>, so we must NOT wrap it in another <form> (nested forms break HTML).
    // The selects update the shared `form` state; LoanForm's own submit button drives submission.
    if (relations.length > 0) {
      lines.push(`      <div>`)
      for (const rel of relations) {
        lines.push(`        <label>`)
        lines.push(`          <span>${rel.fieldName} *</span>`)
        lines.push(`          <select`)
        lines.push(`            value={form.${rel.fieldName} ?? ''}`)
        lines.push(`            onChange={e => setForm(prev => ({ ...prev, ${rel.fieldName}: e.target.value }))}`)
        lines.push(`          >`)
        lines.push(`            <option value="">Select ${rel.targetEntity}…</option>`)
        lines.push(`            {${lcFirst(rel.targetEntity)}Options.map((o: any) => (`)
        lines.push(`              <option key={o.id} value={o.id}>{o.${rel.labelField} ?? o.id}</option>`)
        lines.push(`            ))}`)
        lines.push(`          </select>`)
        lines.push(`        </label>`)
      }
      lines.push(`      </div>`)
      const fkFields = relations.map(r => `'${r.fieldName}'`)
      lines.push(`      <${entityName}Form`)
      lines.push(`        values={form}`)
      lines.push(`        onChange={(field, value) => {`)
      lines.push(`          if ([${fkFields.join(', ')}].includes(field as string)) return`)
      lines.push(`          setForm(prev => ({ ...prev, [field]: value }))`)
      lines.push(`        }}`)
      lines.push(`        onSubmit={handleSubmit}`)
      lines.push(`      />`)
    } else {
      lines.push(`      <${entityName}Form`)
      lines.push(`        values={form}`)
      lines.push(`        onChange={(field, value) => setForm(prev => ({ ...prev, [field]: value }))}`)
      lines.push(`        onSubmit={handleSubmit}`)
      lines.push(`      />`)
    }
  } else {
    lines.push(`      <p><em>No create endpoint — add <code>POST ${listPath}</code> to your API schema to enable creating ${entityName} records here.</em></p>`)
  }
  lines.push(`    </div>`)
  lines.push(`  )`)
  lines.push(`}`)
  lines.push(``)

  return lines.join('\n')
}

function generateAppTsx(schema: FabricSchema): string {
  const entityNames = Object.keys(schema.entities)
  const appName = schema.meta.name
  const lines: string[] = []

  lines.push(`import React, { useState } from 'react'`)
  for (const name of entityNames) {
    lines.push(`import ${name}Page from './pages/${name}Page'`)
  }
  lines.push(`import { setDevRoles } from './api-client'`)
  lines.push(``)
  lines.push(`const PAGES: Record<string, React.FC> = {`)
  for (const name of entityNames) {
    lines.push(`  ${name}: ${name}Page,`)
  }
  lines.push(`}`)
  lines.push(``)
  lines.push(`export default function App() {`)
  lines.push(`  const [page, setPage] = useState('${entityNames[0] ?? ''}')`)
  lines.push(`  const [devRoles, setDevRolesState] = useState('member,librarian')`)
  lines.push(``)
  lines.push(`  function handleRolesChange(value: string) {`)
  lines.push(`    setDevRolesState(value)`)
  lines.push(`    setDevRoles(value)`)
  lines.push(`  }`)
  lines.push(``)
  lines.push(`  const PageComponent = PAGES[page]`)
  lines.push(``)
  lines.push(`  return (`)
  lines.push(`    <div>`)
  lines.push(`      <h1>${appName}</h1>`)
  lines.push(`      <div className="dev-bar">`)
  lines.push(`        <span>⚙ Dev mode</span>`)
  lines.push(`        <label>`)
  lines.push(`          X-Dev-Roles:`)
  lines.push(`          <input`)
  lines.push(`            type="text"`)
  lines.push(`            value={devRoles}`)
  lines.push(`            onChange={e => handleRolesChange(e.target.value)}`)
  lines.push(`            placeholder="member,librarian"`)
  lines.push(`          />`)
  lines.push(`        </label>`)
  lines.push(`        <em style={{ color: '#888', fontSize: '0.8rem' }}>Comma-separated roles sent as X-Dev-Roles header</em>`)
  lines.push(`      </div>`)
  lines.push(`      <nav>`)
  for (const name of entityNames) {
    lines.push(`        <button className={page === '${name}' ? 'active' : ''} onClick={() => setPage('${name}')}>${name}</button>`)
  }
  lines.push(`      </nav>`)
  lines.push(`      {PageComponent ? <PageComponent /> : <p>Select a page</p>}`)
  lines.push(`    </div>`)
  lines.push(`  )`)
  lines.push(`}`)
  lines.push(``)

  return lines.join('\n')
}

// --- Generator ---

export class AppGenerator implements Generator {
  readonly name = 'app'
  readonly dependsOn: string[] = ['express', 'prisma', 'ui']

  async generate(schema: FabricSchema, ctx: GeneratorContext): Promise<GeneratorOutput> {
    const appName = schema.meta.name
    const entityNames = Object.keys(schema.entities)

    // Get Prisma schema from upstream generator output
    const prismaOutput = ctx.outputs.get('prisma')
    const prismaSchemaContent = prismaOutput?.files.find(f => f.path === 'prisma/schema.prisma')?.content ?? ''
    const sqliteSchema = prismaSchemaContent ? toSqliteSchema(prismaSchemaContent) : ''

    const files = [
      {
        path: 'app/.env',
        content: generateEnvFile(),
        header: '',
      },
      {
        path: 'app/server.ts',
        content: generateServerTs(appName),
        header: '// @generated by @quoin/generator-app — do not edit\n',
      },
      ...(sqliteSchema
        ? [
            {
              path: 'app/schema.prisma',
              content: sqliteSchema,
              header: '// @generated by @quoin/generator-app — do not edit\n',
            },
          ]
        : []),
      {
        path: 'app/client/index.html',
        content: generateIndexHtml(appName),
        header: '',
      },
      {
        path: 'app/client/main.tsx',
        content: generateMainTsx(),
        header: '// @generated by @quoin/generator-app — do not edit\n',
      },
      {
        path: 'app/client/App.tsx',
        content: generateAppTsx(schema),
        header: '// @generated by @quoin/generator-app — do not edit\n',
      },
      {
        path: 'app/client/vite.config.ts',
        content: generateViteConfig(3000),
        header: '// @generated by @quoin/generator-app — do not edit\n',
      },
      {
        path: 'app/client/tsconfig.json',
        content: generateClientTsConfig(),
        header: '',
      },
      {
        path: 'app/client/api-client.ts',
        content: generateApiClient(schema),
        header: '// @generated by @quoin/generator-app — do not edit\n',
      },
      ...entityNames.map(name => ({
        path: `app/client/pages/${name}Page.tsx`,
        content: generateEntityPage(name, schema),
        header: '// @generated by @quoin/generator-app — do not edit\n',
      })),
    ]

    return { files }
  }
}

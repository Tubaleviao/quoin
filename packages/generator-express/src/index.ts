import type {
  Generator,
  GeneratorContext,
  GeneratorOutput,
  FabricSchema,
  EndpointSchema,
  BehaviorSchema,
  ApiSchema,
} from '@quoin/core'

// --- Helpers ---

function lcFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

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

// --- Endpoint analysis ---

interface EndpointEntry {
  method: string
  fullPath: string
  endpoint: EndpointSchema
}

function collectEndpoints(schema: FabricSchema): EndpointEntry[] {
  const entries: EndpointEntry[] = []

  for (const api of Object.values(schema.apis)) {
    const base = api.baseUrl ?? ''
    for (const endpoint of Object.values(api.endpoints)) {
      entries.push({
        method: endpoint.method.toLowerCase(),
        fullPath: base + endpoint.path,
        endpoint,
      })
    }
  }

  // Auto-generate POST endpoints for uncovered state machine transitions
  const coveredBehaviors = new Set<string>()
  for (const api of Object.values(schema.apis)) {
    for (const ep of Object.values(api.endpoints)) {
      if (ep.behavior) coveredBehaviors.add(ep.behavior)
    }
  }

  for (const entity of Object.values(schema.entities)) {
    if (!entity.stateMachine) continue
    const seenTriggers = new Set<string>()

    for (const transition of entity.stateMachine.transitions) {
      const trigger = transition.trigger
      if (seenTriggers.has(trigger)) continue
      seenTriggers.add(trigger)

      const behaviorRef = `${entity.name}.${trigger}`
      if (coveredBehaviors.has(behaviorRef)) continue

      const behavior = entity.behaviors[trigger]
      const path = `/${toPlural(toKebab(entity.name))}/:id/${toKebab(trigger)}`
      entries.push({
        method: 'post',
        fullPath: path,
        endpoint: {
          method: 'POST',
          path,
          description: behavior?.description ?? `Trigger ${trigger} on ${entity.name}`,
          behavior: behaviorRef,
          auth: behavior?.auth,
        },
      })
    }
  }

  return entries
}

// --- Auth middleware ---

function renderAuthMiddleware(roles: string[]): string {
  const roleList = roles.map(r => `'${r}'`).join(', ')
  return `requireRoles([${roleList}])`
}

// --- Handler body ---

function resolveRequestBody(endpoint: EndpointSchema, schema: FabricSchema): string | null {
  if (!endpoint.behavior) return null
  const [entityName, behaviorName] = endpoint.behavior.split('.')
  const entity = entityName ? schema.entities[entityName] : undefined
  const behavior: BehaviorSchema | undefined = entity && behaviorName ? entity.behaviors[behaviorName] : undefined
  if (behavior?.input && Object.keys(behavior.input).length > 0) {
    return `${entityName}_${behaviorName}_Input`
  }
  return null
}

function buildHandlerBody(entry: EndpointEntry, schema: FabricSchema): string[] {
  const lines: string[] = []
  const { method, endpoint } = entry

  // Extract path params
  const pathParams = (entry.fullPath.match(/:[a-zA-Z_]+/g) ?? []).map(p => p.slice(1))
  if (pathParams.length > 0) {
    lines.push(`    const { ${pathParams.join(', ')} } = req.params`)
  }

  const hasBody = resolveRequestBody(endpoint, schema) !== null
  const isWriteMethod = ['post', 'put', 'patch'].includes(method)
  if (hasBody && isWriteMethod) {
    lines.push(`    const body = req.body`)
  }

  // Rules from behavior as comments
  if (endpoint.behavior) {
    const [entityName, behaviorName] = endpoint.behavior.split('.')
    const entity = entityName ? schema.entities[entityName] : undefined
    const behavior: BehaviorSchema | undefined = entity && behaviorName ? entity.behaviors[behaviorName] : undefined
    if (behavior?.rules && behavior.rules.length > 0) {
      for (const rule of behavior.rules) {
        lines.push(`    // Rule: ${rule}`)
      }
    }
  }

  // Placeholder implementation
  if (method === 'delete') {
    lines.push(`    // TODO: implement`)
    lines.push(`    res.status(204).send()`)
  } else if (method === 'get') {
    lines.push(`    // TODO: implement`)
    lines.push(`    res.json({})`)
  } else {
    lines.push(`    // TODO: implement`)
    lines.push(`    res.status(201).json({})`)
  }

  return lines
}

// --- Route file generation ---

function generateRouterFile(entries: EndpointEntry[], schema: FabricSchema): string {
  const hasAuth = entries.some(e => e.endpoint.auth?.roles && e.endpoint.auth.roles.length > 0)
  const lines: string[] = []

  lines.push(`import { Router, Request, Response } from 'express'`)
  if (hasAuth) {
    lines.push(`import { requireRoles } from '../middleware/auth'`)
  }
  lines.push(``)
  lines.push(`const router = Router()`)
  lines.push(``)

  for (const entry of entries) {
    const { method, fullPath, endpoint } = entry
    const roles = endpoint.auth?.roles ?? []
    const authArg = roles.length > 0 ? `${renderAuthMiddleware(roles)}, ` : ''
    const desc = endpoint.description ? ` // ${endpoint.description}` : ''
    const bodyLines = buildHandlerBody(entry, schema)
    const bodyStr = bodyLines.length > 0 ? `\n${bodyLines.join('\n')}\n  ` : ''

    lines.push(`router.${method}('${fullPath}', ${authArg}async (req: Request, res: Response) => {${bodyStr}})${desc}`)
    lines.push(``)
  }

  lines.push(`export default router`)
  lines.push(``)

  return lines.join('\n')
}

// --- Auth middleware template ---

function generateAuthMiddleware(): string {
  return [
    `import { Request, Response, NextFunction } from 'express'`,
    ``,
    `export function requireRoles(roles: string[]) {`,
    `  return (req: Request, res: Response, next: NextFunction): void => {`,
    `    // TODO: extract roles from req (e.g. JWT payload at req.user.roles)`,
    `    const userRoles: string[] = (req as any).user?.roles ?? []`,
    `    const allowed = roles.some(r => userRoles.includes(r))`,
    `    if (!allowed) {`,
    `      res.status(403).json({ error: 'Forbidden' })`,
    `      return`,
    `    }`,
    `    next()`,
    `  }`,
    `}`,
    ``,
  ].join('\n')
}

// --- App entry point ---

function generateAppFile(apiNames: string[]): string {
  const lines: string[] = []

  lines.push(`import express from 'express'`)
  lines.push(`import router from './routes'`)
  lines.push(``)
  lines.push(`const app = express()`)
  lines.push(`app.use(express.json())`)
  lines.push(`app.use('/api', router)`)
  lines.push(``)
  lines.push(`export default app`)
  lines.push(``)

  return lines.join('\n')
}

// --- Generator ---

export class ExpressGenerator implements Generator {
  readonly name = 'express'
  readonly dependsOn: string[] = ['typescript']

  async generate(schema: FabricSchema, _ctx: GeneratorContext): Promise<GeneratorOutput> {
    const entries = collectEndpoints(schema)

    return {
      files: [
        {
          path: 'express/routes/index.ts',
          content: generateRouterFile(entries, schema),
          header: '// @generated by @quoin/generator-express — do not edit\n',
        },
        {
          path: 'express/middleware/auth.ts',
          content: generateAuthMiddleware(),
          header: '// @generated by @quoin/generator-express — do not edit\n',
        },
        {
          path: 'express/app.ts',
          content: generateAppFile(Object.keys(schema.apis)),
          header: '// @generated by @quoin/generator-express — do not edit\n',
        },
      ],
    }
  }
}

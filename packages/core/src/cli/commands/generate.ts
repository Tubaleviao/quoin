import * as fs from 'fs'
import * as path from 'path'
import { loadSchema, loadConfig } from '../loader'
import { runGenerators } from '../../runner/runner'

async function runOnce(configPath: string): Promise<void> {
  const config = await loadConfig(configPath)
  const fabricPath = path.resolve(path.dirname(configPath), config.schema)
  const schema = await loadSchema(fabricPath)

  console.log(`Generating from ${schema.meta.name}...`)
  const result = await runGenerators(schema, config.generators, {
    outputDir: path.resolve(path.dirname(configPath), config.output),
  })

  const fileCount = result.manifest.files.length
  console.log(`✓ Generated ${fileCount} file(s)`)
  for (const entry of result.manifest.files) {
    console.log(`  ${entry.path}  [${entry.generator}]`)
  }
}

function resolveWatchPaths(configPath: string, schemaPath: string): string[] {
  const schemaResolved = path.resolve(path.dirname(configPath), schemaPath)
  const schemaDir = path.dirname(schemaResolved)
  return [schemaResolved, schemaDir]
}

export async function generateCommand(configPath: string, opts: { watch: boolean }): Promise<void> {
  try {
    await runOnce(configPath)
  } catch (err) {
    console.error(`✗ Generation failed: ${(err as Error).message}`)
    if (!opts.watch) process.exit(1)
  }

  if (!opts.watch) return

  const config = await loadConfig(configPath).catch(() => null)
  const watchPaths = config
    ? resolveWatchPaths(configPath, config.schema)
    : [path.resolve(path.dirname(configPath))]

  console.log(`\nWatching for changes... (Ctrl+C to stop)`)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  for (const watchPath of watchPaths) {
    if (!fs.existsSync(watchPath)) continue
    fs.watch(watchPath, { recursive: true }, (_event, filename) => {
      if (filename && !/\.(ts|js|json)$/.test(filename)) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(async () => {
        console.log(`\n[watch] Change detected — regenerating...`)
        try {
          await runOnce(configPath)
        } catch (err) {
          console.error(`✗ Generation failed: ${(err as Error).message}`)
        }
      }, 300)
    })
  }

  // Keep the process alive
  await new Promise<never>(() => { /* intentional: process lives until Ctrl+C */ })
}

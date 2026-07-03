import * as fs from 'fs'
import * as path from 'path'
import { loadSchema, loadConfig } from '../loader'
import { runGenerators } from '../../runner/runner'

function unifiedDiff(filePath: string, oldLines: string[], newLines: string[]): string {
  const output: string[] = [`--- ${filePath} (current)`, `+++ ${filePath} (generated)`]
  const maxLen = Math.max(oldLines.length, newLines.length)
  let i = 0
  let j = 0

  while (i < oldLines.length || j < newLines.length) {
    const old = oldLines[i]
    const next = newLines[j]

    if (i < oldLines.length && j < newLines.length && old === next) {
      output.push(`  ${old}`)
      i++
      j++
    } else if (j < newLines.length && (i >= oldLines.length || old !== next)) {
      output.push(`+ ${next}`)
      j++
    } else {
      output.push(`- ${old}`)
      i++
    }
  }

  void maxLen
  return output.join('\n')
}

export async function diffCommand(configPath: string): Promise<void> {
  try {
    const config = await loadConfig(configPath)
    const fabricPath = path.resolve(path.dirname(configPath), config.schema)
    const schema = await loadSchema(fabricPath)

    const outputDir = path.resolve(path.dirname(configPath), config.output)

    const result = await runGenerators(schema, config.generators, {
      outputDir,
      dryRun: true,
    })

    let anyChange = false
    for (const entry of result.manifest.files) {
      const filePath = path.join(outputDir, entry.path)
      const genFile = result.outputs
        .get(entry.generator)
        ?.files.find(f => f.path === entry.path)

      if (!genFile) continue

      const generatedContent = (genFile.header ?? '') + genFile.content

      if (!fs.existsSync(filePath)) {
        console.log(`[new]     ${entry.path}`)
        anyChange = true
        continue
      }

      const current = fs.readFileSync(filePath, 'utf8')
      if (current === generatedContent) {
        console.log(`[unchanged] ${entry.path}`)
        continue
      }

      anyChange = true
      console.log(`[changed]  ${entry.path}`)
      console.log(unifiedDiff(
        entry.path,
        current.split('\n'),
        generatedContent.split('\n'),
      ))
      console.log()
    }

    if (!anyChange) {
      console.log('All generated files are up to date.')
    }
  } catch (err) {
    console.error(`✗ diff failed: ${(err as Error).message}`)
    process.exit(1)
  }
}

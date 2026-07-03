import { loadSchema } from '../loader'
import { validateSchema } from '../../ir/validator'

export async function validateCommand(fabricPath: string): Promise<void> {
  try {
    const schema = await loadSchema(fabricPath)
    const result = validateSchema(schema)

    if (!result.valid) {
      console.error(`✗ Schema has ${result.errors.length} error(s):`)
      for (const e of result.errors) {
        console.error(`  ${e.path}: ${e.message}`)
      }
      process.exit(1)
    }

    console.log(`✓ Schema valid: ${schema.meta.name} (IR v${schema.version})`)
    console.log(`  entities: ${Object.keys(schema.entities).join(', ') || '(none)'}`)
    console.log(`  apis: ${Object.keys(schema.apis).join(', ') || '(none)'}`)
  } catch (err) {
    console.error(`✗ Validation failed: ${(err as Error).message}`)
    process.exit(1)
  }
}

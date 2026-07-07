import { defineConfig } from '@quoin/core'
import { TypeScriptGenerator } from '@quoin/generator-typescript'
import { OpenApiGenerator } from '@quoin/generator-openapi'
import { SqlGenerator } from '@quoin/generator-sql'
import { DocsGenerator } from '@quoin/generator-docs'
import { UiGenerator } from '@quoin/generator-ui'
import { ExpressGenerator } from '@quoin/generator-express'

export default defineConfig({
  schema: './src/fabric.ts',
  output: './src/generated',
  patches: './src/fabric.patches.ts',
  generators: [
    new TypeScriptGenerator(),
    new OpenApiGenerator(),
    new SqlGenerator(),
    new DocsGenerator(),
    new UiGenerator(),
    new ExpressGenerator(),
  ],
})

import { defineConfig } from '@quoin/core'
import { TypeScriptGenerator } from '@quoin/generator-typescript'
import { OpenApiGenerator } from '@quoin/generator-openapi'

export default defineConfig({
  schema: './src/fabric.ts',
  output: './src/generated',
  generators: [
    new TypeScriptGenerator(),
    new OpenApiGenerator(),
  ],
})

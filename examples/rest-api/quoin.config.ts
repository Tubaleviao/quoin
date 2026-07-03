import { defineConfig } from '@quoin/core'
import { TypeScriptGenerator } from '@quoin/generator-typescript'
import { OpenApiGenerator } from '@quoin/generator-openapi'
import { SqlGenerator } from '@quoin/generator-sql'
import { DocsGenerator } from '@quoin/generator-docs'
import { JsonSchemaGenerator } from '@quoin/generator-jsonschema'
import { RdfGenerator } from '@quoin/generator-rdf'
import { OwlGenerator } from '@quoin/generator-owl'

export default defineConfig({
  schema: './src/fabric.ts',
  output: './src/generated',
  generators: [
    new TypeScriptGenerator(),
    new OpenApiGenerator(),
    new SqlGenerator(),
    new DocsGenerator(),
    new JsonSchemaGenerator(),
    new RdfGenerator(),
    new OwlGenerator(),
  ],
})

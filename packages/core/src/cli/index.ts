#!/usr/bin/env node
import { Command } from 'commander'
import { validateCommand } from './commands/validate'
import { inspectCommand } from './commands/inspect'
import { generateCommand } from './commands/generate'
import { checkDriftCommand } from './commands/check-drift'
import { initCommand } from './commands/init'
import { diffCommand } from './commands/diff'

const program = new Command()

program
  .name('quoin')
  .description('Generate all application artifacts from a single fabric.ts source of truth')
  .version('0.0.1')

program
  .command('init')
  .description('Scaffold a new quoin project with a starter fabric.ts and quoin.config.ts')
  .option('-d, --dir <path>', 'target directory', '.')
  .action((opts: { dir: string }) => initCommand(opts.dir))

program
  .command('validate')
  .description('Check for errors in fabric.ts without writing files')
  .option('-s, --schema <path>', 'path to fabric.ts', './src/fabric.ts')
  .action((opts: { schema: string }) => validateCommand(opts.schema))

program
  .command('inspect')
  .description('Print the resolved IR as JSON')
  .option('-s, --schema <path>', 'path to fabric.ts', './src/fabric.ts')
  .action((opts: { schema: string }) => inspectCommand(opts.schema))

program
  .command('generate')
  .description('Run all generators in dependency order')
  .option('-c, --config <path>', 'path to quoin.config.ts', './quoin.config.ts')
  .option('-w, --watch', 'watch for changes and re-generate automatically', false)
  .action((opts: { config: string; watch: boolean }) => generateCommand(opts.config, { watch: opts.watch }))

program
  .command('diff')
  .description('Show what files would change if generate ran now')
  .option('-c, --config <path>', 'path to quoin.config.ts', './quoin.config.ts')
  .action((opts: { config: string }) => diffCommand(opts.config))

program
  .command('check-drift')
  .description('Detect if any generated file was manually edited')
  .option('-c, --config <path>', 'path to quoin.config.ts', './quoin.config.ts')
  .action((opts: { config: string }) => checkDriftCommand(opts.config))

program.parse()

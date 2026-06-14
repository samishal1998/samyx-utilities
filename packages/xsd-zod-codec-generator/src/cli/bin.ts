#!/usr/bin/env bun
/**
 * xml-codegen CLI - Main entry point
 *
 * Usage:
 *   xml-codegen generate --config <path> [options]
 *   xml-codegen scan-conflicts --config <path> [options]
 */

import { Command } from 'commander';
import { loadConfig, getPacksToGenerate } from './config.js';
import { generatePacks, printGenerationSummary } from './generate.js';
import {
  scanPacksForConflicts,
  printConflictSummary,
} from './scan-conflicts.js';

const program = new Command();

program
  .name('xml-codegen')
  .description('Protocol-agnostic XML Schema → Zod codec generator')
  .version('0.0.1');

program
  .command('generate')
  .description('Generate Zod schemas from XSD files')
  .requiredOption(
    '-c, --config <path>',
    'Path to configuration file (YAML/JSON)',
  )
  .option('-p, --pack <name...>', 'Generate only specific pack(s)')
  .option('-o, --out-dir <dir>', 'Override output directory')
  .option('--emit-complex-types', 'Also emit schemas for named complex types')
  .option('--emit-meta', 'Also emit static XmlMeta definitions for encoding')
  .option('--no-brand', 'Disable .brand<>() on generated schemas')
  .option(
    '--loose',
    'Add .passthrough() to allow extra properties (for xmlns, etc.)',
  )
  .option(
    '--always-array',
    'Treat all elements as arrays regardless of maxOccurs',
  )
  .option(
    '--simple-node-schema <mode>',
    'Simple node schema mode: force-object, automatic, both (default: automatic)',
  )
  .option('--dry-run', 'Load and validate schemas without writing files')
  .option('-v, --verbose', 'Print detailed logs')
  .action(async (options) => {
    try {
      // Load configuration
      const config = await loadConfig(options.config);

      if (options.verbose) {
        console.log(`Loaded config: ${options.config}`);
        console.log(
          `Packs defined: ${config.packs.map((p) => p.name).join(', ')}`,
        );
      }

      // Get packs to generate
      const packs = getPacksToGenerate(config, options.pack);

      if (options.verbose) {
        console.log(
          `Packs to generate: ${packs.map((p) => p.name).join(', ')}`,
        );
      }

      // Generate code
      const results = await generatePacks(packs, {
        outDir: options.outDir,
        emitComplexTypes: options.emitComplexTypes,
        emitMeta: options.emitMeta,
        brand: options.brand,
        loose: options.loose,
        alwaysArray: options.alwaysArray,
        simpleNodeSchema: options.simpleNodeSchema,
        dryRun: options.dryRun,
        verbose: options.verbose,
        configPath: options.config,
      });

      // Print summary
      printGenerationSummary(results);

      // Exit with error if any pack failed
      const hasFailures = results.some((r) => !r.success);
      if (hasFailures) {
        process.exit(1);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('scan-conflicts')
  .description('Scan XSD schemas for namespace conflicts and suggest mappings')
  .requiredOption(
    '-c, --config <path>',
    'Path to configuration file (YAML/JSON)',
  )
  .option('-p, --pack <name...>', 'Scan only specific pack(s)')
  .option('--json', 'Output results as JSON')
  .option('-v, --verbose', 'Print detailed logs')
  .action(async (options) => {
    try {
      // Load configuration
      const config = await loadConfig(options.config);

      if (options.verbose) {
        console.log(`Loaded config: ${options.config}`);
        console.log(
          `Packs defined: ${config.packs.map((p) => p.name).join(', ')}`,
        );
      }

      // Get packs to scan
      const packs = getPacksToGenerate(config, options.pack);

      if (options.verbose) {
        console.log(`Packs to scan: ${packs.map((p) => p.name).join(', ')}`);
      }

      // Scan for conflicts
      const results = await scanPacksForConflicts(packs, {
        configPath: options.config,
        verbose: options.verbose,
      });

      // Print results
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        printConflictSummary(results);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();

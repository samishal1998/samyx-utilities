/**
 * Generate Command - Core generation logic
 */

import { dirname, resolve, isAbsolute, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildSchemaGraph } from '../loader/index.js';
import {
  generateFromSchemaGraph,
  writeGeneratedFiles,
  formatSummary,
  emitMeta,
} from '../codegen/index.js';
import type { SchemaPackConfig } from './config.js';

/**
 * Simple node schema mode
 */
export type SimpleNodeSchemaMode = 'force-object' | 'automatic' | 'both';

/**
 * Options for the generate command
 */
export interface GenerateCommandOptions {
  /** Override output directory */
  outDir?: string;
  /** Force emit complex types */
  emitComplexTypes?: boolean;
  /** Emit static XmlMeta definitions */
  emitMeta?: boolean;
  /** Add .brand<>() to generated schemas (default: true) */
  brand?: boolean;
  /** Add .passthrough() to allow extra props (for xmlns, etc.) */
  loose?: boolean;
  /** Treat all elements as arrays regardless of maxOccurs */
  alwaysArray?: boolean;
  /** Simple node schema mode: force-object, automatic, both */
  simpleNodeSchema?: SimpleNodeSchemaMode;
  /** Dry run mode */
  dryRun?: boolean;
  /** Verbose output */
  verbose?: boolean;
  /** Config file path (for resolving relative paths) */
  configPath?: string;
}

/**
 * Result of generating a single pack
 */
export interface PackGenerateResult {
  packName: string;
  elementsGenerated: number;
  typesGenerated: number;
  metaGenerated: number;
  filesWritten: number;
  success: boolean;
  error?: Error;
}

/**
 * Resolve file paths relative to config file
 */
const resolveFilePaths = (files: string[], basePath: string): string[] => {
  return files.map((f) => {
    if (isAbsolute(f)) {
      return f;
    }
    return resolve(basePath, f);
  });
};

/**
 * Generate code for a single pack
 */
export const generatePack = async (
  pack: SchemaPackConfig,
  options: GenerateCommandOptions,
): Promise<PackGenerateResult> => {
  const packName = pack.name;

  try {
    // Resolve file paths
    const basePath = options.configPath
      ? dirname(options.configPath)
      : process.cwd();
    const files = resolveFilePaths(pack.files, basePath);

    // Resolve output directory
    const outDir = options.outDir || pack.outDir;
    const resolvedOutDir = isAbsolute(outDir)
      ? outDir
      : resolve(basePath, outDir);

    if (options.verbose) {
      console.log(`\n=== Generating pack: ${packName} ===`);
      console.log(`Files: ${files.length}`);
      console.log(`Output: ${resolvedOutDir}`);
    }

    // Convert namespaceAliases from config (Record) to Map
    const namespaceAliases = pack.namespaceAliases
      ? new Map(Object.entries(pack.namespaceAliases))
      : undefined;

    // Build schema graph
    const graph = await buildSchemaGraph({
      name: packName,
      files,
      rootNamespaces: pack.rootNamespaces,
      namespaceAliases,
    });

    if (options.verbose) {
      console.log(`Namespaces: ${graph.namespaces.length}`);
      console.log(`Elements: ${graph.elements.size}`);
      console.log(`Complex types: ${graph.complexTypes.size}`);
      console.log(`Simple types: ${graph.simpleTypes.size}`);
      if (graph.namespacePrefixes.size > 0) {
        console.log(
          `Namespace prefixes: ${[...graph.namespacePrefixes.entries()].map(([uri, prefix]) => `${prefix}`).join(', ')}`,
        );
      }
    }

    // Determine if we should emit complex types
    const emitComplexTypes =
      options.emitComplexTypes ?? pack.generate?.complexTypes ?? false;

    // Generate code
    const codegenResult = generateFromSchemaGraph(graph, {
      emitComplexTypes,
      useNamespacePrefixes: true,
      brand: options.brand,
      loose: options.loose,
      alwaysArray: options.alwaysArray,
      simpleNodeSchema: options.simpleNodeSchema,
    });

    // Write files
    const writeResult = await writeGeneratedFiles(codegenResult, {
      outDir: resolvedOutDir,
      dryRun: options.dryRun,
      verbose: options.verbose,
    });

    if (options.verbose) {
      console.log(formatSummary(codegenResult, writeResult));
    }

    // Generate meta files if requested
    let metaGenerated = 0;
    if (options.emitMeta) {
      const metaResult = emitMeta(graph, {
        strategyId: 'fxp-v1',
        useNamespacePrefixes: true,
      });

      metaGenerated = metaResult.modules.length;

      if (!options.dryRun) {
        // Write meta files to meta/ subdirectory
        const metaDir = join(resolvedOutDir, 'meta');
        await mkdir(metaDir, { recursive: true });

        // Write types file first
        const typesPath = join(metaDir, 'types.ts');
        await writeFile(typesPath, metaResult.types, 'utf-8');
        if (options.verbose) {
          console.log(`  wrote: ${typesPath}`);
        }

        for (const module of metaResult.modules) {
          const filePath = join(metaDir, `${module.fileName}.ts`);
          await writeFile(filePath, module.content, 'utf-8');
          if (options.verbose) {
            console.log(`  wrote: ${filePath}`);
          }
        }

        // Write meta index
        const indexPath = join(metaDir, 'index.ts');
        await writeFile(indexPath, metaResult.index, 'utf-8');
        if (options.verbose) {
          console.log(`  wrote: ${indexPath}`);
        }
      }

      if (options.verbose) {
        console.log(`Meta modules: ${metaGenerated}`);
      }
    }

    return {
      packName,
      elementsGenerated: codegenResult.elements.length,
      typesGenerated: codegenResult.types.length,
      metaGenerated,
      filesWritten:
        writeResult.filesWritten + (options.emitMeta ? metaGenerated + 2 : 0), // +2 for types.ts and index.ts
      success: true,
    };
  } catch (error) {
    return {
      packName,
      elementsGenerated: 0,
      typesGenerated: 0,
      metaGenerated: 0,
      filesWritten: 0,
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
};

/**
 * Generate code for multiple packs
 */
export const generatePacks = async (
  packs: SchemaPackConfig[],
  options: GenerateCommandOptions,
): Promise<PackGenerateResult[]> => {
  const results: PackGenerateResult[] = [];

  for (const pack of packs) {
    const result = await generatePack(pack, options);
    results.push(result);

    if (!result.success) {
      console.error(`\n❌ Error generating pack "${pack.name}":`);
      console.error(result.error?.message || 'Unknown error');
      if (options.verbose && result.error?.stack) {
        console.error('\nStack trace:');
        console.error(result.error.stack);
      }
    }
  }

  return results;
};

/**
 * Print summary of all pack generation results
 */
export const printGenerationSummary = (results: PackGenerateResult[]): void => {
  console.log('\n=== Generation Summary ===');

  let totalElements = 0;
  let totalTypes = 0;
  let totalMeta = 0;
  let totalFiles = 0;
  let failures = 0;

  for (const result of results) {
    const status = result.success ? '✓' : '✗';
    const metaPart =
      result.metaGenerated > 0 ? `, ${result.metaGenerated} meta` : '';
    console.log(
      `${status} ${result.packName}: ${result.elementsGenerated} elements, ${result.typesGenerated} types${metaPart}, ${result.filesWritten} files`,
    );

    if (result.success) {
      totalElements += result.elementsGenerated;
      totalTypes += result.typesGenerated;
      totalMeta += result.metaGenerated;
      totalFiles += result.filesWritten;
    } else {
      failures++;
    }
  }

  console.log('');
  const metaPart = totalMeta > 0 ? `, ${totalMeta} meta` : '';
  console.log(
    `Total: ${totalElements} elements, ${totalTypes} types${metaPart}, ${totalFiles} files`,
  );

  if (failures > 0) {
    console.log(`Failures: ${failures}`);
  }
};

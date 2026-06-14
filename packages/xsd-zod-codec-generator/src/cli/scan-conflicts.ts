/**
 * Scan Conflicts Command - Detect namespace conflicts in XSD schemas
 */

import { dirname, resolve, isAbsolute } from 'node:path';
import { buildSchemaGraph } from '../loader/index.js';
import {
  scanConflicts,
  formatScanReport,
  type ScanResult,
} from '../analyzer/index.js';
import type { SchemaPackConfig } from './config.js';

/**
 * Options for the scan-conflicts command
 */
export interface ScanConflictsOptions {
  /** Config file path (for resolving relative paths) */
  configPath?: string;
  /** Verbose output */
  verbose?: boolean;
}

/**
 * Result of scanning a single pack
 */
export interface PackScanResult {
  packName: string;
  conflictsFound: number;
  scanResult: ScanResult;
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
 * Scan a single pack for conflicts
 */
export const scanPackForConflicts = async (
  pack: SchemaPackConfig,
  options: ScanConflictsOptions,
): Promise<PackScanResult> => {
  const packName = pack.name;

  try {
    // Resolve file paths
    const basePath = options.configPath
      ? dirname(options.configPath)
      : process.cwd();
    const files = resolveFilePaths(pack.files, basePath);

    if (options.verbose) {
      console.log(`\n=== Scanning pack: ${packName} ===`);
      console.log(`Files: ${files.length}`);
    }

    // Build schema graph
    const graph = await buildSchemaGraph({
      name: packName,
      files,
      rootNamespaces: pack.rootNamespaces,
    });

    if (options.verbose) {
      console.log(`Namespaces: ${graph.namespaces.length}`);
      console.log(`Elements: ${graph.elements.size}`);
      console.log(`Complex types: ${graph.complexTypes.size}`);
    }

    // Scan for conflicts
    const scanResult = scanConflicts(graph);

    if (options.verbose) {
      console.log(`Conflicts found: ${scanResult.conflicts.length}`);
    }

    return {
      packName,
      conflictsFound: scanResult.conflicts.length,
      scanResult,
      success: true,
    };
  } catch (error) {
    return {
      packName,
      conflictsFound: 0,
      scanResult: { conflicts: [], suggestedMappings: {}, mappingDetails: [] },
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
};

/**
 * Scan multiple packs for conflicts
 */
export const scanPacksForConflicts = async (
  packs: SchemaPackConfig[],
  options: ScanConflictsOptions,
): Promise<PackScanResult[]> => {
  const results: PackScanResult[] = [];

  for (const pack of packs) {
    const result = await scanPackForConflicts(pack, options);
    results.push(result);

    if (!result.success) {
      console.error(`\nError scanning pack "${pack.name}":`);
      console.error(result.error?.message || 'Unknown error');
    }
  }

  return results;
};

/**
 * Print summary of all pack scan results
 */
export const printConflictSummary = (results: PackScanResult[]): void => {
  let totalRealConflicts = 0;
  let totalChoiceAlternatives = 0;

  for (const result of results) {
    console.log(`\n=== Pack: ${result.packName} ===`);

    if (!result.success) {
      console.log(`Error: ${result.error?.message || 'Unknown error'}`);
      continue;
    }

    console.log(formatScanReport(result.scanResult));

    // Count real conflicts vs choice alternatives
    const realConflicts = result.scanResult.conflicts.filter(
      (c) => !c.isChoiceAlternative,
    );
    const choiceAlternatives = result.scanResult.conflicts.filter(
      (c) => c.isChoiceAlternative,
    );
    totalRealConflicts += realConflicts.length;
    totalChoiceAlternatives += choiceAlternatives.length;
  }

  console.log('\n=== Summary ===');
  console.log(`Total packs scanned: ${results.length}`);
  console.log(`Real conflicts: ${totalRealConflicts}`);
  console.log(`Choice alternatives: ${totalChoiceAlternatives}`);

  if (totalRealConflicts > 0) {
    // Collect only real conflict mappings
    const realMappings: Record<string, string> = {};
    for (const result of results) {
      const realConflicts = result.scanResult.conflicts.filter(
        (c) => !c.isChoiceAlternative,
      );
      for (const conflict of realConflicts) {
        for (const elem of conflict.elements) {
          const key = `{${elem.namespace}}${elem.localName}`;
          if (result.scanResult.suggestedMappings[key]) {
            realMappings[key] = result.scanResult.suggestedMappings[key];
          }
        }
      }
    }

    if (Object.keys(realMappings).length > 0) {
      console.log(
        '\nTo resolve real conflicts, add these mappings to your decode options:',
      );
      console.log('```typescript');
      console.log('const result = decode(xmlJson, {');
      console.log('  strategy: FastXmlParserStrategy,');
      console.log('  fieldNameMapping: {');
      for (const [key, value] of Object.entries(realMappings)) {
        console.log(`    "${key}": "${value}",`);
      }
      console.log('  },');
      console.log('});');
      console.log('```');
    }
  } else if (totalChoiceAlternatives > 0) {
    console.log(
      '\nNo fieldNameMapping needed - all detected items are choice alternatives (mutually exclusive).',
    );
  }
};

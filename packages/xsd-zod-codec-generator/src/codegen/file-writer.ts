/**
 * File Writer - Writes generated code to the filesystem
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CodegenResult } from './zod-emitter.js';

/**
 * Options for writing generated files
 */
export interface WriteOptions {
  /** Base output directory */
  outDir: string;
  /** Dry run mode - don't write files, just log */
  dryRun?: boolean;
  /** Verbose logging */
  verbose?: boolean;
}

/**
 * Result of write operation
 */
export interface WriteResult {
  /** Number of files written */
  filesWritten: number;
  /** Paths of written files */
  paths: string[];
}

/**
 * Ensure directory exists
 */
const ensureDir = async (dir: string): Promise<void> => {
  await mkdir(dir, { recursive: true });
};

/**
 * Write a single file
 */
const writeSingleFile = async (
  filePath: string,
  content: string,
  options: WriteOptions,
): Promise<void> => {
  if (options.dryRun) {
    if (options.verbose) {
      console.log(`[dry-run] Would write: ${filePath}`);
    }
    return;
  }

  await ensureDir(dirname(filePath));
  await writeFile(filePath, content, 'utf-8');

  if (options.verbose) {
    console.log(`Wrote: ${filePath}`);
  }
};

/**
 * Content of the zloosen helper for loose mode
 */
const ZLOOSEN_HELPER = `import { z } from "zod";

/**
 * Make a Zod object schema loose (allow extra properties) while preserving type safety.
 * This is useful for XML parsing where xmlns and other attributes may be present.
 */
export function zloosen<Z extends z.ZodObject<z.ZodRawShape>>(schema: Z): Z {
  return schema.passthrough() as Z;
}
`;

/**
 * Write all generated files to disk
 */
export const writeGeneratedFiles = async (
  result: CodegenResult,
  options: WriteOptions,
): Promise<WriteResult> => {
  const paths: string[] = [];
  const { outDir } = options;

  // Create directories
  if (!options.dryRun) {
    await ensureDir(outDir);
    await ensureDir(join(outDir, 'elements'));
    if (result.types.length > 0) {
      await ensureDir(join(outDir, 'types'));
    }
    if (result.loose) {
      await ensureDir(join(outDir, 'helpers', 'zod'));
    }
  }

  // Write index.ts
  const indexPath = join(outDir, 'index.ts');
  await writeSingleFile(indexPath, result.index, options);
  paths.push(indexPath);

  // Write schema-meta.ts
  const metaPath = join(outDir, 'schema-meta.ts');
  await writeSingleFile(metaPath, result.schemaMeta, options);
  paths.push(metaPath);

  // Write zloosen helper if loose mode is enabled
  if (result.loose) {
    const helperPath = join(outDir, 'helpers', 'zod', 'loosen.ts');
    await writeSingleFile(helperPath, ZLOOSEN_HELPER, options);
    paths.push(helperPath);
  }

  // Write element modules
  for (const elem of result.elements) {
    const elemPath = join(outDir, 'elements', `${elem.fileName}.ts`);
    await writeSingleFile(elemPath, elem.content, options);
    paths.push(elemPath);
  }

  // Write type modules
  for (const type of result.types) {
    const typePath = join(outDir, 'types', `${type.fileName}.ts`);
    await writeSingleFile(typePath, type.content, options);
    paths.push(typePath);
  }

  return {
    filesWritten: paths.length,
    paths,
  };
};

/**
 * Format a summary of generated files
 */
export const formatSummary = (
  result: CodegenResult,
  writeResult: WriteResult,
): string => {
  const lines: string[] = [
    '=== Code Generation Summary ===',
    `Elements generated: ${result.elements.length}`,
  ];

  if (result.types.length > 0) {
    lines.push(`Types generated: ${result.types.length}`);
  }

  lines.push(`Total files written: ${writeResult.filesWritten}`);
  lines.push('');

  return lines.join('\n');
};

/**
 * Config - Schema pack configuration loading and validation
 */

import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { extname } from 'node:path';

/**
 * Generation options for a pack
 */
const GenerateOptionsSchema = z.object({
  globals: z.boolean().default(true),
  complexTypes: z.boolean().default(false),
});

/**
 * Schema pack configuration
 */
const SchemaPackSchema = z.object({
  name: z.string().min(1),
  outDir: z.string().min(1),
  files: z.array(z.string().min(1)).min(1),
  rootNamespaces: z.array(z.string()).optional(),
  generate: GenerateOptionsSchema.optional(),
  /** Namespace URI → prefix mapping overrides */
  namespaceAliases: z.record(z.string(), z.string()).optional(),
});

/**
 * Root configuration file schema
 */
const ConfigFileSchema = z.object({
  packs: z.array(SchemaPackSchema).min(1),
});

export type GenerateOptions = z.infer<typeof GenerateOptionsSchema>;
export type SchemaPackConfig = z.infer<typeof SchemaPackSchema>;
export type ConfigFile = z.infer<typeof ConfigFileSchema>;

/**
 * Load and parse configuration file
 */
export const loadConfig = async (configPath: string): Promise<ConfigFile> => {
  const content = await readFile(configPath, 'utf-8');
  const ext = extname(configPath).toLowerCase();

  let parsed: unknown;

  if (ext === '.yaml' || ext === '.yml') {
    parsed = parseYaml(content);
  } else if (ext === '.json') {
    parsed = JSON.parse(content);
  } else {
    // Try YAML first, then JSON
    try {
      parsed = parseYaml(content);
    } catch {
      parsed = JSON.parse(content);
    }
  }

  const result = ConfigFileSchema.safeParse(parsed);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  return result.data;
};

/**
 * Get a specific pack from config by name
 */
export const getPackByName = (
  config: ConfigFile,
  name: string,
): SchemaPackConfig | undefined => {
  return config.packs.find((p) => p.name === name);
};

/**
 * Get all packs or filter by names
 */
export const getPacksToGenerate = (
  config: ConfigFile,
  packNames?: string[],
): SchemaPackConfig[] => {
  if (!packNames || packNames.length === 0) {
    return config.packs;
  }

  const packs: SchemaPackConfig[] = [];
  for (const name of packNames) {
    const pack = getPackByName(config, name);
    if (!pack) {
      throw new Error(`Pack "${name}" not found in configuration`);
    }
    packs.push(pack);
  }

  return packs;
};

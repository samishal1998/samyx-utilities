/**
 * SchemaGraph Builder - Resolves includes/imports/redefines and builds final SchemaGraph
 *
 * This module takes parsed RawSchemaIR from multiple XSD files and resolves
 * cross-references to build a unified SchemaGraph.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve, isAbsolute } from 'node:path';
import type {
  ComplexTypeIR,
  ElementDeclIR,
  NamespaceURI,
  QName,
  RawSchemaIR,
  SchemaGraph,
  SchemaLoader,
  SchemaPackLoadOptions,
  SimpleTypeIR,
} from '../xml-schema-graph-ir.js';
import { qNameKey } from '../xml-schema-graph-ir.js';
import {
  extractDirectives,
  extractTargetNamespace,
  parseXsdContent,
  type SchemaDirective,
} from './xsd-parser.js';

/**
 * Internal state for tracking loaded schemas during resolution
 */
interface LoaderState {
  // Maps file path → RawSchemaIR
  loadedSchemas: Map<string, RawSchemaIR>;
  // Maps file path → XSD content (for reprocessing)
  fileContents: Map<string, string>;
  // Set of files currently being processed (cycle detection)
  processing: Set<string>;
  // Base directory for resolving relative paths
  baseDirs: Map<string, string>;
  // Namespace → file paths mapping
  namespaceFiles: Map<NamespaceURI, string[]>;
}

/**
 * Load a file and its dependencies recursively
 */
const loadFileRecursive = async (
  filePath: string,
  state: LoaderState,
): Promise<void> => {
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(filePath);

  // Skip if already loaded
  if (state.loadedSchemas.has(absolutePath)) {
    return;
  }

  // Cycle detection
  if (state.processing.has(absolutePath)) {
    console.warn(`Circular reference detected: ${absolutePath}`);
    return;
  }

  state.processing.add(absolutePath);

  try {
    const content = await readFile(absolutePath, 'utf-8');
    state.fileContents.set(absolutePath, content);
    state.baseDirs.set(absolutePath, dirname(absolutePath));

    // Parse the XSD
    let rawSchema: RawSchemaIR | undefined;
    try {
      rawSchema = parseXsdContent(content, absolutePath);
    } catch (parseError) {
      const errorMessage =
        parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(
        `Failed to parse XSD file: ${absolutePath}\n` +
          `  Reason: ${errorMessage}\n` +
          '  Hint: Check for invalid XML syntax, entity references, or encoding issues.',
      );
    }
    state.loadedSchemas.set(absolutePath, rawSchema);

    // Track namespace → file mapping
    if (rawSchema.targetNamespace) {
      const files = state.namespaceFiles.get(rawSchema.targetNamespace) || [];
      files.push(absolutePath);
      state.namespaceFiles.set(rawSchema.targetNamespace, files);
    }

    // Extract and process directives
    const directives = extractDirectives(content);
    const baseDir = dirname(absolutePath);

    for (const directive of directives) {
      if (directive.schemaLocation) {
        const refPath = resolve(baseDir, directive.schemaLocation);
        await loadFileRecursive(refPath, state);
      }
    }
  } finally {
    state.processing.delete(absolutePath);
  }
};

/**
 * Merge raw schemas into a single SchemaGraph
 */
const mergeSchemas = (
  name: string,
  state: LoaderState,
  rootNamespaces?: NamespaceURI[],
  configAliases?: Map<string, string>,
): SchemaGraph => {
  const simpleTypes = new Map<string, SimpleTypeIR>();
  const complexTypes = new Map<string, ComplexTypeIR>();
  const elements = new Map<string, ElementDeclIR>();
  const namespaces = new Set<NamespaceURI>();
  const namespacePrefixes = new Map<string, string>();

  // Merge all loaded schemas
  for (const [filePath, rawSchema] of state.loadedSchemas) {
    const ns = rawSchema.targetNamespace;
    if (ns) {
      namespaces.add(ns);
    }

    // Merge namespace prefixes (first occurrence wins)
    for (const [uri, prefix] of rawSchema.namespacePrefixes) {
      if (!namespacePrefixes.has(uri)) {
        namespacePrefixes.set(uri, prefix);
      }
    }

    // Merge simple types
    for (const st of rawSchema.simpleTypes) {
      const key = qNameKey(st.name);
      if (!simpleTypes.has(key)) {
        simpleTypes.set(key, st);
      }
    }

    // Merge complex types
    for (const ct of rawSchema.complexTypes) {
      const key = qNameKey(ct.name);
      if (!complexTypes.has(key)) {
        complexTypes.set(key, ct);
      }
    }

    // Merge elements
    for (const el of rawSchema.elements) {
      const key = qNameKey(el.name);
      if (!elements.has(key)) {
        elements.set(key, el);
      }
    }
  }

  // Apply config aliases (override XSD-inferred prefixes)
  if (configAliases) {
    for (const [uri, prefix] of configAliases) {
      namespacePrefixes.set(uri, prefix);
    }
  }

  // Filter by rootNamespaces if specified
  if (rootNamespaces && rootNamespaces.length > 0) {
    const nsSet = new Set(rootNamespaces);

    // Filter simple types
    for (const [key, st] of simpleTypes) {
      if (!nsSet.has(st.name.namespace)) {
        simpleTypes.delete(key);
      }
    }

    // Filter complex types
    for (const [key, ct] of complexTypes) {
      if (!nsSet.has(ct.name.namespace)) {
        complexTypes.delete(key);
      }
    }

    // Filter elements
    for (const [key, el] of elements) {
      if (!nsSet.has(el.name.namespace)) {
        elements.delete(key);
      }
    }
  }

  return {
    name,
    namespaces: Array.from(namespaces),
    namespacePrefixes,
    simpleTypes,
    complexTypes,
    elements,
  };
};

/**
 * Create a SchemaLoader implementation
 */
export const createSchemaLoader = (): SchemaLoader => {
  return {
    loadPack: async (options: SchemaPackLoadOptions): Promise<SchemaGraph> => {
      const state: LoaderState = {
        loadedSchemas: new Map(),
        fileContents: new Map(),
        processing: new Set(),
        baseDirs: new Map(),
        namespaceFiles: new Map(),
      };

      // Load all specified files and their dependencies
      for (const filePath of options.files) {
        await loadFileRecursive(filePath, state);
      }

      // Merge into final SchemaGraph
      return mergeSchemas(
        options.name,
        state,
        options.rootNamespaces,
        options.namespaceAliases,
      );
    },
  };
};

/**
 * Convenience function to build a SchemaGraph from options
 */
export const buildSchemaGraph = async (
  options: SchemaPackLoadOptions,
): Promise<SchemaGraph> => {
  const loader = createSchemaLoader();
  return loader.loadPack(options);
};

/**
 * Resolve a type reference (QName) to its definition
 */
export const resolveType = (
  qname: QName,
  graph: SchemaGraph,
): SimpleTypeIR | ComplexTypeIR | undefined => {
  const key = qNameKey(qname);
  return graph.simpleTypes.get(key) || graph.complexTypes.get(key);
};

/**
 * Resolve an element reference to its declaration
 */
export const resolveElement = (
  qname: QName,
  graph: SchemaGraph,
): ElementDeclIR | undefined => {
  const key = qNameKey(qname);
  return graph.elements.get(key);
};

/**
 * Check if a QName refers to an XSD built-in type
 */
export const isBuiltInType = (qname: QName): boolean => {
  return qname.namespace === 'http://www.w3.org/2001/XMLSchema';
};

/**
 * Get all elements in the graph, optionally filtered by namespace
 */
export const getElements = (
  graph: SchemaGraph,
  namespace?: NamespaceURI,
): ElementDeclIR[] => {
  const elements = Array.from(graph.elements.values());
  if (namespace) {
    return elements.filter((el) => el.name.namespace === namespace);
  }
  return elements;
};

/**
 * Get all complex types in the graph, optionally filtered by namespace
 */
export const getComplexTypes = (
  graph: SchemaGraph,
  namespace?: NamespaceURI,
): ComplexTypeIR[] => {
  const types = Array.from(graph.complexTypes.values());
  if (namespace) {
    return types.filter((t) => t.name.namespace === namespace);
  }
  return types;
};

/**
 * Get all simple types in the graph, optionally filtered by namespace
 */
export const getSimpleTypes = (
  graph: SchemaGraph,
  namespace?: NamespaceURI,
): SimpleTypeIR[] => {
  const types = Array.from(graph.simpleTypes.values());
  if (namespace) {
    return types.filter((t) => t.name.namespace === namespace);
  }
  return types;
};

/**
 * @namefi-astra/xsd-zod-codec-generator
 *
 * Protocol-agnostic XML Schema → Zod codec generator.
 *
 * This package provides:
 * - XSD parsing and loading (Layer 0)
 * - SchemaGraph IR building
 * - Zod schema code generation (Layer 1)
 * - XML JSON ↔ Clean TypeScript codec runtime (Layer 2)
 * - CLI for batch code generation
 *
 * @example Layer 1: Generate Zod schemas from XSD
 * ```typescript
 * import { buildSchemaGraph, generateFromSchemaGraph } from '@namefi-astra/xsd-zod-codec-generator';
 *
 * const graph = await buildSchemaGraph({
 *   name: 'my-protocol',
 *   files: ['./schemas/root.xsd', './schemas/types.xsd'],
 * });
 *
 * const result = generateFromSchemaGraph(graph, {
 *   emitComplexTypes: true,
 * });
 *
 * await writeGeneratedFiles(result, { outDir: './generated' });
 * ```
 *
 * @example Layer 2: Transform XML JSON to clean TypeScript
 * ```typescript
 * import { decode, encode, FastXmlParserStrategy } from '@namefi-astra/xsd-zod-codec-generator';
 *
 * // Decode XML JSON to clean object
 * const result = decode(xmlJsonNode, { strategy: FastXmlParserStrategy });
 * console.log(result.name);  // Clean access without @_ or #text
 *
 * // Encode back to XML JSON
 * const xmlJson = encode(result, { strategy: FastXmlParserStrategy });
 * ```
 */

// Re-export IR types
export * from './xml-schema-graph-ir.js';

// Re-export loader functionality
export {
  parseXsdContent,
  extractDirectives,
  extractTargetNamespace,
  createSchemaLoader,
  buildSchemaGraph,
  resolveType,
  resolveElement,
  isBuiltInType,
  getElements,
  getComplexTypes,
  getSimpleTypes,
  type SchemaDirective,
} from './loader/index.js';

// Re-export codegen functionality
export {
  generateFromSchemaGraph,
  writeGeneratedFiles,
  formatSummary,
  type CodegenOptions,
  type CodegenResult,
  type GeneratedModule,
  type WriteOptions,
  type WriteResult,
} from './codegen/index.js';

// Re-export CLI utilities (for programmatic use)
export {
  loadConfig,
  getPackByName,
  getPacksToGenerate,
  generatePack,
  generatePacks,
  type ConfigFile,
  type SchemaPackConfig,
  type GenerateOptions,
  type GenerateCommandOptions,
  type PackGenerateResult,
} from './cli/index.js';

// ============================================================================
// Layer 2: XML JSON ↔ Clean TypeScript Codec Runtime
// ============================================================================

// Core decode/encode functions
export { decode, decodeWithQName, typedDecode } from './layer2/decode.js';
export { encode, encodeWithPrefixes } from './layer2/encode.js';

// Type inference utilities
export type {
  InferCleanType,
  InferCleanEnvelope,
  TypedDecodeResult,
  CleanPayload,
  InferXmlJsonType,
  ExtractLayer2Payload,
  DeepPartial,
  DeepRequired,
  AttributeKeys,
  ElementKeys,
  GetElementType,
} from './layer2/type-inference.js';

// Strategies
export { FastXmlParserStrategy } from './layer2/strategies/index.js';

// Types
export type {
  QName as Layer2QName,
  XmlJsonStrategy,
  Layer2Envelope,
  XmlMeta,
  XmlNodeMeta,
  XmlFieldMeta,
  XmlFieldBaseMeta,
  XmlAttributeFieldMeta,
  XmlElementFieldMeta,
  XmlValueMeta,
  ExtractPayload,
} from './layer2/types.js';

// Options
export type {
  MixedContentMode,
  DecodeOptions,
  EncodeOptions,
  DetectMetadataOptions,
} from './layer2/options.js';

// Metadata utilities
export {
  extractMeta,
  extractPayload,
  attachMeta,
  cloneWithMeta,
  mapEnvelope,
  isLayer2Envelope,
  mergeEnvelopes,
  createMinimalMeta,
} from './layer2/meta-utils.js';

// Metadata detection
export { detectMetadata } from './layer2/detect-metadata.js';

// IR-enhanced mode
export {
  detectMetadataWithIR,
  getRootElements,
  hasElement,
} from './layer2/ir-enhanced.js';

// Field naming utilities
export {
  getLocalName,
  getPrefix,
  computeSimplifiedName,
  inferNamespaceAlias,
  createPrefixMap,
  KNOWN_NAMESPACE_PREFIXES,
} from './layer2/field-naming.js';

// ============================================================================
// Analyzer: Static analysis utilities
// ============================================================================

export {
  scanConflicts,
  formatScanReport,
  type ConflictInfo,
  type SuggestedMapping,
  type ScanResult,
  type ScanOptions,
} from './analyzer/index.js';

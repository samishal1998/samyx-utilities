/**
 * Layer 2: XML Codec Runtime
 *
 * Transforms XML JSON (from fast-xml-parser) into clean TypeScript objects
 * with metadata ($meta) that enables round-trip encoding.
 *
 * @example
 * ```typescript
 * import {
 *   decode,
 *   encode,
 *   FastXmlParserStrategy,
 * } from '@namefi-astra/xsd-zod-codec-generator/layer2';
 *
 * // Decode XML JSON to clean object
 * const result = decode(xmlJsonNode, { strategy: FastXmlParserStrategy });
 *
 * // Access clean payload
 * console.log(result.name);        // "example.com"
 * console.log(result.availability); // true
 *
 * // Encode back to XML JSON
 * const xmlJson = encode(result, { strategy: FastXmlParserStrategy });
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Core types
  QName,
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
} from './types.js';

// ============================================================================
// Options
// ============================================================================

export type {
  MixedContentMode,
  DecodeOptions,
  EncodeOptions,
  DetectMetadataOptions,
} from './options.js';

export { DEFAULT_DECODE_OPTIONS, DEFAULT_DETECT_OPTIONS } from './options.js';

// ============================================================================
// Strategies
// ============================================================================

export {
  FastXmlParserStrategy,
  hasAttributes as strategyHasAttributes,
  hasTextContent as strategyHasTextContent,
  isSimpleNode,
} from './strategies/index.js';

// ============================================================================
// Core Functions
// ============================================================================

// Decode
export { decode, decodeWithQName, typedDecode } from './decode.js';

// Encode
export { encode, encodeWithPrefixes } from './encode.js';

// Metadata detection
export { detectMetadata } from './detect-metadata.js';

// ============================================================================
// Type Inference Utilities
// ============================================================================

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
  InferOptions,
} from './type-inference.js';

// ============================================================================
// Meta Utilities
// ============================================================================

export {
  // Core utilities
  extractMeta,
  extractPayload,
  attachMeta,
  cloneWithMeta,
  mapEnvelope,
  isLayer2Envelope,
  mergeEnvelopes,
  // Creation helpers
  createMinimalMeta,
  // Cloning
  cloneMeta,
  cloneNodeMeta,
  cloneFieldMeta,
  // Inspection
  getFieldNames,
  getAttributeFields,
  getElementFields,
  findFieldByKey,
  findFieldByXmlName,
  hasAttributes,
  hasElements,
  hasValue,
} from './meta-utils.js';

// ============================================================================
// Field Naming Utilities
// ============================================================================

export {
  // Context management
  createFieldNameContext,
  cloneFieldNameContext,
  type FieldNameContext,
  // Name extraction
  getLocalName,
  getPrefix,
  // Mapping key utilities
  buildMappingKey,
  parseMappingKey,
  // Name computation
  computeSimplifiedName,
  inferNamespaceAlias,
  // Prefix utilities
  buildQualifiedKey,
  createPrefixMap,
  inferPrefixFromNamespace,
  KNOWN_NAMESPACE_PREFIXES,
} from './field-naming.js';

// ============================================================================
// IR-Enhanced Mode
// ============================================================================

export {
  detectMetadataWithIR,
  getRootElements,
  hasElement,
} from './ir-enhanced.js';

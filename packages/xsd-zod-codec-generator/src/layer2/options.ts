/**
 * Layer 2 Configuration Options
 *
 * Options for decode, encode, and metadata detection operations.
 */

import type { XmlJsonStrategy, QName } from './types.js';
import type { SchemaGraph } from '../xml-schema-graph-ir.js';

/**
 * Mode for handling mixed content (elements with both attributes and text).
 *
 * - 'flatten': Text becomes 'value' key alongside attributes
 *   Example: { "@_avail": "true", "#text": "example.com" }
 *         -> { avail: "true", value: "example.com" }
 *
 * - 'nested': Preserve hierarchy with explicit structure
 *   Example: { "@_avail": "true", "#text": "example.com" }
 *         -> { attributes: { avail: "true" }, text: "example.com" }
 */
export type MixedContentMode = 'flatten' | 'nested';

/**
 * Options for decode operation
 */
export interface DecodeOptions {
  /** The XML JSON strategy to use */
  strategy: XmlJsonStrategy;

  /**
   * Optional renaming rules from XML names to simplified keys.
   * Keys are `{namespace}localName` strings (or just `localName` if no namespace).
   *
   * Example:
   * ```typescript
   * {
   *   "{urn:ietf:params:xml:ns:domain-1.0}avail": "availability",
   *   "lang": "language"
   * }
   * ```
   */
  fieldNameMapping?: Record<string, string>;

  /** Optional SchemaGraph for IR-enhanced metadata */
  schemaGraph?: SchemaGraph;

  /**
   * If true, strip namespace prefixes from field names.
   * "domain:name" -> "name"
   * @default true
   */
  stripNamespacePrefixes?: boolean;

  /**
   * Namespace alias map for disambiguation when field names collide.
   * Maps namespace URI -> alias prefix.
   *
   * Example: If both domain:name and contact:name exist,
   * you might map them to "domainName" and "contactName".
   */
  namespaceAliases?: Map<string, string>;

  /**
   * Mode for handling elements with both attributes and text content.
   * @default 'flatten'
   */
  mixedContentMode?: MixedContentMode;

  /**
   * Key name for text content when flattening mixed content.
   * @default 'value'
   */
  textValueKey?: string;
}

/**
 * Options for encode operation
 */
export interface EncodeOptions {
  /** The XML JSON strategy to use */
  strategy: XmlJsonStrategy;
}

/**
 * Options for metadata detection
 */
export interface DetectMetadataOptions {
  /** The XML JSON strategy to use */
  strategy: XmlJsonStrategy;

  /** Optional SchemaGraph for enhanced type information */
  schemaGraph?: SchemaGraph;

  /** Parent namespace context (for resolving child elements) */
  parentNamespace?: string;

  /** Known QName for this node (if available from parent context) */
  knownQName?: QName;

  /**
   * If true, strip namespace prefixes from field names.
   * @default true
   */
  stripNamespacePrefixes?: boolean;

  /**
   * Optional renaming rules from XML names to simplified keys.
   */
  fieldNameMapping?: Record<string, string>;

  /** Namespace alias map for disambiguation */
  namespaceAliases?: Map<string, string>;

  /**
   * Mode for handling elements with both attributes and text content.
   * @default 'flatten'
   */
  mixedContentMode?: MixedContentMode;

  /**
   * Key name for text content when flattening mixed content.
   * @default 'value'
   */
  textValueKey?: string;
}

/**
 * Default options for decode operation
 */
export const DEFAULT_DECODE_OPTIONS: Partial<DecodeOptions> = {
  stripNamespacePrefixes: true,
  mixedContentMode: 'flatten',
  textValueKey: 'value',
};

/**
 * Default options for metadata detection
 */
export const DEFAULT_DETECT_OPTIONS: Partial<DetectMetadataOptions> = {
  stripNamespacePrefixes: true,
  mixedContentMode: 'flatten',
  textValueKey: 'value',
};

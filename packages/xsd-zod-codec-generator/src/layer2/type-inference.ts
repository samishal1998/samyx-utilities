/**
 * Type Inference Utilities
 *
 * Advanced TypeScript type utilities for inferring clean types from XML JSON types.
 * Enables compile-time type safety when the input XML JSON shape is known.
 *
 * @example
 * ```typescript
 * // Layer 1 type (from fast-xml-parser)
 * type XmlJson = {
 *   "domain:cd": Array<{
 *     "domain:name": {
 *       "@_avail": string;
 *       "#text": string;
 *     };
 *   }>;
 * };
 *
 * // Inferred clean type
 * type Clean = InferCleanType<XmlJson>;
 * // Result: { cd: Array<{ name: { avail: string; value: string } }> }
 * ```
 */

// ============================================================================
// String Manipulation Types
// ============================================================================

/**
 * Remove a prefix from a string literal type.
 * @example RemovePrefix<"@_avail", "@_"> = "avail"
 */
type RemovePrefix<
  S extends string,
  Prefix extends string,
> = S extends `${Prefix}${infer Rest}` ? Rest : S;

/**
 * Remove namespace prefix from a string literal type.
 * @example RemoveNamespacePrefix<"domain:name"> = "name"
 */
type RemoveNamespacePrefix<S extends string> =
  S extends `${string}:${infer Name}` ? Name : S;

/**
 * Check if a string starts with a prefix.
 */
type StartsWith<
  S extends string,
  Prefix extends string,
> = S extends `${Prefix}${string}` ? true : false;

// ============================================================================
// XML JSON Type Detection
// ============================================================================

/**
 * Check if a key is an attribute key (@_ prefix).
 */
type IsAttributeKey<K extends string> = StartsWith<K, '@_'>;

/**
 * Check if a key is the text content key (#text).
 */
type IsTextKey<K extends string> = K extends '#text' ? true : false;

/**
 * Check if a key is an element key (not attribute, not text).
 */
type IsElementKey<K extends string> = IsAttributeKey<K> extends true
  ? false
  : IsTextKey<K> extends true
    ? false
    : true;

// ============================================================================
// Clean Key Transformations
// ============================================================================

/**
 * Transform an attribute key: "@_avail" -> "avail"
 */
type CleanAttributeKey<K extends string> = RemovePrefix<K, '@_'>;

/**
 * Transform a text key: "#text" -> "value" (configurable)
 */
type CleanTextKey<
  K extends string,
  TextValueKey extends string = 'value',
> = K extends '#text' ? TextValueKey : K;

/**
 * Transform an element key: "domain:name" -> "name"
 */
type CleanElementKey<
  K extends string,
  StripNamespace extends boolean = true,
> = StripNamespace extends true ? RemoveNamespacePrefix<K> : K;

/**
 * Transform any XML JSON key to its clean equivalent.
 */
type CleanKey<
  K extends string,
  StripNamespace extends boolean = true,
  TextValueKey extends string = 'value',
> = IsAttributeKey<K> extends true
  ? CleanAttributeKey<K>
  : IsTextKey<K> extends true
    ? CleanTextKey<K, TextValueKey>
    : CleanElementKey<K, StripNamespace>;

// ============================================================================
// Value Type Transformations
// ============================================================================

/**
 * Check if an object has only attributes and/or text (no child elements).
 * This is a "simple" node in XML JSON.
 */
type IsSimpleNode<T> = T extends object
  ? Exclude<keyof T, `@_${string}` | '#text'> extends never
    ? true
    : false
  : false;

/**
 * Check if an object has both attributes and text content.
 */
type HasAttributesAndText<T> = T extends object
  ? ('@_' extends `@_${string & keyof T}` ? false : true) extends true
    ? '#text' extends keyof T
      ? true
      : false
    : false
  : false;

/**
 * Transform a simple node (attributes + text) to flattened form.
 * { "@_avail": string, "#text": string } -> { avail: string, value: string }
 */
type FlattenSimpleNode<
  T extends object,
  TextValueKey extends string = 'value',
> = {
  [K in keyof T as CleanKey<K & string, true, TextValueKey>]: T[K];
};

// ============================================================================
// Main Type Inference
// ============================================================================

/**
 * Options for type inference.
 */
export interface InferOptions {
  /** Strip namespace prefixes from keys (default: true) */
  stripNamespace?: boolean;
  /** Key name for text content (default: 'value') */
  textValueKey?: string;
  /** Mode for mixed content: 'flatten' | 'nested' (default: 'flatten') */
  mixedContentMode?: 'flatten' | 'nested';
}

/**
 * Infer the clean TypeScript type from an XML JSON type.
 *
 * @example
 * ```typescript
 * type XmlJson = {
 *   "domain:name": {
 *     "@_avail": "true" | "false";
 *     "#text": string;
 *   };
 * };
 *
 * type Clean = InferCleanType<XmlJson>;
 * // { name: { avail: "true" | "false"; value: string } }
 * ```
 */
export type InferCleanType<
  T,
  StripNamespace extends boolean = true,
  TextValueKey extends string = 'value',
> = T extends (infer U)[]
  ? InferCleanType<U, StripNamespace, TextValueKey>[]
  : T extends object
    ? IsSimpleNode<T> extends true
      ? FlattenSimpleNode<T, TextValueKey>
      : {
          [K in keyof T as CleanKey<
            K & string,
            StripNamespace,
            TextValueKey
          >]: InferCleanType<T[K], StripNamespace, TextValueKey>;
        }
    : T;

/**
 * Infer clean type with $meta envelope.
 */
export type InferCleanEnvelope<
  T,
  StripNamespace extends boolean = true,
  TextValueKey extends string = 'value',
> = InferCleanType<T, StripNamespace, TextValueKey> & {
  $meta: import('./types.js').XmlMeta;
};

// ============================================================================
// Typed Decode/Encode Functions
// ============================================================================

/**
 * Typed decode function that infers the output type from input.
 *
 * @example
 * ```typescript
 * import { typedDecode, FastXmlParserStrategy } from './layer2';
 *
 * // Input type known at compile time
 * const xmlJson: DomainChkDataXml = { ... };
 *
 * // Output type is automatically inferred
 * const result = typedDecode(xmlJson, { strategy: FastXmlParserStrategy });
 * // result has type: InferCleanEnvelope<DomainChkDataXml>
 * ```
 */
export type TypedDecodeResult<
  TInput,
  StripNamespace extends boolean = true,
  TextValueKey extends string = 'value',
> = InferCleanEnvelope<TInput, StripNamespace, TextValueKey>;

/**
 * Helper type to extract clean payload type (without $meta).
 */
export type CleanPayload<
  TInput,
  StripNamespace extends boolean = true,
  TextValueKey extends string = 'value',
> = InferCleanType<TInput, StripNamespace, TextValueKey>;

// ============================================================================
// Reverse Inference (Clean -> XML JSON)
// ============================================================================

/**
 * Add attribute prefix to a key.
 */
type AddAttributePrefix<K extends string> = `@_${K}`;

/**
 * Add namespace prefix to a key.
 */
type AddNamespacePrefix<
  K extends string,
  Prefix extends string,
> = `${Prefix}:${K}`;

/**
 * Infer XML JSON type from clean type (reverse transformation).
 * This is useful for encode operations.
 *
 * Note: This is a best-effort inference since we lose namespace information
 * in the clean type. Full reconstruction requires $meta.
 */
export type InferXmlJsonType<
  T,
  TextValueKey extends string = 'value',
> = T extends (infer U)[]
  ? InferXmlJsonType<U, TextValueKey>[]
  : T extends object
    ? {
        [K in keyof T as K extends TextValueKey
          ? '#text'
          : K extends string
            ? K
            : never]: InferXmlJsonType<T[K], TextValueKey>;
      }
    : T;

// ============================================================================
// Utility Types for Working with Layer 2
// ============================================================================

/**
 * Extract the payload type from a Layer2Envelope.
 */
export type ExtractLayer2Payload<T> = T extends { $meta: unknown }
  ? Omit<T, '$meta'>
  : T;

/**
 * Make all properties in T optional recursively.
 */
export type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

/**
 * Make all properties in T required recursively.
 */
export type DeepRequired<T> = T extends object
  ? { [K in keyof T]-?: DeepRequired<T[K]> }
  : T;

/**
 * Get all keys that are attributes in XML JSON.
 */
export type AttributeKeys<T> = T extends object
  ? Extract<keyof T, `@_${string}`>
  : never;

/**
 * Get all keys that are elements in XML JSON.
 */
export type ElementKeys<T> = T extends object
  ? Exclude<keyof T, `@_${string}` | '#text'>
  : never;

/**
 * Get the type of a specific element by its clean name.
 */
export type GetElementType<T extends object, CleanName extends string> = {
  [K in keyof T]: RemoveNamespacePrefix<K & string> extends CleanName
    ? T[K]
    : never;
}[keyof T];

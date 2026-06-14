/**
 * Layer 2 Core Types
 *
 * These types define the strategy-independent metadata format
 * that enables bidirectional XML JSON <-> simplified object transformation.
 *
 * Layer 2 is NOT tied to Zod. It's a pure encode/decode layer that
 * transforms XML-JSON (from fast-xml-parser) into clean TypeScript objects
 * with metadata ($meta) enabling round-trip encoding.
 */

/**
 * Qualified Name: namespace + localName.
 * Similar to QName in xml-schema-graph-ir.ts but with optional namespace
 * for Layer 2 runtime usage where namespace may not always be known.
 */
export interface QName {
  /** Namespace URI; may be omitted if not needed */
  namespace?: string;
  /** Local name (e.g., "name", "chkData") */
  localName: string;
}

/**
 * XML JSON Representation Strategy
 *
 * Pluggable abstraction over how XML nodes are represented as JSON.
 * Different XML-to-JSON libraries use different conventions:
 * - fast-xml-parser: `@_` for attributes, `#text` for text
 * - xml2js: `$` for attributes, `_` for text
 * - etc.
 */
export interface XmlJsonStrategy {
  /** Unique id, used in metadata. Example: "fxp-v1" */
  id: string;

  /**
   * Return all attributes of a node as a simple map: { name -> value }.
   * @param node The Layer-1 XML JSON representation (implementation-specific)
   */
  getAttributes(node: unknown): Record<string, unknown>;

  /**
   * Return children element nodes as a map.
   * Key = XML local name WITH namespace prefix if present (e.g., "domain:name")
   * Value = child node or array of nodes
   */
  getChildren(node: unknown): Record<string, unknown | unknown[]>;

  /**
   * Return simple text value of the node if any (for simple content).
   */
  getText(node: unknown): unknown;

  /**
   * Create a fresh node for a given qualified name.
   * You do NOT have to support incremental mutation in v1.
   */
  createNode(input: {
    qname: QName;
    attributes?: Record<string, unknown>;
    text?: unknown;
    children?: Record<string, unknown | unknown[]>;
  }): unknown;
}

/**
 * Root envelope for Layer 2 - simplified object + metadata.
 * The $meta property is reserved and must not be used for user data.
 */
export type Layer2Envelope<TPayload extends object = Record<string, unknown>> =
  TPayload & {
    /** Reserved for Layer 2. Must not be used for user data. */
    $meta: XmlMeta;
  };

/**
 * Uniform metadata format (strategy-independent).
 * This metadata lets us:
 * - encode simplified object → XML-JSON again
 * - understand namespaces
 * - understand which properties are attributes vs elements vs text/value
 * - preserve cardinality info (single vs array)
 */
export interface XmlMeta {
  /** Strategy id that produced this mapping (e.g., "fxp-v1"). */
  strategyId: string;

  /** Metadata of the root XML element corresponding to this object. */
  root: XmlNodeMeta;
}

/**
 * Metadata for a single XML element mapped to a simplified JS object.
 * `fields` map from simplified key -> field metadata.
 */
export interface XmlNodeMeta {
  /** QName of this element in the XML world. */
  qname: QName;

  /**
   * Optional description of the node value.
   * Present when this XML node itself carries a text/simple content.
   */
  value?: XmlValueMeta;

  /**
   * Field metadata for attributes and children mapped onto the same object.
   * Keys here are the *simplified* property names in the payload.
   *
   * Example:
   *   simplified key "availability" -> attribute "avail"
   *   simplified key "name"         -> element "domain:name"
   */
  fields: Record<string, XmlFieldMeta>;
}

/** Common fields shared by attribute/element/value metadata. */
export interface XmlFieldBaseMeta {
  /** Original XML name (local name only). */
  xmlName: string;

  /** Namespace of the XML item, if any. */
  namespace?: string;

  /**
   * 'one'  -> single instance (minOccurs/maxOccurs <= 1)
   * 'many' -> list/array (maxOccurs > 1)
   */
  cardinality: 'one' | 'many';

  /**
   * Optional type hint (from XSD / SchemaGraph) – useful for higher-level logic.
   * This is not required for Layer 2 to work, but nice to keep.
   */
  typeHint?: string;
}

/** Field that represents an XML attribute. */
export interface XmlAttributeFieldMeta extends XmlFieldBaseMeta {
  kind: 'attribute';
}

/** Field that represents a child XML element. */
export interface XmlElementFieldMeta extends XmlFieldBaseMeta {
  kind: 'element';

  /**
   * If the child element itself maps to a complex object with its own XmlNodeMeta,
   * we can inline that here. That enables nested encode/decode.
   */
  nodeMeta?: XmlNodeMeta;
}

/**
 * Description of a node's own text/simple content.
 * Not a field in `fields`, but part of the node.
 */
export interface XmlValueMeta extends XmlFieldBaseMeta {
  kind: 'value';
}

/** Union for fields in XmlNodeMeta.fields */
export type XmlFieldMeta = XmlAttributeFieldMeta | XmlElementFieldMeta;

/**
 * Utility type: extract payload type from Layer2Envelope
 */
export type ExtractPayload<T> = T extends Layer2Envelope<infer P> ? P : never;
